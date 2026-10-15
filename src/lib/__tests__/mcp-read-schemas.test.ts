import { eventSearchInput, scheduleReadInput, readPeriod } from '@/lib/mcp/schemas';

describe('MCP検索・予定取得の入力', () => {
  it.each([
    { date_from: '2026-10-10' },
    { date_to: '2026-10-10' },
    { date_from: '2026-10-11', date_to: '2026-10-10' },
    { date_from: '2026-02-29', date_to: '2026-03-01' },
    { date_target: 'candidate' },
    {
      date_from: '2026-10-10',
      date_to: '2026-10-10',
      date_target: 'finalized',
      is_finalized: false,
    },
    { limit: 0 },
    { limit: 101 },
    { offset: -1 },
    { query: '  ' },
    { user_id: 'other' },
  ])('不正な検索条件を拒否する: %j', (args) => {
    expect(eventSearchInput.safeParse(args).success).toBe(false);
  });
  it('フィルタ省略・同日・旧トークンと独立した検索条件を受け付ける', () => {
    expect(eventSearchInput.parse({})).toEqual({ offset: 0, limit: 100 });
    expect(
      eventSearchInput.parse({ date_from: '2028-02-29', date_to: '2028-02-29', query: ' 打合せ ' })
        .query,
    ).toBe('打合せ');
  });
  it.each([
    {},
    { week_start: '9999-12-30' },
    { week_start: '2026-02-29' },
    { week_start: '2026-10-10', date_from: '2026-10-10', date_to: '2026-10-10' },
    { date_from: '2026-10-01', date_to: '2026-11-01' },
    { date_from: '2026-10-01' },
    { week_start: '2026-10-10', user_id: 'other' },
  ])('不正な予定取得条件を拒否する: %j', (args) => {
    expect(scheduleReadInput.safeParse(args).success).toBe(false);
  });
  it('31日間と既存の7日間指定を維持する', () => {
    expect(
      scheduleReadInput.safeParse({ date_from: '2026-10-01', date_to: '2026-10-31' }).success,
    ).toBe(true);
    expect(
      scheduleReadInput.safeParse({ week_start: '2026-10-10', availability: false }).success,
    ).toBe(true);
  });
  it('日本時間の壁時計表現で終了日の翌日まで検索する', () => {
    expect(readPeriod('2026-12-31')).toEqual({
      start: '2026-12-31T00:00:00Z',
      end: '2027-01-01T00:00:00.000Z',
    });
    expect(readPeriod('2028-02-29')).toEqual({
      start: '2028-02-29T00:00:00Z',
      end: '2028-03-01T00:00:00.000Z',
    });
    expect(readPeriod('2026-10-10', '2026-10-10', 7).end).toBe('2026-10-17T00:00:00.000Z');
  });
});
