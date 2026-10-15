import 'server-only';
import type { Database } from '@/lib/database.types';
import { authPool } from '@/lib/auth';
import {
  eventSearchInput,
  scheduleReadInput,
  readPeriod,
  type EventSearchInput,
  type ScheduleReadInput,
} from './schemas';

type EventRow = Database['public']['Tables']['events']['Row'];
type EventSummary = Pick<EventRow, 'title' | 'public_token' | 'is_finalized'>;
type EventDate = Pick<
  Database['public']['Tables']['event_dates']['Row'],
  'id' | 'start_time' | 'end_time'
>;
type ScheduleBlock = Omit<Database['public']['Tables']['user_schedule_blocks']['Row'], 'user_id'>;

// 現行形式が空の場合だけ旧形式を使い、別イベントの候補枠は参照しない。
const finalizedDate = `e.is_finalized AND (
  EXISTS (SELECT 1 FROM public.finalized_dates f WHERE f.event_id = e.id AND f.event_date_id = d.id)
  OR (NOT EXISTS (SELECT 1 FROM public.finalized_dates f WHERE f.event_id = e.id)
      AND d.id = e.final_date_id))`;
const dateJson = `jsonb_build_object('id', d.id,
  'start_time', to_char(d.start_time, 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z',
  'end_time', to_char(d.end_time, 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z')`;

/** 本人への紐づきと検索条件をDBで適用し、日時枠ではなくイベント単位でページ分割する。 */
export async function listMyEvents(userId: string, rawInput: EventSearchInput) {
  const input = eventSearchInput.parse(rawInput);
  const period =
    input.date_from && input.date_to ? readPeriod(input.date_from, input.date_to) : null;
  const target = input.date_target ?? 'effective';
  const db = await authPool.connect();
  try {
    const { rows } = await db.query<EventSummary & { matched_dates?: EventDate[] }>(
      `
      SELECT e.title, e.public_token, e.is_finalized ${period ? ', matches.matched_dates' : ''}
      FROM public.user_event_links l JOIN public.events e ON e.id = l.event_id
      ${
        period
          ? `JOIN LATERAL (
        SELECT jsonb_agg(x.value ORDER BY x.start_time, x.end_time, x.id) AS matched_dates,
               min(x.start_time) AS first_start
        FROM (SELECT d.id, d.start_time, d.end_time, ${dateJson} AS value
          FROM public.event_dates d WHERE d.event_id = e.id
            AND d.start_time < $5::timestamp AND d.end_time > $4::timestamp
            AND ($6 = 'candidate' OR ($6 = 'effective' AND NOT e.is_finalized) OR (${finalizedDate}))
          ORDER BY d.start_time, d.end_time, d.id LIMIT 4) x
        ) matches ON matches.first_start IS NOT NULL`
          : ''
      }
      WHERE l.user_id = $1 AND ($2::text IS NULL OR e.title ILIKE $2 ESCAPE '\\')
        AND ($3::boolean IS NULL OR e.is_finalized = $3)
      ORDER BY ${period ? 'matches.first_start, ' : ''}l.id
      LIMIT $${period ? 7 : 4} OFFSET $${period ? 8 : 5}`,
      [
        userId,
        input.query ? '%' + input.query.replace(/[\\%_]/g, '\\$&') + '%' : null,
        input.is_finalized ?? null,
        ...(period ? [period.start, period.end, target] : []),
        input.limit + 1,
        input.offset,
      ],
    );
    return {
      events: rows.slice(0, input.limit).map((row) =>
        period
          ? {
              ...row,
              matched_date_target:
                target === 'effective' ? (row.is_finalized ? 'finalized' : 'candidate') : target,
              matched_dates: row.matched_dates?.slice(0, 3) ?? [],
              matched_dates_truncated: (row.matched_dates?.length ?? 0) > 3,
            }
          : row,
      ),
      next_offset: rows.length > input.limit ? input.offset + input.limit : null,
      ...(period ? { date_target: target, time_zone: 'Asia/Tokyo' } : {}),
    };
  } finally {
    db.release();
  }
}

/** 予定未登録の時間を可と推測せず、指定期間に重なる本人の登録済みブロックを返す。 */
export async function readMySchedule(userId: string, rawInput: ScheduleReadInput) {
  const input = scheduleReadInput.parse(rawInput);
  const period = input.week_start
    ? readPeriod(input.week_start, input.week_start, 7)
    : readPeriod(input.date_from!, input.date_to!);
  const db = await authPool.connect();
  try {
    const { rows } = await db.query<ScheduleBlock>(
      `
      SELECT id, to_char(start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS start_time,
        to_char(end_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS end_time,
        availability, source, event_id,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS updated_at
      FROM public.user_schedule_blocks
      WHERE user_id = $1 AND start_time < $3::timestamptz AND end_time > $2::timestamptz
        AND ($4::boolean IS NULL OR availability = $4)
      ORDER BY start_time, end_time, id`,
      [userId, period.start, period.end, input.availability ?? null],
    );
    return { blocks: rows, time_zone: 'Asia/Tokyo' };
  } finally {
    db.release();
  }
}

/** 候補日時と確定日時を同じ問い合わせで取得し、旧形式の確定日時との互換性も維持する。 */
export async function readEventDates(publicToken: string) {
  const db = await authPool.connect();
  try {
    const { rows } = await db.query<
      Pick<EventRow, 'id' | 'title' | 'description' | 'public_token' | 'is_finalized'> & {
        dates: EventDate[];
        finalized_dates: EventDate[];
      }
    >(
      `SELECT e.id, e.title, e.description, e.public_token, e.is_finalized,
      COALESCE(jsonb_agg(${dateJson} ORDER BY d.start_time, d.end_time, d.id)
        FILTER (WHERE d.id IS NOT NULL), '[]'::jsonb) AS dates,
      COALESCE(jsonb_agg(${dateJson} ORDER BY d.start_time, d.end_time, d.id)
        FILTER (WHERE d.id IS NOT NULL AND (${finalizedDate})), '[]'::jsonb) AS finalized_dates
      FROM public.events e LEFT JOIN public.event_dates d ON d.event_id = e.id
      WHERE e.public_token = $1 GROUP BY e.id`,
      [publicToken],
    );
    return rows[0] ? { ...rows[0], time_zone: 'Asia/Tokyo' } : null;
  } finally {
    db.release();
  }
}
