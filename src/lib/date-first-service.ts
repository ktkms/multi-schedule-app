import 'server-only';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { authPool } from '@/lib/auth';
import {
  dateFirstCommandSchema,
  dateFirstEventSchema,
  dateFirstAnswerSchema,
  dayDetailsSchema,
  type DateFirstCommand,
} from './date-first-schema';

const messages: Record<string, string> = {
  stale_revision: '他の変更が保存されています。最新の内容を確認してから保存してください。',
  stale_name: '名前が変更されています。最新の名前を確認してください。',
  stale_preview: '回答または予定が変更されています。もう一度差分を確認してください。',
  requires_confirmation: '解除・削除される内容を確認してください。',
  invalid_event_scope: '対象の日付・時間枠を確認してください。',
  not_linked: '先に自分の回答を紐付けてください。',
  request_conflict: '別の内容で送信済みです。保存結果を確認してください。',
  invalid_input: '入力内容を確認してください。',
  invalid_mode: 'この操作は対象の調整方式では利用できません。',
  overlapping_slots: '同じ日付の時間枠が重なっています。',
  overlapping_finalization: '重なる日時は同時に確定できません。',
  conflicting_answers:
    '重なる時間候補の○と×が矛盾しています。予定へ保存する候補を選び直してください。',
  limit_exceeded: '件数または入力サイズの上限を超えています。',
  unsupported_precision: '分より細かい予定が含まれています。予定を確認してください。',
};
export type DateFirstResult =
  | { success: true; value: unknown; warning?: string }
  | { success: false; code: string; message: string };
const errorCode = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return 'retryable_error';
  if (
    'message' in error &&
    typeof error.message === 'string' &&
    Object.hasOwn(messages, error.message)
  )
    return error.message;
  if ('code' in error && ['23503', 'P0002'].includes(String(error.code)))
    return 'invalid_event_scope';
  if ('code' in error && ['23514', '23502', '22P02'].includes(String(error.code)))
    return 'invalid_input';
  return 'retryable_error';
};
/** Web・MCPの専用境界で、内部例外を公開可能な結果だけへ変換する。 */
export function dateFirstFailure(error: unknown): Extract<DateFirstResult, { success: false }> {
  const code = errorCode(error);
  return {
    success: false,
    code,
    message: messages[code] ?? '保存できませんでした。内容を保持したまま再試行してください。',
  };
}
const value = async (db: PoolClient, sql: string, parameters: unknown[]) =>
  (await db.query<{ value: unknown }>(sql, parameters)).rows[0]?.value;

