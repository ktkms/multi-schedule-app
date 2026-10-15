import { z } from 'zod';

export const eventInput = z
  .object({
    public_token: z
      .string()
      .min(10)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/),
  })
  .strict();
export const answerInput = eventInput
  .extend({
    use_account_schedule: z.boolean().optional(),
    name: z.string().trim().min(1).max(100),
    comment: z.string().max(2000).nullable().optional(),
    availabilities: z
      .array(z.object({ event_date_id: z.uuid(), availability: z.boolean() }).strict())
      .max(1000),
  })
  .strict()
  .refine(
    (input) => input.availabilities.length > 0 || input.use_account_schedule === true,
    '回答する枠、または初回の予定補完を指定してください',
  )
  .refine(
    (input) =>
      new Set(input.availabilities.map((row) => row.event_date_id)).size ===
      input.availabilities.length,
    '候補日時が重複しています',
  );

// DaySynthの保存形式に合わせ、日本時間の壁時計時刻で指定する。
const localHour = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):00:00$/)
  .refine((value) => {
    const date = new Date(`${value}Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === value;
  }, '実在する日時を指定してください');

export const scheduleInput = z
  .object({
    start_time: localHour,
    end_time: localHour,
    availability: z.boolean(),
    allow_finalized: z.boolean().default(false),
  })
  .strict()
  .refine((input) => {
    const duration = Date.parse(`${input.end_time}Z`) - Date.parse(`${input.start_time}Z`);
    return duration > 0 && duration <= 7 * 24 * 60 * 60 * 1000;
  }, '期間は正の長さで7日以内にしてください');

const calendarDate = z.iso
  .date()
  .refine(
    (value) => value >= '0001-01-01' && value < '9999-12-31',
    '翌日まで表現できる実在する日付を指定してください',
  );
const periodFields = { date_from: calendarDate.optional(), date_to: calendarDate.optional() };
const validPeriod = (input: { date_from?: string; date_to?: string }) =>
  Boolean(input.date_from) === Boolean(input.date_to) &&
  (!input.date_from || !input.date_to || input.date_from <= input.date_to);

export const eventSearchInput = z
  .object({
    ...periodFields,
    date_target: z.enum(['effective', 'candidate', 'finalized']).optional(),
    query: z.string().trim().min(1).max(100).optional(),
    is_finalized: z.boolean().optional(),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict()
  .refine(validPeriod, '開始日と終了日を両方指定し、終了日を開始日以降にしてください')
  .refine(
    (input) => !input.date_target || Boolean(input.date_from),
    '検索対象の指定には期間が必要です',
  )
  .refine(
    (input) => input.date_target !== 'finalized' || input.is_finalized !== false,
    '確定日時の検索に未確定の条件は指定できません',
  );

export const scheduleReadInput = z
  .object({
    ...periodFields,
    week_start: calendarDate.optional(),
    availability: z.boolean().optional(),
  })
  .strict()
  .refine(validPeriod, '開始日と終了日を両方指定し、終了日を開始日以降にしてください')
  .refine(
    (input) => Boolean(input.week_start) !== Boolean(input.date_from),
    '週開始日または開始日と終了日の組を指定してください',
  )
  .refine(
    (input) => !input.week_start || input.week_start <= '9999-12-24',
    '7日間の終了日時を表現できる週開始日を指定してください',
  )
  .refine(
    (input) =>
      !input.date_from ||
      !input.date_to ||
      Date.parse(input.date_to + 'T00:00:00Z') - Date.parse(input.date_from + 'T00:00:00Z') <
        31 * 86400000,
    '予定の取得期間は終了日を含めて31日以内にしてください',
  );

/** 日本時間の壁時計日付を、既存の保存表現に合わせた半開区間へ変換する。 */
export function readPeriod(dateFrom: string, dateTo: string = dateFrom, daysAfter = 1) {
  const end = new Date(dateTo + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + daysAfter);
  return { start: dateFrom + 'T00:00:00Z', end: end.toISOString() };
}

export type EventSearchInput = z.infer<typeof eventSearchInput>;
export type ScheduleReadInput = z.infer<typeof scheduleReadInput>;
export type AnswerInput = z.infer<typeof answerInput>;
export type ScheduleInput = z.infer<typeof scheduleInput>;

export const answerReadInput = eventInput.extend({
  include_account_schedule: z.boolean().optional(),
});
export const answerScheduleInput = eventInput
  .extend({
    event_date_ids: z
      .array(z.uuid())
      .min(1)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length, '候補日時が重複しています'),
    mode: z.enum(['preview', 'apply']).default('preview'),
    expected_revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .refine(
    (input) => input.mode !== 'apply' || Boolean(input.expected_revision),
    '適用にはプレビューのexpected_revisionが必要です',
  );

export function proposedScheduleBlocks(input: ScheduleInput) {
  const end = Date.parse(`${input.end_time}Z`);
  const rows = [];
  for (let time = Date.parse(`${input.start_time}Z`); time < end; time += 3600000) {
    rows.push({
      start_time: new Date(time).toISOString(),
      end_time: new Date(time + 3600000).toISOString(),
      availability: input.availability,
    });
  }
  return rows;
}
