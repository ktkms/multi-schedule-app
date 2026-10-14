import {
  formatDate,
  formatDateTime,
  formatDateWithDay,
  formatDateTimeWithDay,
  formatTime,
  formatJapaneseDate,
  formatJapaneseDateTime,
  generateUuid,
  addEventToHistory,
  getEventHistory,
  removeEventFromHistory,
  clearEventHistory,
  fetchAllPaginated,
  fetchAllPaginatedWithOrder,
  SupabaseQueryInterface,
} from '../utils';

interface MockQuery extends SupabaseQueryInterface {
  _pages: Array<{ data: number[]; error: null }>;
  _call: number;
}

function createOrderFirstQuery(pages: Array<{ data: number[]; error: null }>): MockQuery {
  const query: Partial<MockQuery> = {
    _pages: pages,
    _call: 0,
    order: jest.fn(function (this: MockQuery) {
      return this;
    }) as unknown as (column: string, options?: { ascending: boolean }) => SupabaseQueryInterface,
    range: jest.fn(function (this: MockQuery) {
      const res = this._pages[this._call++] || { data: [], error: null };
      return Promise.resolve(res);
    }) as unknown as (from: number, to: number) => SupabaseQueryInterface,
  };
  return query as MockQuery;
}

beforeEach(() => {
  localStorage.clear();
});

describe('日付フォーマットユーティリティ', () => {
  const date = new Date('2025-05-10T10:30:00');
  it('formatDate系関数', () => {
    expect(formatDate(date)).toBe('2025/05/10');
    expect(formatDateTime(date)).toBe('2025/05/10 10:30');
    expect(formatDateWithDay(date)).toMatch(/5\/10 \(.+\)/);
    expect(formatDateTimeWithDay(date)).toMatch(/5\/10 \(.+\) 10:30/);
    expect(formatTime(date)).toBe('10:30');
    expect(formatJapaneseDate(date)).toMatch(/2025年5月10日/);
    expect(formatJapaneseDateTime(date)).toMatch(/2025年5月10日.*10:30/);
  });

  it('UUID生成', () => {
    const id = generateUuid();
    expect(id).toMatch(/[0-9a-f]{8}-/);
  });
});

describe('ローカルストレージ履歴操作', () => {
  const item = {
    id: '1',
    title: 'test',
    createdAt: new Date().toISOString(),
    isCreatedByMe: false,
  };
  it('追加・取得・削除・クリアが動作する', () => {
    addEventToHistory(item);
    let history = getEventHistory();
    expect(history.length).toBe(1);
    removeEventFromHistory('1');
    history = getEventHistory();
    expect(history.length).toBe(0);
    addEventToHistory(item);
    clearEventHistory();
    expect(getEventHistory().length).toBe(0);
  });
});

describe('Supabaseページネーションユーティリティ', () => {
  it('fetchAllPaginated', async () => {
    const query = createOrderFirstQuery([
      { data: [1, 2], error: null },
      { data: [3], error: null },
      { data: [], error: null },
    ]);
    const result = await fetchAllPaginated<number>(query, 2);
    expect(result).toEqual([1, 2, 3]);
    expect(query.range).toHaveBeenCalledTimes(2);
  });

  it('fetchAllPaginatedWithOrder', async () => {
    const query = createOrderFirstQuery([
      { data: [5], error: null },
      { data: [], error: null },
    ]);
    const result = await fetchAllPaginatedWithOrder<number>(query, 'id', { ascending: false }, 1);
    expect(result).toEqual([5]);
    expect(query.order).toHaveBeenCalledWith('id', { ascending: false });
  });
});