/** 公開トークンで解決したイベントだけを、内部項目を含めず取得する。 */
export async function readDateFirstEvent(publicToken: string) {
  const db = await authPool.connect();
  try {
    const result = await value(db, 'SELECT date_first.read_event($1) AS value', [publicToken]);
    return result === null || result === undefined ? null : dateFirstEventSchema.parse(result);
  } finally {
    db.release();
  }
}
/** 公開リンク内の編集対象を取得する。参加者IDを本人認証としては扱わない。 */
export async function readDateFirstAnswer(publicToken: string, participantId: string) {
  z.uuid().parse(participantId);
  const db = await authPool.connect();
  try {
    const result = await value(db, 'SELECT date_first.read_answer($1,$2) AS value', [
      publicToken,
      participantId,
    ]);
    return result === null || result === undefined ? null : dateFirstAnswerSchema.parse(result);
  } finally {
    db.release();
  }
}
/** 指定日付の回答者・コメント・全区間を公開範囲内の順序で取得する。 */
export async function readDateFirstDay(publicToken: string, dayId: string) {
  z.uuid().parse(dayId);
  const db = await authPool.connect();
  try {
    return dayDetailsSchema.parse(
      await value(db, 'SELECT date_first.day_details($1,$2) AS value', [publicToken, dayId]),
    );
  } finally {
    db.release();
  }
}
async function execute(db: PoolClient, input: DateFirstCommand, userId?: string): Promise<unknown> {
  switch (input.operation) {
    case 'create':
      if (process.env.ENABLE_DATE_FIRST_SCHEDULING !== 'true') throw new Error('invalid_mode');
      return value(db, 'SELECT date_first.create_event($1,$2::jsonb) AS value', [
        input.requestId,
        JSON.stringify({
          title: input.title,
          description: input.description,
          days: [...input.days].sort(),
          base_ranges: input.baseRanges,
        }),
      ]);
    case 'addDays':
      return value(db, 'SELECT date_first.add_days($1,$2,$3::date[]) AS value', [
        input.token,
        input.revision,
        input.days,
      ]);
    case 'setTargets':
      return value(db, 'SELECT date_first.set_targets($1,$2,$3::uuid[]) AS value', [
        input.token,
        input.revision,
        input.dayIds,
      ]);
    case 'configure':
      return value(
        db,
        'SELECT date_first.add_slots($1,$2,$3,$4::jsonb,$5::uuid[],$6::uuid[]) AS value',
        [
          input.token,
          input.revision,
          input.dayId,
          JSON.stringify(input.ranges),
          input.retireIds,
          input.acknowledgedIds,
        ],
      );
    case 'finalize':
      return value(
        db,
        'SELECT date_first.finalize($1,$2,$3::uuid[],$4::uuid[],$5::uuid[]) AS value',
        [input.token, input.revision, input.dayIds, input.timeIds, input.acknowledgedIds],
      );
    case 'saveDays':
    case 'saveTimes': {
      const kind = input.operation === 'saveDays' ? 'days' : 'times';
      if (input.participantId) {
        if (input.revision === undefined) throw new Error('invalid_input');
        await value(db, 'SELECT date_first.save_answers($1,$2,$3,$4,$5::jsonb,$6,$7) AS value', [
          input.token,
          input.participantId,
          input.revision,
          kind,
          JSON.stringify(input.changes),
          input.expectedName !== undefined ? input.name : null,
          input.expectedName ?? null,
        ]);
        return { id: input.participantId };
      }
      if (!input.requestId || !input.name) throw new Error('invalid_input');
      return value(db, 'SELECT date_first.web_answer($1,$2,$3,$4::jsonb,$5) AS value', [
        input.token,
        input.requestId,
        kind,
        JSON.stringify(input.changes),
        input.name,
      ]);
    }
    case 'previewAnswerSchedule':
    case 'applyAnswerSchedule':
      if (!userId) throw new Error('not_linked');
      return input.operation === 'previewAnswerSchedule'
        ? value(db, 'SELECT date_first.answer_schedule_preview($1,$2,$3::uuid[]) AS value', [
            userId,
            input.token,
            input.slotIds,
          ])
        : value(db, 'SELECT date_first.apply_answer_schedule($1,$2,$3::uuid[],$4) AS value', [
            userId,
            input.token,
            input.slotIds,
            input.fingerprint,
          ]);
    case 'previewSync':
    case 'applySync':
      if (!userId) throw new Error('not_linked');
      return input.operation === 'previewSync'
        ? value(db, 'SELECT date_first.sync_preview($1,$2) AS value', [userId, input.token])
        : value(db, 'SELECT date_first.apply_sync($1,$2,$3,$4::uuid[]) AS value', [
            userId,
            input.token,
            input.fingerprint,
            input.acknowledgedIds,
          ]);
  }
}

/** Webと本人MCPで共用する保存境界。失敗はトランザクション全体を戻して返す。 */
export async function executeDateFirst(
  rawInput: unknown,
  userId?: string,
): Promise<DateFirstResult> {
  const parsed = dateFirstCommandSchema.safeParse(rawInput);
  if (!parsed.success)
    return {
      success: false,
      code: 'invalid_input',
      message: parsed.error.issues[0]?.message ?? messages.invalid_input,
    };
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > 768 * 1024)
    return { success: false, code: 'limit_exceeded', message: messages.limit_exceeded };
  try {
    const result = await runDateFirstTransaction(
      (db) => execute(db, parsed.data, userId),
      parsed.data.operation === 'applySync' || parsed.data.operation === 'applyAnswerSchedule'
        ? 'serializable'
        : 'default',
    );
    return { success: true, value: result };
  } catch (error) {
    return dateFirstFailure(error);
  }
}

/**
 * 日付先行型のWeb・MCPで接続、タイムアウト、再試行、解放を揃える。
 * 再試行時は処理全体を呼び直すため、コールバック内ではDB以外の副作用を起こさない。
 */
export async function runDateFirstTransaction<T>(
  operation: (db: PoolClient) => Promise<T>,
  isolation: 'default' | 'serializable' = 'default',
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let db: PoolClient | undefined;
    let discard = false;
    try {
      db = await authPool.connect();
      await db.query(isolation === 'serializable' ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN');
      await db.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s'");
      const result = await operation(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      if (db) {
        try {
          await db.query('ROLLBACK');
        } catch {
          // 未完了のトランザクションや切断済み接続をプールへ戻さない。
          discard = true;
        }
      }
      const retryable =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['40001', '40P01'].includes(String(error.code));
      if (retryable && attempt < 2) continue;
      throw error;
    } finally {
      if (discard) db?.release(true);
      else db?.release();
    }
  }
}
