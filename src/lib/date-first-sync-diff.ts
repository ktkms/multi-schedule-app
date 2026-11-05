import type { DateFirstAnswer, DateFirstSyncPreview } from './date-first-schema';

/** WebとMCPの反映確認で、記号・区間・三値回答の実際の変更だけを同じ基準で取り出す。 */
export function getDateFirstSyncChanges(
  answer: DateFirstAnswer | null,
  preview: DateFirstSyncPreview | null,
): Pick<DateFirstSyncPreview, 'days' | 'times'> {
  if (!preview) return { days: [], times: [] };
  const currentDays = new Map(answer?.days.map((day) => [day.id, day]));
  const currentTimes = new Map(answer?.times.map((time) => [time.id, time.availability]));
  return {
    days: preview.days.filter((change) => {
      const current = currentDays.get(change.id);
      const intervals = current?.intervals ?? [];
      return (
        (current?.status ?? null) !== change.status ||
        intervals.length !== change.intervals.length ||
        intervals.some(
          ([start, end], i) => start !== change.intervals[i][0] || end !== change.intervals[i][1],
        )
      );
    }),
    times: preview.times.filter(
      (change) => (currentTimes.get(change.id) ?? null) !== change.availability,
    ),
  };
}
