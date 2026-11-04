import { authPool } from '@/lib/auth';
import {
  applyUserAvailabilitySyncForEvent,
  fetchUserAvailabilitySyncPreviewResult,
  saveUserScheduleBlockChanges,
} from '@/lib/schedule-service';
import { answerInput, scheduleInput } from '@/lib/mcp/schemas';
import { saveMyAnswer, saveMyAnswerToSchedule, updateMySchedule } from '@/lib/mcp/services';

jest.mock('@/lib/auth', () => ({ authPool: { connect: jest.fn() } }));
jest.mock('@/lib/schedule-service', () => ({
  applyUserAvailabilitySyncForEvent: jest.fn(),
  fetchUserAvailabilitySyncPreviewResult: jest.fn(),
  saveUserScheduleBlockChanges: jest.fn(),
  buildAnswerScheduleBlocks: jest.requireActual('@/lib/schedule-service').buildAnswerScheduleBlocks,
}));
const dateId = '11111111-1111-4111-8111-111111111111';
const otherDateId = '22222222-2222-4222-8222-222222222222';
const input = {
  public_token: 'AbCdEf123456',
  name: '同じ名前',
  availabilities: [{ event_date_id: dateId, availability: false }],
};
const query = jest.fn();
const release = jest.fn();
const schedule = {
  start_time: '2026-10-12T19:00:00',
  end_time: '2026-10-12T21:00:00',
  availability: false,
  allow_finalized: false,
};

