import {
  coversDayInterval,
  mergeDayIntervals,
  paintDayInterval,
  parseDayMinute,
} from '@/lib/date-first-ui';
import {
  dateFirstCalendarEntries,
  dateFirstGoogleUrl,
  dateFirstIcs,
} from '@/lib/date-first-calendar';
import type { DateFirstEvent } from '@/lib/date-first-schema';

it('不連続・端数区間を保持し、部分重複を全枠可へ拡大しない', () => {
  expect(
    mergeDayIntervals([
      [630, 690],
      [690, 720],
      [800, 810],
    ]),
  ).toEqual([
    [630, 720],
    [800, 810],
  ]);
  expect(coversDayInterval([[630, 690]], 600, 660)).toBe(false);
  expect(
    paintDayInterval(
      [
        [630, 690],
        [800, 810],
      ],
      660,
      720,
      false,
    ),
  ).toEqual([
    [630, 660],
    [800, 810],
  ]);
  expect(paintDayInterval([[630, 690]], 600, 660, true)).toEqual([[600, 690]]);
});
it('当日から翌6時までを表現し、前日・25時・翌朝上限超過を受け付けない', () => {
  expect(parseDayMinute('24:00')).toBe(1440);
  expect(parseDayMinute('翌0:30')).toBe(1470);
  expect(parseDayMinute('翌6:00')).toBe(1800);
  for (const value of ['-1:00', '25:00', '翌6:01', '24:01', '翌24:00'])
    expect(parseDayMinute(value)).toBeNull();
});
const data: DateFirstEvent = {
  event: {
    id: 'event',
    token: 'public-token-123',
    title: '会食',
    description: '説明',
    revision: '1',
    stage: 'times',
    baseRanges: [],
  },
  participants: [],
  days: [
    {
      id: 'day1',
      date: '2026-12-31',
      confirmed: true,
      target: true,
      yes: 0,
      maybe: 0,
      no: 0,
      unanswered: 0,
    },
    {
      id: 'day2',
      date: '2027-01-01',
      confirmed: true,
      target: true,
      yes: 0,
      maybe: 0,
      no: 0,
      unanswered: 0,
    },
  ],
  slots: [
    {
      id: 'slot1',
      dayId: 'day1',
      start: 1320,
      end: 1560,
      finalized: true,
      yes: 0,
      no: 0,
      unanswered: 0,
    },
  ],
};
it('日時付きと時刻未定を混在出力し、同じ親日付を重ねず安定UIDを分ける', () => {
  const entries = dateFirstCalendarEntries(data);
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({
    id: 'slot1',
    start: '2026-12-31T22:00:00',
    end: '2027-01-01T02:00:00',
    allDay: false,
  });
  expect(entries[1]).toMatchObject({
    id: 'day2',
    start: '2027-01-01',
    end: '2027-01-02',
    allDay: true,
    title: '会食（時間未定）',
  });
  const ics = dateFirstIcs(entries, '改行\r\n文字,;\\');
  expect(ics).toContain('DTSTART:20261231T130000Z\r\nDTEND:20261231T170000Z');
  expect(ics).toContain(
    'DTSTART;VALUE=DATE:20270101\r\nDTEND;VALUE=DATE:20270102\r\nTRANSP:TRANSPARENT',
  );
  expect(ics).toContain('DESCRIPTION:改行\\n文字\\,\\;\\\\');
  const changed = dateFirstCalendarEntries({ ...data, slots: [] });
  expect(changed[0].uid).not.toBe(entries[0].uid);
  expect(dateFirstCalendarEntries(data)[0].uid).toBe(entries[0].uid);
  expect(new URL(dateFirstGoogleUrl(entries[1], null)).searchParams.get('dates')).toBe(
    '20270101/20270102',
  );
  expect(new URL(dateFirstGoogleUrl(entries[0], null)).searchParams.get('dates')).toBe(
    '20261231T220000/20270101T020000',
  );
});
it('日本語の長いICS行をUTF-8の文字境界で75オクテット以下に折り返す', () => {
  const entry = { ...dateFirstCalendarEntries(data)[0], title: '😀日本語'.repeat(100) };
  const ics = dateFirstIcs([entry], null);
  for (const line of ics.split('\r\n'))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${entry.title}`);
});
