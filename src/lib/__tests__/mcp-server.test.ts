import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '@/lib/mcp/server';
import { readMyAnswer, saveMyAnswer, saveMyAnswerToSchedule } from '@/lib/mcp/services';
import { listMyEvents, readMySchedule } from '@/lib/mcp/read-services';

jest.mock('@/lib/mcp/read-services', () => ({
  listMyEvents: jest.fn(),
  readMySchedule: jest.fn(),
}));

jest.mock('@/lib/mcp/services', () => ({
  McpInputError: class extends Error {},
  readEvent: jest.fn(),
  readMyAnswer: jest.fn(),
  saveMyAnswer: jest.fn(),
  saveMyAnswerToSchedule: jest.fn(),
  previewMyScheduleUpdate: jest.fn(),
  updateMySchedule: jest.fn(),
}));
jest.mock('@/lib/schedule-service', () => ({ fetchUserScheduleBlocks: jest.fn() }));
jest.mock('@/lib/mcp/config', () => ({
  getMcpConfig: () => ({ issuer: 'https://daysynth.example' }),
}));

describe('MCP SDKの接続と操作', () => {
  beforeEach(() => jest.clearAllMocks());
  async function connect(userId: string, scopes: string[]) {
    const server = createMcpServer({ userId, scopes });
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { server, client };
  }
  it('SDK経由で期間検索と既存形式・任意期間の予定取得を利用できる', async () => {
    const { client, server } = await connect('me', ['daysynth.read']);
    try {
      (listMyEvents as jest.Mock).mockResolvedValue({ events: [], next_offset: null });
      (readMySchedule as jest.Mock).mockResolvedValue({ blocks: [], time_zone: 'Asia/Tokyo' });
      const search = { date_from: '2026-10-10', date_to: '2026-10-20', query: '打合せ', limit: 20 };
      expect(
        (await client.callTool({ name: 'list_my_events', arguments: search })).isError,
      ).not.toBe(true);
      expect(listMyEvents).toHaveBeenCalledWith('me', { ...search, offset: 0 });
      for (const args of [
        { week_start: '2026-10-10' },
        { date_from: '2026-10-10', date_to: '2026-10-10', availability: false },
      ]) {
        expect(
          (await client.callTool({ name: 'get_my_schedule', arguments: args })).isError,
        ).not.toBe(true);
        expect(readMySchedule).toHaveBeenCalledWith('me', args);
      }
      const invalid = await client.callTool({
        name: 'list_my_events',
        arguments: { date_from: '2026-10-10' },
      });
      expect(invalid.isError).toBe(true);
      expect(listMyEvents).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('権限のない接続は検索・予定のDB処理を呼ばない', async () => {
    const { client, server } = await connect('me', []);
    try {
      for (const [name, args] of [
        ['list_my_events', {}],
        ['get_my_schedule', { week_start: '2026-10-10' }],
      ] as const) {
        expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
      }
      expect(listMyEvents).not.toHaveBeenCalled();
      expect(readMySchedule).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('実際のSDKクライアントからツールを列挙して本人の回答を取得できる', async () => {
    const { client, server } = await connect('me', ['daysynth.read']);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('get_my_answer');
      expect(
        tools.tools.find((tool) => tool.name === 'get_my_answer')?._meta?.securitySchemes,
      ).toEqual([{ type: 'oauth2', scopes: ['daysynth.read'] }]);
      expect(
        tools.tools.find((tool) => tool.name === 'save_my_answer')?._meta?.securitySchemes,
      ).toEqual([{ type: 'oauth2', scopes: ['daysynth.write'] }]);
      expect(
        tools.tools.filter((tool) => tool.annotations?.destructiveHint).map((tool) => tool.name),
      ).toEqual(['save_my_answer', 'save_my_answer_to_schedule', 'update_my_schedule']);
      expect(
        tools.tools.find((tool) => tool.name === 'preview_my_schedule_update')?.annotations,
      ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      (readMyAnswer as jest.Mock).mockResolvedValue({ answer: null });
      const result = await client.callTool({
        name: 'get_my_answer',
        arguments: { public_token: 'AbCdEf123456' },
      });
      expect(result.isError).not.toBe(true);
      expect(readMyAnswer).toHaveBeenCalledWith('me', 'AbCdEf123456', undefined);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('読み取り専用の接続は回答を変更できない', async () => {
    const { client, server } = await connect('me', ['daysynth.read']);
    try {
      const result = await client.callTool({
        name: 'save_my_answer',
        arguments: {
          public_token: 'AbCdEf123456',
          name: '本人',
          availabilities: [
            { event_date_id: '11111111-1111-4111-8111-111111111111', availability: true },
          ],
        },
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.['mcp/www_authenticate']).toEqual([
        expect.stringContaining('error="insufficient_scope"'),
      ]);
      expect(saveMyAnswer).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('予定参照は明示指定した場合だけ有効にし、予定保存は書き込み権限を要求する', async () => {
    const { client, server } = await connect('me', ['daysynth.read']);
    try {
      (readMyAnswer as jest.Mock).mockResolvedValue({ answer: null, account_schedule: [] });
      await client.callTool({
        name: 'get_my_answer',
        arguments: { public_token: 'AbCdEf123456', include_account_schedule: true },
      });
      expect(readMyAnswer).toHaveBeenCalledWith('me', 'AbCdEf123456', true);
      const result = await client.callTool({
        name: 'save_my_answer_to_schedule',
        arguments: {
          public_token: 'AbCdEf123456',
          event_date_ids: ['11111111-1111-4111-8111-111111111111'],
        },
      });
      expect(result.isError).toBe(true);
      expect(saveMyAnswerToSchedule).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('未ログインでも定義を取得できるが本人の回答にはアクセスできない', async () => {
    const server = createMcpServer(null);
    const client = new Client({ name: 'anonymous', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools).toHaveLength(8);
      const result = await client.callTool({
        name: 'get_my_answer',
        arguments: { public_token: 'AbCdEf123456' },
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.['mcp/www_authenticate']).toEqual([
        expect.stringContaining('error="invalid_token"'),
      ]);
      expect(readMyAnswer).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('別ユーザーの接続を同時に使っても本人のIDが混ざらない', async () => {
    const first = await connect('first', ['daysynth.read']);
    const second = await connect('second', ['daysynth.read']);
    try {
      (readMyAnswer as jest.Mock).mockResolvedValue({ answer: null });
      await Promise.all(
        [first, second].map(({ client }) =>
          client.callTool({ name: 'get_my_answer', arguments: { public_token: 'AbCdEf123456' } }),
        ),
      );
      expect(readMyAnswer).toHaveBeenCalledWith('first', 'AbCdEf123456', undefined);
      expect(readMyAnswer).toHaveBeenCalledWith('second', 'AbCdEf123456', undefined);
    } finally {
      await first.client.close();
      await second.client.close();
      await first.server.close();
      await second.server.close();
    }
  });
  it('任意の参加者IDをツール引数に追加すると保存前に拒否する', async () => {
    const { client, server } = await connect('me', ['daysynth.read', 'daysynth.write']);
    try {
      const result = await client.callTool({
        name: 'save_my_answer',
        arguments: {
          public_token: 'AbCdEf123456',
          name: '本人',
          participant_id: 'other',
          availabilities: [
            { event_date_id: '11111111-1111-4111-8111-111111111111', availability: true },
          ],
        },
      });
      expect(result.isError).toBe(true);
      expect(saveMyAnswer).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
