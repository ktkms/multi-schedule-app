import { z } from 'zod';

export const eventInput = z
  .object({
    public_token: z
      .string()
      .min(10)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/)
      .describe('共有URLの/event/以下の公開トークン。URL全体やイベントのDB IDではない。'),
  })
  .strict();
export const answerInput = eventInput
  .extend({
    use_account_schedule: z
      .boolean()
      .optional()
      .describe('初回回答のみ、登録済み予定で補完する。予定が不明な省略枠は不可。'),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe(
        '回答者の表示名。既存回答の編集ではget_my_answerで取得した名前をそのまま指定する。',
      ),
    comment: z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .describe('回答コメント。省略は既存値保持、nullは削除。'),
    availabilities: z
      .array(
        z
          .object({
            event_date_id: z.uuid().describe('get_eventのdatesに含まれる候補日時ID。'),
            availability: z.boolean().describe('true=参加可、false=参加不可。'),
          })
          .strict(),
      )
      .max(1000)
      .describe(
        '手動で指定する可否。初回の予定補完で個別指定がなければ空配列。既存回答の編集では変更枠のみ。',
      ),
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
    start_time: localHour.describe('日本時間の開始時刻。YYYY-MM-DDTHH:00:00。'),
    end_time: localHour.describe('日本時間の終了時刻（排他的）。開始から最大7日。'),
    availability: z.boolean().describe('true=参加可、false=参加不可。'),
    allow_finalized: z
      .boolean()
      .default(false)
      .describe('確定済みイベントの回答への反映を明示的に許可する場合のみtrue。'),
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
const periodFields = {
  date_from: calendarDate.optional().describe('日本時間の開始日。date_toとセット。'),
  date_to: calendarDate.optional().describe('日本時間の終了日（当日を含む）。date_fromとセット。'),
};
const validPeriod = (input: { date_from?: string; date_to?: string }) =>
  Boolean(input.date_from) === Boolean(input.date_to) &&
  (!input.date_from || !input.date_to || input.date_from <= input.date_to);

export const eventSearchInput = z
  .object({
    ...periodFields,
    date_target: z
      .enum(['effective', 'candidate', 'finalized'])
      .optional()
      .describe(
        '期間指定時のみ。effective=未確定は候補、確定済みは確定日時。candidate=元の候補、finalized=確定日時のみ。',
      ),
    query: z.string().trim().min(1).max(100).optional().describe('イベント名の部分一致検索。'),
    is_finalized: z.boolean().optional().describe('true=確定済み、false=未確定。省略は両方。'),
    offset: z
      .number()
      .int()
      .min(0)
      .max(100000)
      .default(0)
      .describe('続きの検索には前回のnext_offsetを指定。'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(100)
      .describe('1ページのイベント数。続きも同じ値。'),
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
    week_start: calendarDate.optional().describe('指定日から7日間。date_from/date_toと併用不可。'),
    availability: z
      .boolean()
      .optional()
      .describe('true=登録済みの参加可、false=不可。省略は両方。'),
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
  include_account_schedule: z
    .boolean()
    .optional()
    .describe('trueで候補枠ごとの個人予定の判定を取得する。保存はしない。'),
});
export const answerScheduleInput = eventInput
  .extend({
    event_date_ids: z
      .array(z.uuid())
      .min(1)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length, '候補日時が重複しています')
      .describe(
        '本人が個人予定への反映を希望する候補日時ID。直前の編集で変更した枠を反映する場合は今回のanswered_date_idsから選ぶ。',
      ),
    mode: z
      .enum(['preview', 'apply'])
      .default('preview')
      .describe('preview=差分確認、apply=確認後に保存。'),
    expected_revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .describe('apply時に直前のpreview結果の値を指定する。'),
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
