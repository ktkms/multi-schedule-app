import { buildAvailableDatesMessage, findAvailableDateRanges } from '../share-utils';

describe('buildAvailableDatesMessage', () => {
  const dates = [
    {
      id: 'd1',
      start_time: '2025-05-01T10:00:00',
      end_time: '2025-05-01T11:00:00',
    },
    {
      id: 'd2',
      start_time: '2025-05-02T12:00:00',
      end_time: '2025-05-02T13:00:00',
    },
  ];
  const availabilities = [
    { participant_id: 'p1', event_date_id: 'd1', availability: true },
    { participant_id: 'p2', event_date_id: 'd1', availability: true },
    { participant_id: 'p1', event_date_id: 'd2', availability: false },
    { participant_id: 'p2', event_date_id: 'd2', availability: true },
  ];

  it('参加人数2人、閾値2で1件のみ返す', () => {
    expect(buildAvailableDatesMessage(dates, availabilities, 2)).toBe(
      '[2人以上の共通日程]\n- 5月1日 10:00-11:00',
    );
  });

  it('閾値1なら2件返す', () => {
    expect(buildAvailableDatesMessage(dates, availabilities, 1)).toBe(
      '[1人以上の共通日程]\n- 5月1日 10:00-11:00\n- 5月2日 12:00-13:00',
    );
  });

  it('該当なしの場合は該当なしメッセージを返す', () => {
    expect(buildAvailableDatesMessage(dates, availabilities, 3)).toBe(
      '[3人以上の共通日程]\n該当する日程がありません',
    );
  });

  it('minCountが0以下の場合は空文字を返す', () => {
    expect(buildAvailableDatesMessage(dates, availabilities, 0)).toBe('');
    expect(buildAvailableDatesMessage(dates, availabilities, -1)).toBe('');
  });

  it('同じ日付の連続する時間帯をまとめる', () => {
    const multiDates = [
      {
        id: 'd1',
        start_time: '2025-05-01T10:00:00',
        end_time: '2025-05-01T11:00:00',
      },
      {
        id: 'd2',
        start_time: '2025-05-01T11:00:00',
        end_time: '2025-05-01T12:00:00',
      },
    ];
    const multiAvailabilities = [
      { participant_id: 'p1', event_date_id: 'd1', availability: true },
      { participant_id: 'p2', event_date_id: 'd1', availability: true },
      { participant_id: 'p1', event_date_id: 'd2', availability: true },
      { participant_id: 'p2', event_date_id: 'd2', availability: true },
    ];
    expect(buildAvailableDatesMessage(multiDates, multiAvailabilities, 2)).toBe(
      '[2人以上の共通日程]\n- 5月1日 10:00-12:00',
    );
  });

  it('間が空いた時間帯はまとめない', () => {
    const gapDates = [
      {
        id: 'd1',
        start_time: '2025-05-01T10:00:00',
        end_time: '2025-05-01T11:00:00',
      },
      {
        id: 'd2',
        start_time: '2025-05-01T12:00:00',
        end_time: '2025-05-01T13:00:00',
      },
    ];
    const gapAvailabilities = [
      { participant_id: 'p1', event_date_id: 'd1', availability: true },
      { participant_id: 'p2', event_date_id: 'd1', availability: true },
      { participant_id: 'p1', event_date_id: 'd2', availability: true },
      { participant_id: 'p2', event_date_id: 'd2', availability: true },
    ];
    expect(buildAvailableDatesMessage(gapDates, gapAvailabilities, 2)).toBe(
      '[2人以上の共通日程]\n- 5月1日 10:00-11:00, 12:00-13:00',
    );
  });
});

