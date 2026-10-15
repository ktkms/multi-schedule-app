export type ShareEventDate = {
  id: string;
  start_time: string;
  end_time: string;
  label?: string;
};

export type ShareAvailability = {
  participant_id: string;
  event_date_id: string;
  availability: boolean;
};

export type AvailableDatesOptions = {
  durationMinutes?: number;
  requiredParticipantIds?: string[];
};

/** 保存済みの壁時計時刻をUTC座標へ載せ、端末のタイムゾーンと夏時間を介さず比較する。 */
const toShareWallClockDate = (value: string): Date => {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  return new Date(match ? `${match[1]}T${match[2]}Z` : NaN);
};

/**
 * 同じ参加者が全時間を通して参加できる連続候補を求める。
 * 人数だけで隣接枠を結合せず、途中で参加者が入れ替わる候補は分離する。
 * 包含される短い候補は省くが、重なる候補を再結合しない。
 * 返すDateは壁時計時刻の比較用UTC座標であり、表示時もUTC系の取得メソッドを使う。
 */
export function findAvailableDateRanges(
  dates: ShareEventDate[],
  availabilities: ShareAvailability[],
  minCount: number,
  { durationMinutes = 0, requiredParticipantIds = [] }: AvailableDatesOptions = {},
): Array<{ start: Date; end: Date }> {
  if (
    !Number.isInteger(minCount) ||
    minCount < 1 ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 0
  )
    return [];

  const participantsByDate = new Map<string, Set<string>>();
  for (const answer of availabilities) {
    if (!answer.availability) continue;
    const participants = participantsByDate.get(answer.event_date_id) ?? new Set<string>();
    participants.add(answer.participant_id);
    participantsByDate.set(answer.event_date_id, participants);
  }
  const slots = dates
    .map((date) => ({
      start: toShareWallClockDate(date.start_time),
      end: toShareWallClockDate(date.end_time),
      participants: participantsByDate.get(date.id) ?? new Set<string>(),
    }))
    .filter(({ start, end }) => Number.isFinite(start.getTime()) && end > start)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const matches = (participants: Set<string>) =>
    participants.size >= minCount && requiredParticipantIds.every((id) => participants.has(id));
  const ranges: Array<{ start: Date; end: Date }> = [];

  for (let i = 0; i < slots.length; i++) {
    let common = slots[i].participants;
    if (!matches(common)) continue;
    const start = slots[i].start;
    let end = slots[i].end;
    for (let j = i + 1; j < slots.length; j++) {
      if (slots[j].start.getTime() !== end.getTime()) break;
      const nextCommon = new Set([...common].filter((id) => slots[j].participants.has(id)));
      if (!matches(nextCommon)) break;
      common = nextCommon;
      end = slots[j].end;
    }
    if (end.getTime() - start.getTime() < durationMinutes * 60_000) continue;
    const previous = ranges.at(-1);
    if (!previous || previous.end < end) ranges.push({ start, end });
  }
  return ranges;
}

const dateKey = (date: Date) =>
  `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
const timeLabel = (date: Date) =>
  `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;

/** 翌日ちょうど0時の終了だけを、開始日の24時として扱う。 */
const endsAtNextMidnight = (start: Date, end: Date) => {
  const nextMidnight = new Date(start);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  return nextMidnight.getTime() === end.getTime();
};

/** 指定条件で抽出した連続候補を、DaySynthの壁時計時刻で共有本文へ整形する。 */
export function buildAvailableDatesMessage(
  dates: ShareEventDate[],
  availabilities: ShareAvailability[],
  minCount: number,
  options: AvailableDatesOptions = {},
): string {
  if (!Number.isInteger(minCount) || minCount < 1) return '';
  const ranges = findAvailableDateRanges(dates, availabilities, minCount, options);
  const durationLabel = options.durationMinutes ? `・連続${options.durationMinutes}分以上` : '';
  const heading = `[${minCount}人以上の共通日程${durationLabel}]`;
  if (!ranges.length) return `${heading}\n該当する日程がありません`;

  const grouped = new Map<string, { date: Date; labels: string[] }>();
  const includeYear =
    new Set(
      ranges.flatMap(({ start, end }) =>
        endsAtNextMidnight(start, end)
          ? [start.getUTCFullYear()]
          : [start.getUTCFullYear(), end.getUTCFullYear()],
      ),
    ).size > 1;
  const dayLabel = (date: Date) =>
    `${includeYear ? `${date.getUTCFullYear()}年` : ''}${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  for (const { start, end } of ranges) {
    const group = grouped.get(dateKey(start)) ?? { date: start, labels: [] };
    const endLabel = endsAtNextMidnight(start, end)
      ? '24:00'
      : dateKey(start) === dateKey(end)
        ? timeLabel(end)
        : `${dayLabel(end)} ${timeLabel(end)}`;
    group.labels.push(`${timeLabel(start)}-${endLabel}`);
    grouped.set(dateKey(start), group);
  }
  return `${heading}\n${[...grouped.values()].map(({ date, labels }) => `- ${dayLabel(date)} ${labels.join(', ')}`).join('\n')}`;
}
