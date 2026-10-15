import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { authPool } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase';
import {
  applyUserAvailabilitySyncForEvent,
  fetchUserAvailabilitySyncPreviewResult,
  saveUserScheduleBlockChanges,
  buildAnswerScheduleBlocks,
} from '@/lib/schedule-service';
import { loadAnswerSchedule, answerScheduleAvailability, type AnswerDate } from './answer-context';
import { readEventDates } from './read-services';
import {
  answerInput,
  answerScheduleInput,
  proposedScheduleBlocks,
  scheduleInput,
  type AnswerInput,
  type ScheduleInput,
} from './schemas';

export class McpInputError extends Error {}

export async function readEvent(publicToken: string) {
  const event = await readEventDates(publicToken);
  if (!event) throw new McpInputError('イベントが見つかりません');
  return event;
}

export async function readMyAnswer(
  userId: string,
  publicToken: string,
  includeAccountSchedule?: boolean,
) {
  const event = await readEvent(publicToken);
  let accountSchedule;
  if (includeAccountSchedule) {
    const db = await authPool.connect();
    try {
      const context = await loadAnswerSchedule(db, userId, event.id, event.dates);
      accountSchedule = event.dates.map((date) => ({
        ...date,
        availability: answerScheduleAvailability(date, context),
      }));
    } finally {
      db.release();
    }
  }
  const supabase = createSupabaseAdmin();
  const { data: link, error } = await supabase
    .from('user_event_links')
    .select('participant_id')
    .eq('user_id', userId)
    .eq('event_id', event.id)
    .maybeSingle();
  if (error) throw new Error('回答の紐づきを取得できませんでした');
  if (!link?.participant_id)
    return { answer: null, ...(accountSchedule ? { account_schedule: accountSchedule } : {}) };
  const participant = await supabase
    .from('participants')
    .select('name,comment')
    .eq('id', link.participant_id)
    .eq('event_id', event.id)
    .maybeSingle();
  if (participant.error || !participant.data) throw new Error('回答を取得できませんでした');
  const selected = new Map<string, boolean>();
  for (let from = 0; ; from += 1000) {
    const page = await supabase
      .from('availabilities')
      .select('event_date_id,availability')
      .eq('participant_id', link.participant_id)
      .order('event_date_id')
      .range(from, from + 999);
    if (page.error) throw new Error('回答を取得できませんでした');
    for (const row of page.data ?? []) selected.set(row.event_date_id, row.availability);
    if (!page.data || page.data.length < 1000) break;
  }
  return {
    ...(accountSchedule
      ? {
          account_schedule: accountSchedule,
          conflicting_date_ids: accountSchedule
            .filter(
              (date) =>
                date.availability !== null &&
                date.availability !== (selected.get(date.id) ?? false),
            )
            .map((date) => date.id),
        }
      : {}),
    answer: {
      ...participant.data,
      availabilities: event.dates.map((date) => ({
        event_date_id: date.id,
        availability: selected.get(date.id) ?? false,
      })),
    },
  };
}

