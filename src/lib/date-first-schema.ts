import { z } from 'zod';

const text = (max: number) =>
  z.string().refine((value) => Array.from(value).length <= max, '文字数の上限を超えています');
const name = z
  .string()
  .transform((value) => value.trim())
  .pipe(text(100))
  .refine(Boolean, '名前を入力してください');
const token = z
  .string()
  .min(10)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/);
export const revisionSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => BigInt(value) <= BigInt('9223372036854775807'), '更新番号が不正です');
export const intervalSchema = z
  .tuple([z.number().int().min(0), z.number().int().max(1800)])
  .refine(([start, end]) => start < end, '終了を開始より後にしてください');
const intervals = z.array(intervalSchema).max(900);
const date = z.iso.date().refine((value) => value >= '0001-01-01' && value < '9999-12-31');
const ids = z
  .array(z.uuid())
  .max(3000)
  .refine((value) => new Set(value).size === value.length);
export const dayChangeSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['yes', 'maybe', 'no']).nullable().optional(),
    comment: text(2000).nullable().optional(),
    intervals: intervals.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined || value.comment !== undefined || value.intervals !== undefined,
  );
const timeChange = z.object({ id: z.uuid(), availability: z.boolean().nullable() }).strict();
const base = { token };
const save = {
  ...base,
  participantId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  name: name.optional(),
  expectedName: name.optional(),
  revision: revisionSchema.optional(),
};
export const dateFirstCommandSchema = z
  .discriminatedUnion('operation', [
    z
      .object({
        operation: z.literal('create'),
        requestId: z.uuid(),
        title: z
          .string()
          .transform((value) => value.trim())
          .pipe(text(200))
          .refine(Boolean, 'タイトルを入力してください'),
        description: text(5000).default(''),
        days: z
          .array(date)
          .min(1)
          .max(90)
          .refine((value) => new Set(value).size === value.length),
        baseRanges: intervals.min(1).default([[600, 1320]]),
      })
      .strict(),
    z
      .object({
        operation: z.literal('addDays'),
        ...base,
        revision: revisionSchema,
        days: z
          .array(date)
          .min(1)
          .max(90)
          .refine((value) => new Set(value).size === value.length),
      })
      .strict(),
    z
      .object({
        operation: z.literal('saveDays'),
        ...save,
        changes: z.array(dayChangeSchema).max(90),
      })
      .strict(),
    z
      .object({
        operation: z.literal('saveTimes'),
        ...save,
        changes: z.array(timeChange).max(3000),
      })
      .strict(),
    z
      .object({
        operation: z.literal('setTargets'),
        ...base,
        revision: revisionSchema,
        dayIds: ids.refine((value) => value.length <= 90),
      })
      .strict(),
    z
      .object({
        operation: z.literal('configure'),
        ...base,
        revision: revisionSchema,
        dayId: z.uuid(),
        ranges: z.array(intervalSchema).max(3000),
        retireIds: ids.default([]),
        acknowledgedIds: ids.default([]),
      })
      .strict(),
    z
      .object({
        operation: z.literal('finalize'),
        ...base,
        revision: revisionSchema,
        dayIds: ids.refine((value) => value.length <= 90),
        timeIds: ids,
        acknowledgedIds: ids.default([]),
      })
      .strict(),
    z
      .object({ operation: z.literal('previewAnswerSchedule'), ...base, slotIds: ids.min(1) })
      .strict(),
    z
      .object({
        operation: z.literal('applyAnswerSchedule'),
        ...base,
        slotIds: ids.min(1),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    z.object({ operation: z.literal('previewSync'), ...base }).strict(),
    z
      .object({
        operation: z.literal('applySync'),
        ...base,
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        acknowledgedIds: ids.default([]),
      })
      .strict(),
  ])
  .superRefine((input, context) => {
    if (input.operation !== 'saveDays' && input.operation !== 'saveTimes') return;
    const invalidTarget = input.participantId
      ? input.requestId !== undefined ||
        input.revision === undefined ||
        (input.name === undefined) !== (input.expectedName === undefined)
      : input.requestId === undefined ||
        input.name === undefined ||
        input.revision !== undefined ||
        input.expectedName !== undefined;
    if (
      invalidTarget ||
      new Set(input.changes.map((change) => change.id)).size !== input.changes.length
    ) {
      context.addIssue({
        code: 'custom',
        message: '新規登録と既存回答の編集を区別し、対象を重複させず指定してください。',
      });
    }
  });
export type DateFirstCommand = z.infer<typeof dateFirstCommandSchema>;
const count = z.number().int().nonnegative();
export const dateFirstEventSchema = z.object({
  event: z.object({
    id: z.uuid(),
    title: z.string(),
    description: z.string().nullable(),
    token,
    stage: z.enum(['days', 'times']),
    revision: revisionSchema,
    baseRanges: intervals,
  }),
  participants: z.array(z.object({ id: z.uuid(), name: z.string() })),
  days: z.array(
    z.object({
      id: z.uuid(),
      date,
      confirmed: z.boolean(),
      target: z.boolean(),
      yes: count,
      maybe: count,
      no: count,
      unanswered: count,
      hasComment: z.boolean().optional(),
    }),
  ),
  slots: z.array(
    z.object({
      id: z.uuid(),
      dayId: z.uuid(),
      start: z.number().int(),
      end: z.number().int(),
      finalized: z.boolean(),
      yes: count,
      no: count,
      unanswered: count,
    }),
  ),
});
export type DateFirstEvent = z.infer<typeof dateFirstEventSchema>;
export const dateFirstAnswerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  dayRevision: revisionSchema,
  timeRevision: revisionSchema,
  days: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(['yes', 'maybe', 'no']).nullable(),
      source: z.enum(['manual', 'account']),
      comment: z.string().nullable(),
      intervals,
    }),
  ),
  times: z.array(
    z.object({
      id: z.uuid(),
      availability: z.boolean().nullable(),
      source: z.enum(['manual', 'account']),
    }),
  ),
});
export type DateFirstAnswer = z.infer<typeof dateFirstAnswerSchema>;
export const dayDetailsSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(['yes', 'maybe', 'no']).nullable(),
    comment: z.string().nullable(),
    intervals,
  }),
);
export type DayDetails = z.infer<typeof dayDetailsSchema>;
export const dateFirstSyncPreviewSchema = z.object({
  participant: z.uuid(),
  days: z.array(
    z.object({ id: z.uuid(), status: z.enum(['yes', 'maybe', 'no']).nullable(), intervals }),
  ),
  times: z.array(z.object({ id: z.uuid(), availability: z.boolean().nullable() })),
  cleared_comments: z.array(z.uuid()),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DateFirstSyncPreview = z.infer<typeof dateFirstSyncPreviewSchema>;
const scheduleBlock = z.object({
  start_time: z.string(),
  end_time: z.string(),
  availability: z.boolean(),
});
export const dateFirstAnswerSchedulePlanSchema = z.object({
  changes: z.array(scheduleBlock),
  preserved: z.array(scheduleBlock.extend({ source: z.string(), event_id: z.uuid().nullable() })),
  overwritten: z.array(
    scheduleBlock.extend({ id: z.uuid(), source: z.string(), event_id: z.uuid().nullable() }),
  ),
  unanswered_ids: z.array(z.uuid()),
  expected_revision: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DateFirstAnswerSchedulePlan = z.infer<typeof dateFirstAnswerSchedulePlanSchema>;

/** 当日0時からの分数を、翌日と区別できる表示にする。 */
export function formatDayMinute(value: number): string {
  if (value === 1440) return '24:00';
  const minutes = value % 1440;
  return `${value > 1440 ? '翌' : ''}${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
