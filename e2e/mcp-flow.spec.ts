import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

test.describe('MCP接続 @auth-required', () => {
  test.skip(
    process.env.E2E_MCP !== 'true',
    'MCP用の事前登録クライアントと検証DBを用意した場合だけ実行する',
  );

  test('実HTTP本文の127/128/129KiB境界をContent-Length有無の両方で検証する', async ({
    request,
    baseURL,
  }) => {
    for (const kib of [127, 128, 129]) {
      const prefix = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
      const body = prefix + ' '.repeat(kib * 1024 - Buffer.byteLength(prefix));
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      const response = await request.post('/mcp', { headers, data: body });
      expect(response.status()).toBe(kib <= 128 ? 200 : 413);
      const stream = new ReadableStream({
        start(controller) {
          const bytes = new TextEncoder().encode(body);
          controller.enqueue(bytes.slice(0, 65000));
          controller.enqueue(bytes.slice(65000));
          controller.close();
        },
      });
      const streamed = await fetch(new URL('/mcp', baseURL), {
        method: 'POST',
        headers,
        body: stream,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      expect(streamed.status).toBe(kib <= 128 ? 200 : 413);
      await streamed.arrayBuffer();
    }
  });

  test('ログイン・拒否・許可・コード交換・失効', async ({ page, request }) => {
    test.setTimeout(60000);
    if (!process.env.MCP_CLIENTS || !process.env.NEXTAUTH_URL) {
      throw new Error(
        'MCP E2Eにはサーバーと同じMCP_CLIENTSとNEXTAUTH_URLを環境変数で渡してください',
      );
    }
    const clients = JSON.parse(process.env.MCP_CLIENTS ?? '[]') as Array<{
      id: string;
      name: string;
      secret: string;
      redirectUris: string[];
    }>;
    const client = clients[0];
    expect(client).toBeDefined();
    const verifier = 'v'.repeat(43);
    const resource = `${new URL(process.env.NEXTAUTH_URL ?? '').origin}/mcp`;
    const params = new URLSearchParams({
      client_id: client.id,
      redirect_uri: client.redirectUris[0],
      response_type: 'code',
      resource,
      scope: 'daysynth.read',
      state: 'mcp-e2e-state',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const listed = await request.post('/mcp', {
      headers: { Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(listed.status()).toBe(200);
    const tools = (await listed.json()).result.tools as Array<{
      name: string;
      securitySchemes: unknown;
      _meta: { securitySchemes: unknown };
    }>;
    expect(tools).toHaveLength(8);
    expect(tools.find((tool) => tool.name === 'save_my_answer')?.securitySchemes).toEqual([
      { type: 'oauth2', scopes: ['daysynth.write'] },
    ]);
    for (const tool of tools) expect(tool.securitySchemes).toEqual(tool._meta.securitySchemes);
    const anonymousCall = await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_my_answer', arguments: {} },
      },
    });
    expect(anonymousCall.status()).toBe(401);
    await page.route(`${client.redirectUris[0]}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Callback</p>' }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const initial = await page.goto(`/oauth/authorize?${params}`);
    expect(initial?.status()).toBe(200);
    await expect(page.getByLabel('開発ID')).toBeVisible();
    await page.getByLabel('開発ID').fill(process.env.DEV_LOGIN_ID ?? 'e2e-dev');
    await page.getByLabel('開発パスワード').fill(process.env.DEV_LOGIN_PASSWORD ?? 'e2e-devpass');
    await page.getByRole('button', { name: '開発用ログインで進む' }).click();
    await expect(page.getByTestId('mcp-consent-title')).toBeVisible();
    await expect(page.getByTestId('mcp-consent-allow')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByTestId('mcp-consent-deny').click();
    await page.waitForURL(`${client.redirectUris[0]}**`);
    const denied = new URL(page.url());
    expect(denied.searchParams.get('error')).toBe('access_denied');
    expect(denied.searchParams.get('state')).toBe('mcp-e2e-state');
    expect(denied.searchParams.has('code')).toBe(false);
    const consent = await page.goto(`/oauth/authorize?${params}`);
    expect(consent?.headers()['x-frame-options']).toBe('DENY');
    expect(consent?.headers()['referrer-policy']).toBe('no-referrer');
    await page.getByTestId('mcp-consent-allow').click();
    await page.waitForURL(`${client.redirectUris[0]}**`);
    const callback = new URL(page.url());
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(callback.searchParams.get('state')).toBe('mcp-e2e-state');
    const exchanged = await request.post('/oauth/token', {
      form: {
        client_id: client.id,
        client_secret: client.secret,
        code: code!,
        code_verifier: verifier,
        redirect_uri: client.redirectUris[0],
        grant_type: 'authorization_code',
        resource,
      },
    });
    expect(exchanged.status()).toBe(200);
    const tokens = (await exchanged.json()) as { access_token: string };
    const initialized = await request.post('/mcp', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '1.0.0' },
        },
      },
    });
    expect(initialized.status()).toBe(200);
    expect((await initialized.json()).result.serverInfo.name).toBe('daysynth');
    const insufficient = await request.post('/mcp', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      data: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'save_my_answer', arguments: {} },
      },
    });
    expect(insufficient.status()).toBe(403);
    expect(insufficient.headers()['www-authenticate']).toContain('error="insufficient_scope"');
    expect(insufficient.headers()['www-authenticate']).toContain('scope="daysynth.write"');
    const revoked = await request.post('/oauth/revoke', {
      form: { client_id: client.id, client_secret: client.secret, token: tokens.access_token },
    });
    expect(revoked.status()).toBe(200);
    const unauthorized = await request.post('/mcp', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      data: {},
    });
    expect(unauthorized.status()).toBe(401);
    expect(unauthorized.headers()['www-authenticate']).toContain(
      '/.well-known/oauth-protected-resource/mcp',
    );
  });
});