/** 本人の紐づきをロックし、名前検索をせずに回答と紐づきを原子的に保存する。 */
export async function saveMyAnswer(userId: string, rawInput: AnswerInput) {
  const input = answerInput.parse(rawInput);
  const db = await authPool.connect();
  try {
    await db.query('BEGIN');
    const eventResult = await db.query<{ id: string }>(
      'SELECT id FROM public.events WHERE public_token = $1 FOR SHARE',
      [input.public_token],
    );
    const eventId = eventResult.rows[0]?.id;
    if (!eventId) throw new McpInputError('イベントが見つかりません');
    // 未紐づけの初回回答も同一アカウントから同時に作成しない。
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `mcp-answer:${userId}:${eventId}`,
    ]);
    const dates = await db.query<AnswerDate>(
      'SELECT id, start_time::text, end_time::text FROM public.event_dates WHERE event_id = $1 FOR SHARE',
      [eventId],
    );
    const validIds = new Set(dates.rows.map((row) => row.id));
    if (input.availabilities.some((row) => !validIds.has(row.event_date_id)))
      throw new McpInputError('対象イベント以外の候補日時は指定できません');
    const link = await db.query<{ participant_id: string | null }>(
      'SELECT participant_id FROM public.user_event_links WHERE user_id = $1 AND event_id = $2 FOR UPDATE',
      [userId, eventId],
    );
    let participantId = link.rows[0]?.participant_id;
    if (participantId && input.use_account_schedule)
      throw new McpInputError(
        '既存回答があるため初回の予定補完はできません。回答を再取得して変更枠だけ指定してください',
      );
    const seeded = new Map<string, boolean>();
    if (input.use_account_schedule) {
      const context = await loadAnswerSchedule(db, userId, eventId, dates.rows);
      for (const date of dates.rows) {
        const availability = answerScheduleAvailability(date, context);
        if (availability !== null) seeded.set(date.id, availability);
      }
    }
    let created = false;
    if (!participantId) {
      const participant = await db.query<{ id: string }>(
        `INSERT INTO public.participants (event_id, name, comment, response_token) VALUES ($1,$2,$3,pg_catalog.gen_random_uuid()) RETURNING id`,
        [eventId, input.name, input.comment ?? null],
      );
      participantId = participant.rows[0].id;
      if (link.rows.length) {
        await db.query(
          'UPDATE public.user_event_links SET participant_id = $3, updated_at = now() WHERE user_id = $1 AND event_id = $2',
          [userId, eventId, participantId],
        );
      } else {
        await db.query(
          'INSERT INTO public.user_event_links (user_id,event_id,participant_id) VALUES ($1,$2,$3)',
          [userId, eventId, participantId],
        );
      }
      created = true;
    } else {
      const updated = await db.query(
        'UPDATE public.participants SET name = $3, comment = coalesce($4, comment) WHERE id = $1 AND event_id = $2 RETURNING id',
        [participantId, eventId, input.name, input.comment],
      );
      if (!updated.rowCount) throw new McpInputError('回答の紐づきを確認できません');
      if (input.comment === null)
        await db.query('UPDATE public.participants SET comment = NULL WHERE id = $1', [
          participantId,
        ]);
    }
    // 指定された枠だけを更新する。未指定の回答・手動上書きは保持する。
    const previous = await db.query<{ event_date_id: string; availability: boolean }>(
      'SELECT event_date_id, availability FROM public.availabilities WHERE participant_id = $1',
      [participantId],
    );
    const answers = new Map(previous.rows.map((row) => [row.event_date_id, row.availability]));
    for (const [id, availability] of seeded) answers.set(id, availability);
    for (const row of input.availabilities) answers.set(row.event_date_id, row.availability);
    // Webと同じく参加可能だけを保存し、レコードのない枠は参加不可として扱う。
    const payload = [...answers]
      .filter(([, availability]) => availability)
      .map(([event_date_id]) => ({ event_date_id, availability: true }));
    await db.query('SELECT public.update_participant_availability($1::uuid, $2::uuid, $3::jsonb)', [
      participantId,
      eventId,
      JSON.stringify(payload),
    ]);
    await db.query(
      `INSERT INTO public.user_event_availability_overrides (user_id,event_id,event_date_id,availability,reason)
      SELECT $1,$2,x.event_date_id,x.availability,'conflict_override' FROM jsonb_to_recordset($3::jsonb) AS x(event_date_id uuid, availability boolean)
      ON CONFLICT (user_id,event_id,event_date_id) DO UPDATE SET availability = EXCLUDED.availability, updated_at = now()`,
      [userId, eventId, JSON.stringify(input.availabilities)],
    );
    await db.query('UPDATE public.events SET last_accessed_at = now() WHERE id = $1', [eventId]);
    await db.query('COMMIT');
    return {
      success: true,
      created,
      changed_slots: input.availabilities.length,
      answered_date_ids: created
        ? dates.rows.map((date) => date.id)
        : input.availabilities.map((date) => date.event_date_id),
      account_seeded_slots: seeded.size,
      unresolved_date_ids: input.use_account_schedule
        ? dates.rows
            .filter(
              (date) =>
                !seeded.has(date.id) &&
                !input.availabilities.some((row) => row.event_date_id === date.id),
            )
            .map((date) => date.id)
        : [],
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export async function previewMyScheduleUpdate(userId: string, rawInput: ScheduleInput) {
  const input = scheduleInput.parse(rawInput);
  const result = await fetchUserAvailabilitySyncPreviewResult(userId, {
    proposedBlocks: proposedScheduleBlocks(input),
    strict: true,
  });
  if (!result.success) throw new McpInputError(result.message);
  return {
    events: result.events.map((event) => ({
      public_token: event.publicToken,
      title: event.title,
      skipped: event.isFinalized && !input.allow_finalized,
      changed_slots: event.changes.total - event.changes.protected,
      protected_slots: event.changes.protected,
    })),
  };
}

/** 本人回答の指定枠を予定へ保存する。プレビューの変化を検出し、他イベントは更新しない。 */
export async function saveMyAnswerToSchedule(
  userId: string,
  rawInput: z.input<typeof answerScheduleInput>,
) {
  const input = answerScheduleInput.parse(rawInput);
  const db = await authPool.connect();
  try {
    await db.query('BEGIN');
    // プレビュー検証から保存までの予定追加・回答変更も競合として検出する。
    await db.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const event = await db.query<{ id: string }>(
      'SELECT id FROM public.events WHERE public_token = $1 FOR SHARE',
      [input.public_token],
    );
    const eventId = event.rows[0]?.id;
    if (!eventId) throw new McpInputError('イベントが見つかりません');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `mcp-answer:${userId}:${eventId}`,
    ]);
    const link = await db.query<{ participant_id: string | null }>(
      'SELECT participant_id FROM public.user_event_links WHERE user_id = $1 AND event_id = $2 FOR UPDATE',
      [userId, eventId],
    );
    const participantId = link.rows[0]?.participant_id;
    if (!participantId) throw new McpInputError('本人に紐づく回答がありません');
    const dates = await db.query<AnswerDate>(
      'SELECT id, start_time::text, end_time::text FROM public.event_dates WHERE event_id = $1 ORDER BY start_time, id FOR SHARE',
      [eventId],
    );
    const target = dates.rows.filter((date) => input.event_date_ids.includes(date.id));
    if (target.length !== input.event_date_ids.length)
      throw new McpInputError('対象イベント以外の候補日時は指定できません');
    const answers = await db.query<{ event_date_id: string; availability: boolean }>(
      'SELECT event_date_id, availability FROM public.availabilities WHERE participant_id = $1 FOR SHARE',
      [participantId],
    );
    const selected = new Map(answers.rows.map((row) => [row.event_date_id, row.availability]));
    const context = await loadAnswerSchedule(db, userId, eventId, target);
    const changes = target.map((date) => ({
      event_date_id: date.id,
      start_time: date.start_time,
      end_time: date.end_time,
      answer_availability: selected.get(date.id) ?? false,
      account_availability: answerScheduleAvailability(date, context),
    }));
    const payload = buildAnswerScheduleBlocks(
      target,
      changes.filter((date) => date.answer_availability).map((date) => date.event_date_id),
    );
    if (!payload)
      throw new McpInputError(
        '重なる候補日時の回答が矛盾しています。保存する候補を選び直してください',
      );
    const revision = createHash('sha256')
      .update(JSON.stringify({ userId, eventId, participantId, changes, context }))
      .digest('hex');
    if (input.mode === 'apply' && input.expected_revision !== revision)
      throw new McpInputError(
        '回答または予定が変更されました。プレビューを再取得して確認してください',
      );
    if (input.mode === 'preview') {
      await db.query('COMMIT');
      return { saved: false, expected_revision: revision, changes, other_events_updated: false };
    }
    await db.query(
      `INSERT INTO public.user_schedule_blocks (user_id,start_time,end_time,availability,source,event_id,updated_at)
      SELECT $1,x.start_time,x.end_time,x.availability,'event',$2,now()
      FROM jsonb_to_recordset($3::jsonb) AS x(start_time timestamptz,end_time timestamptz,availability boolean)
      ON CONFLICT (user_id,start_time,end_time) DO UPDATE SET availability = EXCLUDED.availability,
      source = EXCLUDED.source, event_id = EXCLUDED.event_id, updated_at = now()`,
      [userId, eventId, JSON.stringify(payload)],
    );
    await db.query('COMMIT');
    return { saved: true, saved_slots: payload.length, other_events_updated: false };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

/** 予定保存後に再計算し、各イベントの成功・失敗を分けて返す。再実行しても予定は増殖しない。 */
export async function updateMySchedule(userId: string, rawInput: ScheduleInput) {
  const input = scheduleInput.parse(rawInput);
  // 不完全な取得結果で保存を始めない。
  await previewMyScheduleUpdate(userId, input);
  const saved = await saveUserScheduleBlockChanges(userId, {
    upserts: [
      { startTime: input.start_time, endTime: input.end_time, availability: input.availability },
    ],
    deleteIds: [],
  });
  if (!saved.success) throw new McpInputError(saved.message ?? '予定を保存できませんでした');
  const events: Array<{
    public_token: string;
    status: 'updated' | 'skipped' | 'failed';
    changed_slots: number;
  }> = [];
  try {
    const preview = await fetchUserAvailabilitySyncPreviewResult(userId, { strict: true });
    if (!preview.success) throw new Error();
    for (const event of preview.events) {
      if (event.isFinalized && !input.allow_finalized) {
        events.push({ public_token: event.publicToken, status: 'skipped', changed_slots: 0 });
        continue;
      }
      try {
        const applied = await applyUserAvailabilitySyncForEvent(userId, {
          eventId: event.eventId,
          overwriteProtected: false,
          allowFinalized: input.allow_finalized,
          strict: true,
        });
        events.push({
          public_token: event.publicToken,
          status: applied.success ? 'updated' : 'failed',
          changed_slots: applied.updatedCount,
        });
      } catch {
        events.push({ public_token: event.publicToken, status: 'failed', changed_slots: 0 });
      }
    }
    return {
      schedule_saved: true,
      sync_complete: events.every((event) => event.status !== 'failed'),
      events,
    };
  } catch {
    return {
      schedule_saved: true,
      sync_complete: false,
      events,
      message:
        '予定は保存しましたが、回答への反映を完了できませんでした。同じ予定更新を再実行すると反映を再試行できます。',
    };
  }
}
