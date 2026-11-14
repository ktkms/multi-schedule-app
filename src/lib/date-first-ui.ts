import { formatDayMinute } from './date-first-schema';

export type DayInterval = [number, number];

/** 不連続な参加可能時間は分離し、重なる区間と隣接区間だけを結合する。 */
export function mergeDayIntervals(input: readonly DayInterval[]): DayInterval[] {
  const result: DayInterval[] = [];
  for (const [start, end] of [...input].sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

/** 枠全体の被覆だけを可とし、端数の参加可能時間を拡大しない。 */
export function coversDayInterval(intervals: readonly DayInterval[], start: number, end: number) {
  return mergeDayIntervals(intervals).some(([lo, hi]) => lo <= start && hi >= end);
}

/** 明示操作した時間セルだけを加除し、他の端数・不連続区間は保持する。 */
export function paintDayInterval(
  input: readonly DayInterval[],
  start: number,
  end: number,
  selected: boolean,
): DayInterval[] {
  if (selected) return mergeDayIntervals([...input, [start, end]]);
  return input.flatMap(([lo, hi]): DayInterval[] => {
    if (hi <= start || lo >= end) return [[lo, hi]];
    return [
      ...(lo < start ? [[lo, start] as DayInterval] : []),
      ...(hi > end ? [[end, hi] as DayInterval] : []),
    ];
  });
}

/** 翌日を明示した壁時計表示を、候補日の当日0時からの分数へ変換する。 */
export function parseDayMinute(text: string): number | null {
  const match = /^(翌)?([0-9]{1,2}):([0-5][0-9])$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[2]),
    minute = Number(match[3]);
  if (hour > 24 || (hour === 24 && minute !== 0) || (match[1] && hour > 6)) return null;
  const value = (match[1] ? 1440 : 0) + hour * 60 + minute;
  return value <= 1800 ? value : null;
}

export function dayIntervalText(intervals: readonly DayInterval[]): string {
  return intervals
    .map(([start, end]) => `${formatDayMinute(start)}〜${formatDayMinute(end)}`)
    .join('、');
}

/** 日付だけの値を端末のタイムゾーンで前後させず表示する。 */
export function candidateDayLabel(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}