describe('連続候補の共有条件', () => {
  const dates = [10, 11, 12].map((hour, index) => ({
    id: `d${index}`,
    start_time: `2026-10-20T${hour}:00:00`,
    end_time: `2026-10-20T${hour + 1}:00:00`,
  }));
  const answers = (groups: string[][]) =>
    groups.flatMap((ids, index) =>
      ids.map((id) => ({
        participant_id: id,
        event_date_id: `d${index}`,
        availability: true,
      })),
    );
  const hours = (ranges: ReturnType<typeof findAvailableDateRanges>) =>
    ranges.map(({ start, end }) => [start.getHours(), end.getHours()]);

  it('参加者が入れ替わる枠を人数だけで結合しない', () => {
    expect(
      hours(
        findAvailableDateRanges(
          dates.slice(0, 2),
          answers([
            ['a', 'b'],
            ['b', 'c'],
          ]),
          2,
        ),
      ),
    ).toEqual([
      [10, 11],
      [11, 12],
    ]);
    expect(
      findAvailableDateRanges(
        dates.slice(0, 2),
        answers([
          ['a', 'b'],
          ['b', 'c'],
        ]),
        2,
        { durationMinutes: 120 },
      ),
    ).toEqual([]);
  });

  it('最長候補に含まれる短い候補を省く', () => {
    expect(
      hours(
        findAvailableDateRanges(
          dates,
          answers([
            ['a', 'b'],
            ['a', 'b'],
            ['a', 'b'],
          ]),
          2,
          { durationMinutes: 120 },
        ),
      ),
    ).toEqual([[10, 13]]);
  });

  it('重なる2つの候補を再結合しない', () => {
    expect(
      hours(
        findAvailableDateRanges(
          dates,
          answers([
            ['a', 'b'],
            ['a', 'b', 'c'],
            ['b', 'c'],
          ]),
          2,
          { durationMinutes: 120 },
        ),
      ),
    ).toEqual([
      [10, 12],
      [11, 13],
    ]);
  });

  it('必須参加者が全時間に参加できることを確認する', () => {
    const data = answers([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(
      findAvailableDateRanges(dates.slice(0, 2), data, 1, {
        durationMinutes: 120,
        requiredParticipantIds: ['a'],
      }),
    ).toEqual([]);
    expect(
      hours(
        findAvailableDateRanges(dates.slice(0, 2), data, 1, {
          durationMinutes: 120,
          requiredParticipantIds: ['b'],
        }),
      ),
    ).toEqual([[10, 12]]);
  });

  it('同じ参加者の重複回答を二重に数えない', () => {
    expect(findAvailableDateRanges(dates, answers([['a', 'a']]), 2)).toEqual([]);
  });

  it('順不同の候補を並べ替え、時間の隙間をまたがない', () => {
    expect(
      findAvailableDateRanges([dates[2], dates[0]], answers([['a'], [], ['a']]), 1, {
        durationMinutes: 120,
      }),
    ).toEqual([]);
  });

  it.each([NaN, Infinity, -1, 0, 1.5])('不正な人数 %s を拒否する', (minCount) => {
    expect(findAvailableDateRanges(dates, answers([['a']]), minCount)).toEqual([]);
  });

  it.each([NaN, Infinity, -1, 1.5])('不正な所要時間 %s を拒否する', (durationMinutes) => {
    expect(findAvailableDateRanges(dates, answers([['a']]), 1, { durationMinutes })).toEqual([]);
  });

  it('30分枠と長さが異なる枠を実際の経過時間で判定する', () => {
    const mixed = [
      { ...dates[0], end_time: '2026-10-20T10:30:00' },
      { ...dates[1], start_time: '2026-10-20T10:30:00' },
    ];
    expect(
      hours(findAvailableDateRanges(mixed, answers([['a'], ['a']]), 1, { durationMinutes: 120 })),
    ).toEqual([[10, 12]]);
  });

  it('日付またぎは終了日を明記し、Z付きの壁時計時刻を維持する', () => {
    const overnight = [
      { id: 'd0', start_time: '2026-10-20T23:00:00Z', end_time: '2026-10-21T01:00:00Z' },
    ];
    expect(
      buildAvailableDatesMessage(overnight, answers([['a']]), 1, { durationMinutes: 120 }),
    ).toBe('[1人以上の共通日程・連続120分以上]\n- 10月20日 23:00-10月21日 01:00');
  });

  it.each([
    ['2026-10-20T23:00:00Z', '2026-10-21T00:00:00Z', '10月20日 23:00-24:00'],
    ['2026-12-31T23:00:00Z', '2027-01-01T00:00:00Z', '12月31日 23:00-24:00'],
    ['2028-02-29T23:00:00Z', '2028-03-01T00:00:00Z', '2月29日 23:00-24:00'],
  ])('翌日0時の終了を24:00と表記する（%s）', (start_time, end_time, expected) => {
    const message = buildAvailableDatesMessage(
      [{ id: 'd0', start_time, end_time }],
      answers([['a']]),
      1,
    );
    expect(message).toContain(expected);
    expect(message).not.toContain('00:00');
  });

  it('2日後の0時は24:00に省略しない', () => {
    const message = buildAvailableDatesMessage(
      [{ id: 'd0', start_time: '2026-10-20T23:00:00', end_time: '2026-10-22T00:00:00' }],
      answers([['a']]),
      1,
    );
    expect(message).toContain('10月20日 23:00-10月22日 00:00');
  });

  it('別年の同じ月日を一つにまとめない', () => {
    const years = [2026, 2027].map((year, i) => ({
      ...dates[i],
      start_time: `${year}-10-20T10:00:00`,
      end_time: `${year}-10-20T11:00:00`,
    }));
    expect(buildAvailableDatesMessage(years, answers([['a'], ['a']]), 1)).toContain(
      '- 2027年10月20日',
    );
    expect(buildAvailableDatesMessage(years, answers([['a'], ['a']]), 1)).toContain(
      '- 2026年10月20日',
    );
  });
});
