import 'server-only';
import { authPool } from './auth';
import {
  dateFirstAnswerSchema,
  dateFirstSyncPreviewSchema,
  type DateFirstSyncPreview,
} from './date-first-schema';
import { dateFirstFailure, executeDateFirst } from './date-first-service';
import { getDateFirstSyncChanges } from './date-first-sync-diff';

export type DateFirstUserPreview = {
  eventId: string;
  publicToken: string;
  participantId?: string;
  title: string;
  isFinalized: boolean;
  status: 'ready' | 'requires_confirmation' | 'failed';
  changedDays: number;
  changedSlots: number;
  fingerprint?: string;
  clearedCommentIds: string[];
  days: DateFirstSyncPreview['days'];
  times: DateFirstSyncPreview['times'];
  message?: string;
};
export type DateFirstSyncConfirmation = {
  public_token: string;
  expected_revision: string;
  acknowledged_day_ids: string[];
};
export type DateFirstSyncResult = {
  public_token: string;
  scheduling_mode: string;
  changed_days: number;
  changed_slots: number;
  status: 'updated' | 'skipped' | 'failed' | 'requires_confirmation';
  expected_revision?: string;
  acknowledged_day_ids?: string[];
  code?: string;
  message?: string;
};

/** 認証済み本人の新方式だけを読み、変更予定をDBへ書かずに日付・時間の差分を返す。 */
export async function readDateFirstUserPreviews(
  userId: string,
  proposed: { start_time: string; end_time: string; availability: boolean }[] = [],
): Promise<DateFirstUserPreview[]> {
  const db = await authPool.connect();
  try {
    const { rows } = await db.query<{
      id: string;
      public_token: string;
      title: string;
      is_finalized: boolean;
    }>(
      `SELECT e.id,e.public_token,e.title,e.is_finalized
      FROM public.user_event_links l JOIN public.events e ON e.id=l.event_id
      WHERE l.user_id=$1 AND l.participant_id IS NOT NULL AND e.scheduling_mode='date_first'
        AND EXISTS(SELECT 1 FROM public.event_candidate_days c WHERE c.event_id=e.id AND c.local_date::timestamp+interval '30 hours'>now() AT TIME ZONE 'Asia/Tokyo') ORDER BY e.id`,
      [userId],
    );
    const events: DateFirstUserPreview[] = [];
    for (const event of rows) {
      const base = {
        eventId: event.id,
        publicToken: event.public_token,
        title: event.title,
        isFinalized: event.is_finalized,
      };
      try {
        const found = await db.query<{ value: unknown }>(
          'SELECT date_first.sync_preview($1,$2,$3::jsonb) AS value',
          [userId, event.public_token, JSON.stringify(proposed)],
        );
        const preview = dateFirstSyncPreviewSchema.parse(found.rows[0].value);
        const current = dateFirstAnswerSchema.parse(
          (
            await db.query<{ value: unknown }>('SELECT date_first.read_answer($1,$2) AS value', [
              event.public_token,
              preview.participant,
            ])
          ).rows[0].value,
        );
        const { days, times } = getDateFirstSyncChanges(current, preview);
        if (days.length + times.length === 0) continue;
        events.push({
          ...base,
          participantId: preview.participant,
          status: preview.cleared_comments.length ? 'requires_confirmation' : 'ready',
          changedDays: days.length,
          changedSlots: times.length,
          fingerprint: preview.fingerprint,
          clearedCommentIds: preview.cleared_comments,
          days,
          times,
        });
      } catch (error) {
        events.push({
          ...base,
          status: 'failed',
          changedDays: 0,
          changedSlots: 0,
          clearedCommentIds: [],
          days: [],
          times: [],
          message: dateFirstFailure(error).message,
        });
      }
    }
    return events;
  } finally {
    db.release();
  }
}

/** 予定保存後の反映をイベント単位で行い、コメント削除は確認した指紋・対象が一致するときだけ許可する。 */
export async function applyDateFirstUserPreviews(
  userId: string,
  allowFinalized: boolean,
  confirmations: DateFirstSyncConfirmation[] = [],
) {
  const previews = await readDateFirstUserPreviews(userId);
  const results: DateFirstSyncResult[] = [];
  for (const preview of previews) {
    const base = {
      public_token: preview.publicToken,
      scheduling_mode: 'date_first',
      changed_days: preview.changedDays,
      changed_slots: preview.changedSlots,
    };
    if (preview.isFinalized && !allowFinalized) {
      results.push({ ...base, status: 'skipped' });
      continue;
    }
    if (preview.status === 'failed') {
      results.push({ ...base, status: 'failed', message: preview.message });
      continue;
    }
    const confirmation = confirmations.find((item) => item.public_token === preview.publicToken);
    if (
      preview.status === 'requires_confirmation' &&
      (!confirmation ||
        confirmation.expected_revision !== preview.fingerprint ||
        JSON.stringify([...confirmation.acknowledged_day_ids].sort()) !==
          JSON.stringify([...preview.clearedCommentIds].sort()))
    ) {
      results.push({
        ...base,
        status: 'requires_confirmation',
        expected_revision: preview.fingerprint,
        acknowledged_day_ids: preview.clearedCommentIds,
      });
      continue;
    }
    const applied = await executeDateFirst(
      {
        operation: 'applySync',
        token: preview.publicToken,
        fingerprint: preview.fingerprint,
        acknowledgedIds: preview.clearedCommentIds,
      },
      userId,
    );
    results.push({
      ...base,
      status: applied.success
        ? 'updated'
        : applied.code === 'requires_confirmation' || applied.code === 'stale_preview'
          ? 'requires_confirmation'
          : 'failed',
      ...(!applied.success ? { code: applied.code, message: applied.message } : {}),
    });
  }
  return results;
}
