import { fetchAllPaginated, fetchAllPaginatedWithOrder, SupabaseQueryInterface } from '../utils';

function createQueryForFetchAllWithOrder(
  pages: Array<{ data: number[] | null; error: Error | null }>,
): SupabaseQueryInterface {
  let call = 0;
  return {
    order: jest.fn().mockReturnThis(),
    range: jest.fn(() => pages[call++] || { data: null, error: null }),
  } as unknown as SupabaseQueryInterface;
}

describe('fetchAllPaginated', () => {
  it('複数ページをまとめて取得できる', async () => {
    const query = createQueryForFetchAllWithOrder([
      { data: [1, 2], error: null },
      { data: [3], error: null },
    ]);
    const result = await fetchAllPaginated<number>(query, 2);
    expect(result).toEqual([1, 2, 3]);
    expect(query.range).toHaveBeenCalledTimes(2);
    expect(query.order).toHaveBeenCalledTimes(2);
  });

  it('エラー時は例外を投げる', async () => {
    const query = createQueryForFetchAllWithOrder([{ data: null, error: new Error('NG') }]);
    await expect(fetchAllPaginated<number>(query, 2)).rejects.toThrow('NG');
  });
});

describe('fetchAllPaginatedWithOrder', () => {
  it('順序指定付きでデータを取得できる', async () => {
    const query = createQueryForFetchAllWithOrder([
      { data: [1], error: null },
      { data: [2], error: null },
    ]);
    const result = await fetchAllPaginatedWithOrder<number>(
      query,
      'created_at',
      { ascending: false },
      1,
    );
    expect(result).toEqual([1, 2]);
    expect(query.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(query.range).toHaveBeenCalledTimes(3);
  });
});
