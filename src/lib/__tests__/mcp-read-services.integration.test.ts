import { Pool } from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { createMcpServer } from '@/lib/mcp/server';
import { listMyEvents, readEventDates, readMySchedule } from '@/lib/mcp/read-services';
import { eventSearchInput } from '@/lib/mcp/schemas';
import { authPool } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({ authPool: { connect: jest.fn() } }));

// 隔離した使い捨てDBだけで実行し、開発用・本番用のDBには接続しない。
const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const day = { date_from: '2026-10-10', date_to: '2026-10-10' };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describeDatabase('MCP読み取りのPostgreSQL回帰テスト', () => {
  let pool: Pool;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/mcp_test') {
      throw new Error('隔離したローカルmcp_test DBを指定してください');
    }
    pool = new Pool({ connectionString: databaseUrl });
    (authPool.connect as jest.Mock).mockImplementation(() => pool.connect());
    await pool.query(`
      DROP TABLE IF EXISTS public.user_event_links, public.finalized_dates, public.event_dates,
        public.events, public.user_schedule_blocks CASCADE;
      CREATE TABLE public.events (id uuid PRIMARY KEY, title text NOT NULL, description text,
        public_token text UNIQUE, is_finalized boolean NOT NULL DEFAULT false, final_date_id uuid);
      CREATE TABLE public.event_dates (id uuid PRIMARY KEY, event_id uuid REFERENCES public.events,
        start_time timestamp NOT NULL, end_time timestamp NOT NULL);
      CREATE TABLE public.finalized_dates (event_id uuid, event_date_id uuid);
      CREATE TABLE public.user_event_links (id uuid PRIMARY KEY, user_id text NOT NULL, event_id uuid REFERENCES public.events,
        UNIQUE(user_id, event_id));
      CREATE TABLE public.user_schedule_blocks (id uuid PRIMARY KEY, user_id text, start_time timestamptz,
        end_time timestamptz, availability boolean, source text, event_id uuid, updated_at timestamptz DEFAULT now());
    `);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE user_event_links, finalized_dates, event_dates, events, user_schedule_blocks CASCADE',
    );
  });
  afterAll(async () => {
    await pool?.end();
  });
  async function event(
    n: number,
    opts: { title?: string; finalized?: boolean; user?: string; legacy?: number } = {},
  ) {
    await pool.query('INSERT INTO events VALUES ($1,$2,NULL,$3,$4,$5)', [
      uuid(n),
      opts.title ?? '打合せ',
      `public-token-${n}`,
      opts.finalized ?? false,
      opts.legacy ? uuid(opts.legacy) : null,
    ]);
    await pool.query('INSERT INTO user_event_links VALUES ($1,$2,$3)', [
      uuid(n),
      opts.user ?? 'me',
      uuid(n),
    ]);
  }
  async function date(n: number, eventId: number, start: string, end: string, finalized = false) {
    await pool.query('INSERT INTO event_dates VALUES ($1,$2,$3,$4)', [
      uuid(n),
      uuid(eventId),
      start,
      end,
    ]);
    if (finalized)
      await pool.query('INSERT INTO finalized_dates VALUES ($1,$2)', [uuid(eventId), uuid(n)]);
  }
  const search = (input: Record<string, unknown> = day, user = 'me') =>
    listMyEvents(user, eventSearchInput.parse(input));

  it('実際のMCPクライアントからDBまで検索・確定日時・予定取得が通る', async () => {
    await event(1, { finalized: true, legacy: 101 });
    await date(101, 1, '2026-10-10 12:00', '2026-10-10 13:00');
    await pool.query(
      "INSERT INTO user_schedule_blocks (id,user_id,start_time,end_time,availability,source) VALUES ($1,'me','2026-10-10 12:00Z','2026-10-10 13:00Z',false,'manual')",
      [uuid(1)],
    );
    const server = createMcpServer({ userId: 'me', scopes: ['daysynth.read'] });
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const resultSchema = z.object({
      content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
      isError: z.boolean().optional(),
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = resultSchema.parse(await client.callTool({ name, arguments: args }));
      expect(result.isError).not.toBe(true);
      return JSON.parse(result.content[0].text) as Record<string, unknown>;
    };
    try {
      expect(await call('list_my_events', day)).toMatchObject({
        events: [{ public_token: 'public-token-1', matched_date_target: 'finalized' }],
        next_offset: null,
      });
      expect(await call('get_event', { public_token: 'public-token-1' })).toMatchObject({
        finalized_dates: [{ id: uuid(101) }],
      });
      expect(await call('get_my_schedule', { ...day, availability: false })).toMatchObject({
        blocks: [{ id: uuid(1), availability: false }],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('期間と重なる枠を拾い、日付境界だけ接する枠と他人のイベントを除外する', async () => {
    for (let i = 1; i <= 5; i++) await event(i, { user: i === 5 ? 'other' : 'me' });
    await date(101, 1, '2026-10-09 23:00', '2026-10-10 01:00');
    await date(102, 2, '2026-10-10 23:00', '2026-10-11 01:00');
    await date(103, 3, '2026-10-09 23:00', '2026-10-10 00:00');
    await date(104, 4, '2026-10-11 00:00', '2026-10-11 01:00');
    await date(105, 5, '2026-10-10 12:00', '2026-10-10 13:00');
    const result = await search();
    expect(result.events.map((e) => e.public_token)).toEqual(['public-token-1', 'public-token-2']);
    expect(result.next_offset).toBeNull();
    expect((await search(day, 'other')).events.map((e) => e.public_token)).toEqual([
      'public-token-5',
    ]);
  });
  it('現行形式と旧形式の確定日時を取得・検索し、不採用候補を混入させない', async () => {
    await event(1, { finalized: true, legacy: 101 });
    await date(101, 1, '2026-10-10 12:00', '2026-10-10 13:00');
    expect((await search()).events).toHaveLength(1);
    expect((await readEventDates('public-token-1'))?.finalized_dates.map((d) => d.id)).toEqual([
      uuid(101),
    ]);
    await date(102, 1, '2026-10-11 12:00', '2026-10-11 13:00', true);
    expect((await search()).events).toHaveLength(0);
    expect((await search({ ...day, date_target: 'candidate' })).events).toHaveLength(1);
    expect((await readEventDates('public-token-1'))?.finalized_dates.map((d) => d.id)).toEqual([
      uuid(102),
    ]);
    expect(
      (await search({ date_from: '2026-10-11', date_to: '2026-10-11', date_target: 'finalized' }))
        .events,
    ).toHaveLength(1);
  });
  it('確定日時がないイベントと別イベントの旧形式IDを確定扱いしない', async () => {
    await event(1, { finalized: true, legacy: 102 });
    await event(2);
    await date(101, 1, '2026-10-10 12:00', '2026-10-10 13:00');
    await date(102, 2, '2026-10-10 12:00', '2026-10-10 13:00');
    expect((await readEventDates('public-token-1'))?.finalized_dates).toEqual([]);
    expect((await readEventDates('public-token-2'))?.finalized_dates).toEqual([]);
    expect(await readEventDates('unknown')).toBeNull();
    expect((await search()).events.map((e) => e.public_token)).toEqual(['public-token-2']);
  });
  it('名前の特殊文字を文字として扱い、状態フィルタもANDで適用する', async () => {
    await event(1, { title: 'Review 100%_\\', finalized: true, legacy: 101 });
    await event(2, { title: 'Review 100AB', finalized: true, legacy: 102 });
    for (let i = 1; i <= 2; i++) await date(100 + i, i, '2026-10-10 12:00', '2026-10-10 13:00');
    expect(
      (await search({ ...day, query: 'review 100%_\\', is_finalized: true })).events.map(
        (e) => e.public_token,
      ),
    ).toEqual(['public-token-1']);
    expect((await search({ ...day, query: 'Review', is_finalized: false })).events).toEqual([]);
  });
  it('絞り込み後に日程順でページ分割し、枠の重複と応答量を抑える', async () => {
    for (let i = 1; i <= 4; i++) await event(i, { title: i === 1 ? '対象外' : '対象' });
    for (let i = 2; i <= 4; i++) {
      for (let j = 0; j < 5; j++)
        await date(i * 100 + j, i, `2026-10-10 ${16 - i + j}:00`, `2026-10-10 ${17 - i + j}:00`);
    }
    const args = { ...day, query: '対象', limit: 2 };
    const first = await search(args);
    expect(first.events.map((e) => e.public_token)).toEqual(['public-token-4', 'public-token-3']);
    expect(first.events[0]).toMatchObject({
      matched_dates_truncated: true,
      matched_date_target: 'candidate',
    });
    expect(first.events[0].matched_dates).toHaveLength(3);
    expect(first.next_offset).toBe(2);
    const last = await search({ ...args, offset: first.next_offset });
    expect(last.events.map((e) => e.public_token)).toEqual(['public-token-2']);
    expect(last.next_offset).toBeNull();
    expect((await search({ ...args, limit: 3 })).next_offset).toBeNull();
    expect((await search({})).events.map((e) => e.public_token)).toEqual([
      'public-token-1',
      'public-token-2',
      'public-token-3',
      'public-token-4',
    ]);
  });
  it('イベントと予定を年末・うるう日の終了日まで取得する', async () => {
    await event(1);
    await date(101, 1, '2028-02-29 23:00', '2028-03-01 00:00');
    expect((await search({ date_from: '2028-02-29', date_to: '2028-02-29' })).events).toHaveLength(
      1,
    );
    await date(102, 1, '2026-12-31 23:00', '2027-01-01 00:00');
    expect((await search({ date_from: '2026-12-31', date_to: '2026-12-31' })).events).toHaveLength(
      1,
    );
  });
  it('本人の登録済み予定を期間・可否で絞り、元の時間帯を維持する', async () => {
    for (const [n, user, start, end, available] of [
      [1, 'me', '2026-10-09 23:00Z', '2026-10-10 01:00Z', false],
      [2, 'me', '2026-10-10 12:00Z', '2026-10-10 13:00Z', true],
      [3, 'other', '2026-10-10 12:00Z', '2026-10-10 13:00Z', false],
      [4, 'me', '2026-10-11 00:00Z', '2026-10-11 01:00Z', false],
    ] as const)
      await pool.query(
        'INSERT INTO user_schedule_blocks (id,user_id,start_time,end_time,availability,source) VALUES ($1,$2,$3,$4,$5,$6)',
        [uuid(n), user, start, end, available, 'manual'],
      );
    const result = await readMySchedule('me', { ...day, availability: false });
    expect(result.blocks.map((b) => b.id)).toEqual([uuid(1)]);
    expect(result.blocks[0].start_time).toBe('2026-10-09T23:00:00.000000Z');
    expect(
      (await readMySchedule('me', { week_start: '2026-10-10' })).blocks.map((b) => b.id),
    ).toEqual([uuid(1), uuid(2), uuid(4)]);
    expect(
      (await readMySchedule('me', { date_from: '2026-10-12', date_to: '2026-10-12' })).blocks,
    ).toEqual([]);
  });
  it('DB取得失敗を空の結果として返さず、接続を解放する', async () => {
    const release = jest.fn();
    (authPool.connect as jest.Mock).mockResolvedValueOnce({
      query: jest.fn().mockRejectedValue(new Error('DB failure')),
      release,
    });
    await expect(search()).rejects.toThrow('DB failure');
    expect(release).toHaveBeenCalled();
  });
});
