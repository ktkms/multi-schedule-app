import { createClient } from '@supabase/supabase-js';
import { buildParticipantsByDateIndex } from '../tooltip-utils';
import { fetchAllPaginated, fetchAllPaginatedWithOrder, SupabaseQueryInterface } from '../utils';

const rows = Array.from({ length: 2180 }, (_, index) => ({
  id: String(index).padStart(4, '0'),
  participant_id: `p${Math.floor(index / 545)}`,
  event_date_id: `d${index % 545}`,
  availability: true,
  created_at: '2026-10-14T00:00:00Z',
  start_time: `2026-10-${15 + (index % 3)}T00:00:00Z`,
}));
type Row = (typeof rows)[number];

function compareRows(left: Row, right: Row, order: string): number {
  for (const condition of order.split(',')) {
    const [column, direction] = condition.split('.') as [keyof Row, string];
    if (left[column] !== right[column]) {
      return (left[column] < right[column] ? -1 : 1) * (direction === 'desc' ? -1 : 1);
    }
  }
  return 0;
}

function createPaginatedQuery(data: Row[] = rows) {
  const requests: URL[] = [];
  const fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? data.length);
    const order = url.searchParams.get('order') ?? '';

    // 同値の行の順序はDBで保証されない。ページごとに逆転させて取得漏れも再現する。
    const source = requests.length % 2 === 0 ? [...data].reverse() : [...data];
    const page = source
      .sort((left, right) => compareRows(left, right, order))
      .slice(offset, offset + limit);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => JSON.stringify(page),
    } as unknown as Response;
  });
  const client = createClient('https://pagination.example.test', 'test-key', {
    global: { fetch },
    accessToken: async () => 'test-token',
  });
  return {
    query: client.from('availabilities').select('*') as unknown as SupabaseQueryInterface,
    requests,
  };
}

describe('実際のSupabaseクエリでのページ境界の回帰テスト', () => {
  it.each([
    ['created_at', true],
    ['created_at', false],
    ['start_time', true],
    ['start_time', false],
    ['id', false],
  ] as const)('%sの昇順指定%sで全行を重複・欠落なく取得する', async (field, ascending) => {
    const { query, requests } = createPaginatedQuery();
    const result = await fetchAllPaginatedWithOrder<Row>(query, field, { ascending });
    const expectedOrder = `${field}.${ascending ? 'asc' : 'desc'}${field === 'id' ? '' : ',id.asc'}`;

    expect(result).toEqual(
      [...rows].sort((left, right) => compareRows(left, right, expectedOrder)),
    );
    expect(new Set(result.map((row) => row.id)).size).toBe(rows.length);
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '1000', '2000']);
    expect(requests.map((url) => url.searchParams.get('order'))).toEqual(
      Array(3).fill(expectedOrder),
    );

    // 同名の別参加者も保持し、各候補の人数とツールチップ一覧が4人で一致する。
    const participants = Array.from({ length: 4 }, (_, index) => ({
      id: `p${index}`,
      name: '同名',
    }));
    const summaries = buildParticipantsByDateIndex(participants, result);
    expect(summaries.size).toBe(545);
    for (const summary of summaries.values()) {
      expect(summary.availableParticipants).toHaveLength(4);
      expect(summary.unavailableParticipants).toHaveLength(0);
    }
  });

  it.each([0, 1000, 2000, 2180])(
    '既定の降順取得でも%d件を重複・欠落なく取得する',
    async (count) => {
      const data = rows.slice(0, count);
      const { query, requests } = createPaginatedQuery(data);

      const result = await fetchAllPaginated<Row>(query);

      expect(result).toEqual(data);
      expect(new Set(result.map((row) => row.id)).size).toBe(count);
      expect(requests).toHaveLength(Math.floor(count / 1000) + 1);
      expect(
        requests.every((url) => url.searchParams.get('order') === 'created_at.desc,id.asc'),
      ).toBe(true);
    },
  );
});