describe('MCP本人の操作', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authPool.connect as jest.Mock).mockResolvedValue({ query, release });
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id') && sql.includes('FROM public.events'))
        return { rows: [{ id: 'event' }] };
      if (sql.startsWith('SELECT id, start_time'))
        return {
          rows: [
            {
              id: dateId,
              start_time: '2026-10-12 19:00:00',
              end_time: '2026-10-12 20:00:00',
            },
            {
              id: otherDateId,
              start_time: '2026-10-12 20:00:00',
              end_time: '2026-10-12 21:00:00',
            },
          ],
        };
      if (sql.startsWith('SELECT participant_id'))
        return { rows: [{ participant_id: 'my-answer' }] };
      if (sql.startsWith('SELECT event_date_id'))
        return { rows: [{ event_date_id: otherDateId, availability: true }] };
      if (sql.startsWith('INSERT INTO public.participants'))
        return { rows: [{ id: 'new-answer' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
  });
  it('AIから任意のuser_id・participant_idを指定できない', () => {
    expect(answerInput.safeParse({ ...input, user_id: 'other' }).success).toBe(false);
    expect(answerInput.safeParse({ ...input, participant_id: 'other' }).success).toBe(false);
  });
  it('旧形式のUUID公開トークンも既存イベントの参照に使える', () => {
    expect(answerInput.safeParse({ ...input, public_token: dateId }).success).toBe(true);
  });
  it('本人の紐づきで回答を編集し、未指定の選択済み回答を保持する', async () => {
    await expect(saveMyAnswer('me', input)).resolves.toMatchObject({
      success: true,
      created: false,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE user_id = $1 AND event_id = $2 FOR UPDATE'),
      ['me', 'event'],
    );
    const saved = query.mock.calls.find(([sql]) =>
      sql.startsWith('SELECT public.update_participant_availability'),
    );
    expect(saved[1].slice(0, 2)).toEqual(['my-answer', 'event']);
    expect(JSON.parse(saved[1][2])).toEqual([{ event_date_id: otherDateId, availability: true }]);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });
  it('参加不可への変更で既存の選択を解除し、不可の手動上書きは保持する', async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(async (sql: string, params: unknown[]) =>
      sql.startsWith('SELECT event_date_id')
        ? {
            rows: [
              { event_date_id: dateId, availability: true },
              { event_date_id: otherDateId, availability: false },
            ],
          }
        : original?.(sql, params),
    );
    await saveMyAnswer('me', input);
    expect(query).toHaveBeenCalledWith(
      'SELECT public.update_participant_availability($1::uuid, $2::uuid, $3::jsonb)',
      ['my-answer', 'event', '[]'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.user_event_availability_overrides'),
      ['me', 'event', JSON.stringify(input.availabilities)],
    );
  });
  it('参加可能を追加しても未指定の選択済み回答は消さない', async () => {
    await saveMyAnswer('me', {
      ...input,
      availabilities: [{ event_date_id: dateId, availability: true }],
    });
    const saved = query.mock.calls.find(([sql]) =>
      sql.startsWith('SELECT public.update_participant_availability'),
    );
    expect(JSON.parse(saved[1][2])).toEqual([
      { event_date_id: otherDateId, availability: true },
      { event_date_id: dateId, availability: true },
    ]);
  });
  it('紐づきがなければ同名検索せず新規回答を作り、本人へ紐づける', async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(async (sql: string, params: unknown[]) =>
      sql.startsWith('SELECT participant_id') ? { rows: [] } : original?.(sql, params),
    );
    await expect(saveMyAnswer('me', input)).resolves.toMatchObject({ created: true });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.user_event_links'),
      ['me', 'event', 'new-answer'],
    );
    expect(query.mock.calls.some(([sql]) => sql.startsWith('SELECT') && sql.includes('name'))).toBe(
      false,
    );
  });
  it('別イベントの候補日時を拒否し、DB変更をロールバックする', async () => {
    await expect(
      saveMyAnswer('me', {
        ...input,
        availabilities: [
          { event_date_id: '33333333-3333-4333-8333-333333333333', availability: true },
        ],
      }),
    ).rejects.toThrow('対象イベント以外');
    expect(
      query.mock.calls.some(([sql]) => sql.startsWith('UPDATE') || sql.startsWith('INSERT')),
    ).toBe(false);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalled();
  });
  it('保存途中の失敗では回答と紐づきの両方をロールバックする', async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT public.update_participant_availability'))
        throw new Error('db error');
      return original?.(sql, params);
    });
    await expect(saveMyAnswer('me', input)).rejects.toThrow('db error');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });
  it('不正日付・逆転・長すぎる期間を拒否する', () => {
    expect(scheduleInput.safeParse(schedule).success).toBe(true);
    for (const override of [
      { start_time: '2026-02-30T19:00:00' },
      { end_time: '2026-10-12T18:00:00' },
      { end_time: '2026-10-20T19:00:00' },
    ])
      expect(scheduleInput.safeParse({ ...schedule, ...override }).success).toBe(false);
  });
  it('予定保存後に本人の全イベントを反映し、確定済みは標準で除外する', async () => {
    const events = [
      { eventId: 'a', publicToken: 'a', isFinalized: false, changes: { total: 3, protected: 1 } },
      { eventId: 'b', publicToken: 'b', isFinalized: true, changes: { total: 1, protected: 0 } },
      { eventId: 'c', publicToken: 'c', isFinalized: false, changes: { total: 1, protected: 0 } },
    ];
    (fetchUserAvailabilitySyncPreviewResult as jest.Mock).mockResolvedValue({
      success: true,
      events,
    });
    (saveUserScheduleBlockChanges as jest.Mock).mockResolvedValue({ success: true });
    (applyUserAvailabilitySyncForEvent as jest.Mock)
      .mockResolvedValueOnce({ success: true, updatedCount: 2 })
      .mockResolvedValueOnce({ success: false, updatedCount: 0 });
    const result = await updateMySchedule('me', schedule);
    expect(saveUserScheduleBlockChanges).toHaveBeenCalledWith('me', {
      upserts: [
        { startTime: schedule.start_time, endTime: schedule.end_time, availability: false },
      ],
      deleteIds: [],
    });
    expect(applyUserAvailabilitySyncForEvent).toHaveBeenCalledWith('me', {
      eventId: 'a',
      overwriteProtected: false,
      allowFinalized: false,
      strict: true,
    });
    expect(result).toMatchObject({
      schedule_saved: true,
      sync_complete: false,
      events: [{ status: 'updated' }, { status: 'skipped' }, { status: 'failed' }],
    });
  });
  it('取得失敗で予定の保存を始めない', async () => {
    (fetchUserAvailabilitySyncPreviewResult as jest.Mock).mockRejectedValue(new Error('取得失敗'));
    await expect(updateMySchedule('me', schedule)).rejects.toThrow();
    expect(saveUserScheduleBlockChanges).not.toHaveBeenCalled();
  });
  it('初回の予定補完はサーバーで計算し、明示枠だけを手動上書きとして保存する', async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT participant_id')) return { rows: [] };
      if (sql.startsWith('SELECT (start_time AT TIME ZONE'))
        return {
          rows: [
            {
              start_time: '2026-10-12 19:00:00',
              end_time: '2026-10-12 21:00:00',
              availability: true,
            },
          ],
        };
      if (sql.startsWith('SELECT event_date_id')) return { rows: [] };
      return original?.(sql, params);
    });
    const result = await saveMyAnswer('me', { ...input, use_account_schedule: true });
    expect(result).toMatchObject({ account_seeded_slots: 2 });
    const saved = query.mock.calls.find(([sql]) =>
      sql.startsWith('SELECT public.update_participant_availability'),
    );
    expect(JSON.parse(saved[1][2])).toEqual([{ event_date_id: otherDateId, availability: true }]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.user_event_availability_overrides'),
      ['me', 'event', JSON.stringify(input.availabilities)],
    );
  });
  it('既存回答がある場合は初回補完を拒否し、不可を勝手に変更しない', async () => {
    await expect(saveMyAnswer('me', { ...input, use_account_schedule: true })).rejects.toThrow(
      '既存回答',
    );
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('予定補完の取得失敗では新規回答も作らない', async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT participant_id')) return { rows: [] };
      if (sql.startsWith('SELECT (start_time AT TIME ZONE')) throw new Error('取得失敗');
      return original?.(sql, params);
    });
    await expect(saveMyAnswer('me', { ...input, use_account_schedule: true })).rejects.toThrow(
      '取得失敗',
    );
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });
  it('予定保存はプレビューでは書き込まず、適用時は指定枠の不可も保存する', async () => {
    const args = { public_token: input.public_token, event_date_ids: [dateId] };
    const preview = await saveMyAnswerToSchedule('me', args);
    if (!('saved' in preview)) throw new Error('プレビューに失敗しました');
    expect(preview.saved).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    await expect(
      saveMyAnswerToSchedule('me', {
        ...args,
        mode: 'apply',
        expected_revision: preview.expected_revision,
      }),
    ).resolves.toMatchObject({ saved: true, saved_slots: 1, other_events_updated: false });
    const saved = query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO public.user_schedule_blocks'),
    );
    expect(JSON.parse(saved[1][2])).toEqual([
      {
        start_time: '2026-10-12T19:00:00.000Z',
        end_time: '2026-10-12T20:00:00.000Z',
        availability: false,
      },
    ]);
  });
  it('プレビュー後の回答変更を検出して予定の上書きを拒否する', async () => {
    const args = { public_token: input.public_token, event_date_ids: [dateId] };
    const preview = await saveMyAnswerToSchedule('me', args);
    if (!('saved' in preview)) throw new Error('プレビューに失敗しました');
    const original = query.getMockImplementation();
    query.mockImplementation(async (sql: string, params: unknown[]) =>
      sql.startsWith('SELECT event_date_id')
        ? { rows: [{ event_date_id: dateId, availability: true }] }
        : original?.(sql, params),
    );
    await expect(
      saveMyAnswerToSchedule('me', {
        ...args,
        mode: 'apply',
        expected_revision: preview.expected_revision,
      }),
    ).rejects.toThrow('変更されました');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });
  it.each([true, false])('MCPでも一致する重複枠を統合して保存する（可=%s）', async (available) => {
    const original = query.getMockImplementation();
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT id, start_time'))
        return {
          rows: [
            { id: dateId, start_time: '2026-10-12 10:00:00', end_time: '2026-10-12 12:00:00' },
            { id: otherDateId, start_time: '2026-10-12 10:00:00', end_time: '2026-10-12 11:00:00' },
          ],
        };
      if (sql.startsWith('SELECT event_date_id'))
        return {
          rows: [dateId, otherDateId].map((id) => ({ event_date_id: id, availability: available })),
        };
      return original?.(sql, params);
    });
    const args = { public_token: input.public_token, event_date_ids: [dateId, otherDateId] };
    const preview = await saveMyAnswerToSchedule('me', args);
    if (!('saved' in preview)) throw new Error('プレビューに失敗しました');
    await expect(
      saveMyAnswerToSchedule('me', {
        ...args,
        mode: 'apply',
        expected_revision: preview.expected_revision,
      }),
    ).resolves.toMatchObject({ saved: true, saved_slots: 2 });
    const saved = query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO public.user_schedule_blocks'),
    );
    expect(JSON.parse(saved[1][2])).toHaveLength(2);
  });
  it('MCPでも可・不可が矛盾する重複枠はプレビュー時点で拒否する', async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT id, start_time'))
        return {
          rows: [
            { id: dateId, start_time: '2026-10-12 10:00:00', end_time: '2026-10-12 12:00:00' },
            { id: otherDateId, start_time: '2026-10-12 10:00:00', end_time: '2026-10-12 11:00:00' },
          ],
        };
      return original?.(sql, params);
    });
    await expect(
      saveMyAnswerToSchedule('me', {
        public_token: input.public_token,
        event_date_ids: [dateId, otherDateId],
      }),
    ).rejects.toThrow('矛盾');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });
});
