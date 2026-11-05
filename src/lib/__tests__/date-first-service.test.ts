import { authPool } from '@/lib/auth';
import {
  dateFirstFailure,
  executeDateFirst,
  readDateFirstScheduleDraft,
} from '@/lib/date-first-service';
import { dateFirstCommandSchema, formatDayMinute } from '@/lib/date-first-schema';

jest.mock('@/lib/auth', () => ({ authPool: { connect: jest.fn() } }));

const id = '11111111-1111-4111-8111-111111111111';
const command = {
  operation: 'saveDays',
  token: 'public-token-123',
  participantId: id,
  revision: '0',
  changes: [{ id, status: null }],
};
const client = () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ value: '1' }] }),
  release: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('予定の取り込みは本人の編集対象だけに許可し、保存しない', async () => {
  const db = client();
  const preview = {
    participant: id,
    days: [{ id, status: 'yes', intervals: [] }],
    times: [],
    cleared_comments: [],
    fingerprint: 'a'.repeat(64),
  };
  db.query.mockResolvedValue({ rows: [{ value: preview }] } as never);
  jest.mocked(authPool.connect).mockResolvedValue(db as never);
  expect(await readDateFirstScheduleDraft('public-token-123', 'session-owner', id)).toEqual({
    days: preview.days,
    times: [],
  });
  await expect(
    readDateFirstScheduleDraft(
      'public-token-123',
      'session-owner',
      '22222222-2222-4222-8222-222222222222',
    ),
  ).rejects.toThrow('not_linked');
  await expect(readDateFirstScheduleDraft('public-token-123', 'session-owner')).rejects.toThrow(
    'not_linked',
  );
  expect(db.query.mock.calls.every(([sql]) => String(sql).includes('sync_preview'))).toBe(true);
  expect(db.release).toHaveBeenCalledTimes(3);
});

it('未紐付けの予定候補は新規回答だけに返し、任意の参加者への取り込みを拒否する', async () => {
  const db = client();
  db.query.mockResolvedValue({
    rows: [
      {
        value: {
          participant: null,
          days: [],
          times: [],
          cleared_comments: [],
          fingerprint: 'a'.repeat(64),
        },
      },
    ],
  } as never);
  jest.mocked(authPool.connect).mockResolvedValue(db as never);
  expect(await readDateFirstScheduleDraft('public-token-123', 'session-owner')).toEqual({
    days: [],
    times: [],
  });
  await expect(readDateFirstScheduleDraft('public-token-123', 'session-owner', id)).rejects.toThrow(
    'not_linked',
  );
});

it('本人ID・sourceの自己申告と不正な日跨ぎをDB接続前に拒否する', async () => {
  for (const input of [
    { ...command, userId: 'another-user' },
    { ...command, changes: [{ id, status: 'yes', source: 'account' }] },
    { ...command, changes: [{ id, status: 'maybe', intervals: [[-1, 60]] }] },
    { ...command, changes: [{ id, status: 'maybe', intervals: [[0, 1801]] }] },
    { ...command, revision: '9223372036854775808' },
    { ...command, requestId: id },
    { ...command, name: '変更する名前' },
    { ...command, participantId: undefined, requestId: id, name: '新規', revision: '9' },
    {
      ...command,
      changes: [
        { id, status: 'yes' },
        { id, status: 'no' },
      ],
    },
  ])
    expect((await executeDateFirst(input)).success).toBe(false);
  expect(authPool.connect).not.toHaveBeenCalled();
});

it('分単位の区間と手動未回答を変換せず、専用保存境界へ渡す', async () => {
  const db = client();
  jest.mocked(authPool.connect).mockResolvedValue(db as never);
  expect(await executeDateFirst(command)).toEqual({ success: true, value: { id } });
  const save = db.query.mock.calls.find(([sql]) => String(sql).includes('date_first.save_answers'));
  expect(JSON.parse(save?.[1][4])).toEqual([{ id, status: null }]);
  expect(db.query).toHaveBeenLastCalledWith('COMMIT');
  expect(db.release).toHaveBeenCalledTimes(1);
});

it('予定反映は認証済み本人を使い、SERIALIZABLEの中で再検証する', async () => {
  const db = client();
  jest.mocked(authPool.connect).mockResolvedValue(db as never);
  const input = { operation: 'applySync', token: 'public-token-123', fingerprint: 'a'.repeat(64) };
  expect((await executeDateFirst(input)).success).toBe(false);
  expect(db.query.mock.calls.some(([sql]) => String(sql).includes('apply_sync'))).toBe(false);
  db.query.mockClear();
  expect((await executeDateFirst(input, 'trusted-user')).success).toBe(true);
  expect(db.query).toHaveBeenNthCalledWith(1, 'BEGIN ISOLATION LEVEL SERIALIZABLE');
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('date_first.apply_sync'), [
    'trusted-user',
    input.token,
    input.fingerprint,
    [],
  ]);
});

