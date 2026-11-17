import type { DateFirstEvent } from './date-first-schema';

export type DateFirstCalendarEntry = {
  id: string;
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
};
const compact = (value: string) => value.replace(/[-:]/g, '');
const shift = (date: string, minutes: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60000).toISOString().slice(0, 19);

/** 確定日時がある日は日時だけ、それ以外の確定日は時刻未定として出力する。 */
export function dateFirstCalendarEntries(data: DateFirstEvent): DateFirstCalendarEntry[] {
  return data.days
    .filter((day) => day.confirmed)
    .flatMap((day): DateFirstCalendarEntry[] => {
      const slots = data.slots.filter((slot) => slot.dayId === day.id && slot.finalized);
      return slots.length
        ? slots.map((slot) => ({
            id: slot.id,
            uid: `${data.event.id}-time-${slot.id}@daysynth.k-tkms.com`,
            title: data.event.title,
            start: shift(day.date, slot.start),
            end: shift(day.date, slot.end),
            allDay: false,
          }))
        : [
            {
              id: day.id,
              uid: `${data.event.id}-day-${day.id}@daysynth.k-tkms.com`,
              title: `${data.event.title}（時間未定）`,
              start: day.date,
              end: shift(day.date, 1440).slice(0, 10),
              allDay: true,
            },
          ];
    });
}
const escape = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
/** RFC 5545の75オクテット折返しで、UTF-8の文字の途中を切らない。 */
function fold(line: string): string {
  let result = '',
    current = '',
    bytes = 0;
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (bytes + length > 75) {
      result += current + '\r\n';
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += length;
  }
  return result + current;
}
const timedIcs = (wallClock: string) =>
  compact(new Date(Date.parse(wallClock + 'Z') - 9 * 3600000).toISOString().slice(0, 19)) + 'Z';

/** 時刻未定はDATEとTRANSPARENTを使い、仮の時刻や競合を作らない。 */
export function dateFirstIcs(
  entries: DateFirstCalendarEntry[],
  description: string | null,
  now = new Date(),
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DaySynth//DateFirst//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const entry of entries)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${entry.uid}`,
      `DTSTAMP:${compact(now.toISOString().slice(0, 19))}Z`,
      entry.allDay
        ? `DTSTART;VALUE=DATE:${compact(entry.start)}`
        : `DTSTART:${timedIcs(entry.start)}`,
      entry.allDay ? `DTEND;VALUE=DATE:${compact(entry.end)}` : `DTEND:${timedIcs(entry.end)}`,
      `TRANSP:${entry.allDay ? 'TRANSPARENT' : 'OPAQUE'}`,
      `SUMMARY:${escape(entry.title)}`,
      `DESCRIPTION:${escape(description ?? '')}`,
      'END:VEVENT',
    );
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Googleの追加画面へ日付または日本時間の壁時計時刻を渡す。保存は利用者が行う。 */
export function dateFirstGoogleUrl(
  entry: DateFirstCalendarEntry,
  description: string | null,
): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: entry.title,
    details: description ?? '',
    dates: `${compact(entry.start)}/${compact(entry.end)}`,
    ctz: 'Asia/Tokyo',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
