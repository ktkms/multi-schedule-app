import type { DateFirstAnswer, DateFirstSyncPreview } from '@/lib/date-first-schema';
import { getDateFirstSyncChanges } from '@/lib/date-first-sync-diff';

const answer: DateFirstAnswer = {
  id: 'participant',
  name: '本人',
  dayRevision: '2',
  timeRevision: '3',
  days: [
    {
      id: 'day-a',
      status: 'maybe',
      source: 'account',
      comment: '保持',
      intervals: [
        [630, 660],
        [700, 720],
      ],
    },
    { id: 'day-b', status: 'yes', source: 'manual', comment: null, intervals: [] },
  ],
  times: [
    { id: 'time-yes', availability: true, source: 'account' },
    { id: 'time-no', availability: false, source: 'account' },
    { id: 'time-null', availability: null, source: 'manual' },
  ],
};
const preview: DateFirstSyncPreview = {
  participant: answer.id,
  fingerprint: 'a'.repeat(64),
  cleared_comments: [],
  days: [
    { id: 'day-b', status: null, intervals: [] },
    {
      id: 'day-a',
      status: 'maybe',
      intervals: [
        [630, 660],
        [700, 720],
      ],
    },
    { id: 'day-new', status: 'maybe', intervals: [[1440, 1500]] },
    { id: 'day-empty', status: null, intervals: [] },
  ],
  times: [
    { id: 'time-no', availability: false },
    { id: 'time-yes', availability: null },
    { id: 'time-new', availability: false },
    { id: 'time-null', availability: false },
    { id: 'time-empty', availability: null },
  ],
};

it('日付・時間をIDで照合し、変更だけを提案順で返す。元の回答は変更しない', () => {
  const before = JSON.stringify({ answer, preview });
  expect(getDateFirstSyncChanges(answer, preview)).toEqual({
    days: [preview.days[0], preview.days[2]],
    times: [preview.times[1], preview.times[2], preview.times[3]],
  });
  expect(JSON.stringify({ answer, preview })).toBe(before);
});

it.each<{ intervals: [number, number][] }>([
  {
    intervals: [
      [630, 659],
      [700, 720],
    ],
  },
  { intervals: [[630, 720]] },
  { intervals: [] },
])('同じ△でも、端数・不連続区間の差を検出する: $intervals', ({ intervals }) => {
  const changed: DateFirstSyncPreview = {
    ...preview,
    days: [{ id: 'day-a', status: 'maybe', intervals }],
    times: [],
  };
  expect(getDateFirstSyncChanges(answer, changed).days).toEqual(changed.days);
});

it('未回答行なしと手動nullを不可へ変換しない。未取得のプレビューは空差分にする', () => {
  expect(getDateFirstSyncChanges(answer, null)).toEqual({ days: [], times: [] });
  expect(getDateFirstSyncChanges(null, preview)).toEqual({
    days: preview.days.filter((d) => d.status !== null),
    times: preview.times.filter((t) => t.availability !== null),
  });
  expect(
    getDateFirstSyncChanges(answer, {
      ...preview,
      days: [],
      times: [{ id: 'time-null', availability: null }],
    }),
  ).toEqual({ days: [], times: [] });
});