it('接続失敗・ロールバック失敗で内部エラーを公開しない', async () => {
  jest
    .mocked(authPool.connect)
    .mockRejectedValueOnce(new Error('postgres://private-host/secret') as never);
  const result = await executeDateFirst(command);
  expect(result).toMatchObject({ success: false, code: 'retryable_error' });
  expect(JSON.stringify(result)).not.toContain('private-host');
  const db = client();
  db.query.mockRejectedValue(new Error('private SQL details'));
  jest.mocked(authPool.connect).mockResolvedValue(db as never);
  expect(await executeDateFirst(command)).toMatchObject({
    success: false,
    code: 'retryable_error',
  });
  expect(db.release).toHaveBeenCalledTimes(1);
  expect(db.release).toHaveBeenCalledWith(true);
});

it('ロールバック失敗で元の競合理由を失わず、壊れた接続を破棄する', async () => {
  const db = client();
  db.query.mockImplementation(async (sql: string) => {
    if (sql.includes('save_answers')) throw new Error('stale_revision');
    if (sql === 'ROLLBACK') throw new Error('private connection failure');
    return { rows: [] };
  });
  jest.mocked(authPool.connect).mockResolvedValue(db as never);
  expect(await executeDateFirst(command)).toMatchObject({ success: false, code: 'stale_revision' });
  expect(db.release).toHaveBeenCalledWith(true);
  expect(authPool.connect).toHaveBeenCalledTimes(1);
});

it('公開エラー辞書の継承プロパティをエラーコードとして扱わない', () => {
  for (const message of ['toString', 'constructor', '__proto__']) {
    expect(dateFirstFailure(new Error(message))).toMatchObject({
      success: false,
      code: 'retryable_error',
      message: expect.any(String),
    });
  }
});

it('直列化失敗だけを最大2回再試行し、競合確認を勝手にやり直さない', async () => {
  const first = client(),
    second = client();
  first.query.mockImplementation(async (sql: string) => {
    if (sql.includes('save_answers'))
      throw Object.assign(new Error('serialization failure'), { code: '40001' });
    return { rows: [] };
  });
  jest
    .mocked(authPool.connect)
    .mockResolvedValueOnce(first as never)
    .mockResolvedValueOnce(second as never);
  expect((await executeDateFirst(command)).success).toBe(true);
  expect(first.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(first.release).toHaveBeenCalledTimes(1);
  second.query.mockImplementation(async (sql: string) => {
    if (sql.includes('save_answers')) throw new Error('stale_revision');
    return { rows: [] };
  });
  jest
    .mocked(authPool.connect)
    .mockClear()
    .mockResolvedValue(second as never);
  expect(await executeDateFirst(command)).toMatchObject({ success: false, code: 'stale_revision' });
  expect(authPool.connect).toHaveBeenCalledTimes(1);
  const failing = client();
  failing.query.mockRejectedValue(
    Object.assign(new Error('serialization failure'), { code: '40001' }),
  );
  jest
    .mocked(authPool.connect)
    .mockClear()
    .mockResolvedValue(failing as never);
  expect((await executeDateFirst(command)).success).toBe(false);
  expect(authPool.connect).toHaveBeenCalledTimes(3);
});

it('Unicodeの文字数と翌朝6時の境界を維持する', () => {
  const create = {
    operation: 'create',
    requestId: id,
    title: '😀'.repeat(200),
    days: ['2026-11-07'],
  };
  expect(dateFirstCommandSchema.safeParse(create).success).toBe(true);
  expect(
    dateFirstCommandSchema.safeParse({ ...create, title: `  ${create.title}  ` }).success,
  ).toBe(true);
  expect(dateFirstCommandSchema.safeParse({ ...create, title: '😀'.repeat(201) }).success).toBe(
    false,
  );
  expect(formatDayMinute(1440)).toBe('24:00');
  expect(formatDayMinute(1800)).toBe('翌6:00');
});

it.each([767, 768, 769])('Webの正規化済みJSONが%dKiBの境界でDB接続を制御する', async (kib) => {
  const changes = Array.from({ length: 90 }, (_, i) => ({
    id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    status: 'maybe',
    intervals: Array.from({ length: 800 }, () => [0, 1800]),
    comment: '',
  }));
  const input = { ...command, changes };
  let remaining = kib * 1024 - new TextEncoder().encode(JSON.stringify(input)).byteLength;
  for (const change of changes) {
    const length = Math.min(2000, remaining);
    change.comment = 'a'.repeat(length);
    remaining -= length;
  }
  expect(remaining).toBe(0);
  const parsed = dateFirstCommandSchema.parse(input);
  expect(new TextEncoder().encode(JSON.stringify(parsed)).byteLength).toBe(kib * 1024);
  const db = client();
  jest.mocked(authPool.connect).mockResolvedValue(db as never);
  const result = await executeDateFirst(input);
  if (kib <= 768) {
    expect(result.success).toBe(true);
    expect(authPool.connect).toHaveBeenCalledTimes(1);
  } else {
    expect(result).toMatchObject({ success: false, code: 'limit_exceeded' });
    expect(authPool.connect).not.toHaveBeenCalled();
  }
});
