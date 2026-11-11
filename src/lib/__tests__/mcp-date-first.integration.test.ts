/** @jest-environment node */
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { authPool } from '@/lib/auth';
import { createMcpServer } from '@/lib/mcp/server';
import { dateFirstAnswerSchema } from '@/lib/date-first-schema';

jest.mock('@/lib/auth', () => ({
  authPool: { connect: jest.fn() },
  getAuthSession: jest.fn().mockResolvedValue(null),
}));
const databaseUrl = process.env.DATE_FIRST_MCP_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);

describeDatabase('日付先行型の実DB・MCP SDK統合', () => {
  let pool: Pool;
  beforeAll(async () => {
    const url = new URL(databaseUrl!),
      rest = new URL(process.env.SUPABASE_URL ?? '');
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/daysynth_date_first_review' ||
      !['127.0.0.1', 'localhost'].includes(rest.hostname)
    )
      throw new Error('マイグレーション適用済みの隔離DB・ローカルRESTだけを指定してください');
    pool = new Pool({ connectionString: databaseUrl });
    (authPool.connect as jest.Mock).mockImplementation(() => pool.connect());
    expect(
      (await pool.query("SELECT to_regnamespace('date_first') IS NOT NULL AS ready")).rows[0].ready,
    ).toBe(true);
  });
  afterAll(async () => {
    await pool?.end();
  });
  async function fixture() {
    const user = (
      await pool.query<{ id: string }>(
        "INSERT INTO authjs.users(name) VALUES('MCP統合本人') RETURNING id",
      )
    ).rows[0].id;
    const result = await pool.query<{ value: unknown }>(
      'SELECT date_first.create_event($1,$2::jsonb) AS value',
      [
        randomUUID(),
        JSON.stringify({ title: 'MCP新方式統合', days: ['2099-11-07', '2099-11-08'] }),
      ],
    );
    const event = z.object({ id: z.uuid(), token: z.string() }).parse(result.rows[0].value);
    const days = (
      await pool.query<{ id: string }>(
        'SELECT id FROM public.event_candidate_days WHERE event_id=$1 ORDER BY local_date',
        [event.id],
      )
    ).rows.map((row) => row.id);
    await pool.query('SELECT date_first.add_slots($1,0,$2,$3::jsonb)', [
      event.token,
      days[0],
      '[[600,660],[660,720]]',
    ]);
    const slots = (
      await pool.query<{ id: string }>(
        'SELECT id FROM public.event_dates WHERE event_id=$1 ORDER BY start_time',
        [event.id],
      )
    ).rows.map((row) => row.id);
    return { user, ...event, days, slots };
  }
  async function connect(userId: string) {
    const server = createMcpServer({ userId, scopes: ['daysynth.read', 'daysynth.write'] });
    const client = new Client({ name: 'date-first-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    return { server, client };
  }
  async function call(
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const result = z
      .object({
        isError: z.boolean().optional(),
        content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
      })
      .parse(await client.callTool({ name, arguments: args }));
    if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
    return JSON.parse(result.content[0].text);
  }
  async function schedule(user: string, start: string, end: string, availability: boolean) {
    await pool.query(
      "INSERT INTO public.user_schedule_blocks(user_id,start_time,end_time,availability,source) VALUES($1,$2,$3,$4,'manual')",
      [user, start + 'Z', end + 'Z', availability],
    );
  }
  it('既存8ツールで日付・時間の三値と初回補完を扱い、本人の正式時間だけを予定へ保存する', async () => {
    const e = await fixture();
    await schedule(e.user, '2099-11-07 00:00', '2099-11-08 00:00', true);
    await schedule(e.user, '2099-11-08 10:00', '2099-11-08 21:00', true);
    const { server, client } = await connect(e.user);
    try {
      expect((await client.listTools()).tools).toHaveLength(8);
      expect(await call(client, 'get_event', { public_token: e.token })).toMatchObject({
        scheduling_mode: 'date_first',
        candidate_days: [{ id: e.days[0] }, { id: e.days[1] }],
      });
      expect(
        await call(client, 'get_my_answer', {
          public_token: e.token,
          include_account_schedule: true,
        }),
      ).toMatchObject({
        answer: null,
        account_schedule: {
          participant: null,
          days: [
            { id: e.days[0], status: 'yes' },
            { id: e.days[1], status: 'maybe' },
          ],
        },
      });
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM public.user_event_links WHERE user_id=$1', [
            e.user,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(
        await call(client, 'get_my_schedule', { date_from: '2099-11-07', date_to: '2099-11-08' }),
      ).toMatchObject({ blocks: expect.any(Array) });
      const saved = z.object({ answer: dateFirstAnswerSchema }).parse(
        await call(client, 'save_my_answer', {
          public_token: e.token,
          scheduling_mode: 'date_first',
          answer_kind: 'days',
          expected_revision: '0',
          request_id: randomUUID(),
          name: 'MCP本人',
          use_account_schedule: true,
          day_changes: [{ id: e.days[1], status: null }],
        }),
      );
      expect(saved.answer.days).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: e.days[0], status: 'yes', source: 'account' }),
          expect.objectContaining({ id: e.days[1], status: null, source: 'manual' }),
        ]),
      );
      expect(saved.answer.times).toHaveLength(2);
      await call(client, 'save_my_answer', {
        public_token: e.token,
        scheduling_mode: 'date_first',
        answer_kind: 'times',
        expected_revision: saved.answer.timeRevision,
        time_changes: [
          { id: e.slots[0], availability: false },
          { id: e.slots[1], availability: null },
        ],
      });
      expect(await call(client, 'get_my_answer', { public_token: e.token })).toMatchObject({
        answer: {
          times: expect.arrayContaining([
            expect.objectContaining({ id: e.slots[0], availability: false }),
            expect.objectContaining({ id: e.slots[1], availability: null }),
          ]),
        },
      });
      expect(
        await call(client, 'list_my_events', { date_from: '2099-11-07', date_to: '2099-11-08' }),
      ).toMatchObject({ events: [{ public_token: e.token, scheduling_mode: 'date_first' }] });
      const preview = z
        .object({
          expected_revision: z.string(),
          changes: z.array(z.object({ availability: z.boolean() })),
          unanswered_ids: z.array(z.uuid()),
        })
        .parse(
          await call(client, 'save_my_answer_to_schedule', {
            public_token: e.token,
            event_date_ids: e.slots,
          }),
        );
      expect(preview.changes).toEqual([{ availability: false }]);
      expect(preview.unanswered_ids).toEqual([e.slots[1]]);
      expect(
        await call(client, 'save_my_answer_to_schedule', {
          public_token: e.token,
          event_date_ids: e.slots,
          mode: 'apply',
          expected_revision: preview.expected_revision,
        }),
      ).toMatchObject({ saved: true, saved_slots: 1, other_events_updated: false });
      const update = {
        start_time: '2099-11-07T00:00:00',
        end_time: '2099-11-08T00:00:00',
        availability: false,
      };
      expect(await call(client, 'preview_my_schedule_update', update)).toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({
            public_token: e.token,
            scheduling_mode: 'date_first',
            changed_days: 1,
          }),
        ]),
      });
      expect(await call(client, 'update_my_schedule', update)).toMatchObject({
        schedule_saved: true,
        sync_complete: true,
        events: expect.arrayContaining([
          expect.objectContaining({ public_token: e.token, status: 'updated' }),
        ]),
      });
      expect(await call(client, 'get_my_answer', { public_token: e.token })).toMatchObject({
        answer: {
          days: expect.arrayContaining([
            expect.objectContaining({ id: e.days[0], status: 'no', source: 'account' }),
            expect.objectContaining({ id: e.days[1], status: null, source: 'manual' }),
          ]),
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('予定変更でコメントが消える場合はイベント全体を止め、確認した指紋でのみ反映する', async () => {
    const e = await fixture();
    await schedule(e.user, '2099-11-07 10:00', '2099-11-07 11:00', true);
    const { server, client } = await connect(e.user);
    try {
      const saved = z.object({ answer: dateFirstAnswerSchema }).parse(
        await call(client, 'save_my_answer', {
          public_token: e.token,
          scheduling_mode: 'date_first',
          answer_kind: 'days',
          expected_revision: '0',
          request_id: randomUUID(),
          name: 'コメント確認',
          use_account_schedule: true,
          day_changes: [],
        }),
      );
      await pool.query("SELECT date_first.save_answers($1,$2,$3,'days',$4::jsonb)", [
        e.token,
        saved.answer.id,
        saved.answer.dayRevision,
        JSON.stringify([{ id: e.days[0], comment: '削除確認対象' }]),
      ]);
      const update = {
        start_time: '2099-11-07T10:00:00',
        end_time: '2099-11-07T11:00:00',
        availability: false,
      };
      const preview = z
        .object({
          events: z.array(
            z.object({
              public_token: z.string(),
              expected_revision: z.string().optional(),
              acknowledged_day_ids: z.array(z.uuid()).optional(),
            }),
          ),
        })
        .parse(await call(client, 'preview_my_schedule_update', update));
      const target = preview.events.find((event) => event.public_token === e.token)!;
      expect(await call(client, 'update_my_schedule', update)).toMatchObject({
        schedule_saved: true,
        sync_complete: false,
        events: [expect.objectContaining({ status: 'requires_confirmation' })],
      });
      expect(await call(client, 'get_my_answer', { public_token: e.token })).toMatchObject({
        answer: {
          days: [
            expect.objectContaining({ id: e.days[0], status: 'maybe', comment: '削除確認対象' }),
          ],
          times: [expect.objectContaining({ id: e.slots[0], availability: true })],
        },
      });
      expect(
        await call(client, 'update_my_schedule', {
          ...update,
          confirmed_events: [
            {
              public_token: e.token,
              expected_revision: target.expected_revision,
              acknowledged_day_ids: target.acknowledged_day_ids,
            },
          ],
        }),
      ).toMatchObject({ schedule_saved: true, sync_complete: true });
      const after = z
        .object({ answer: dateFirstAnswerSchema })
        .parse(await call(client, 'get_my_answer', { public_token: e.token }));
      expect(after.answer.days.find((day) => day.id === e.days[0])).toBeUndefined();
      expect(after.answer.times.find((time) => time.id === e.slots[0])?.availability).toBe(false);
      const rejected = await client.callTool({
        name: 'save_my_answer',
        arguments: {
          public_token: e.token,
          scheduling_mode: 'date_first',
          answer_kind: 'times',
          expected_revision: after.answer.timeRevision,
          time_changes: [],
          participant_id: saved.answer.id,
        },
      });
      expect(rejected.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
