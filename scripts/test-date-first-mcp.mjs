import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as httpServer, request } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';

// マイグレーション検証済みの専用DBだけを使う。通常開発用・本番の接続先は選択しない。
const connection = process.env.DATE_FIRST_REVIEW_DATABASE_URL;
if (!connection) throw new Error('DATE_FIRST_REVIEW_DATABASE_URLを指定してください');
const url = new URL(connection);
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/daysynth_date_first_review' ||
  url.search
)
  throw new Error('ローカルのdaysynth_date_first_review DBだけを指定してください');
const docker = promisify(execFile),
  name = `daysynth-date-first-mcp-${randomUUID().slice(0, 8)}`;
const secret = randomUUID() + randomUUID();
const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const token = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
let started = false,
  child,
  restPort,
  stage = 'DBコンテナの確認';
const proxy = httpServer((incoming, outgoing) => {
  const path = incoming.url.startsWith('/rest/v1') ? incoming.url.slice(8) || '/' : incoming.url;
  const upstream = request(
    {
      hostname: '127.0.0.1',
      port: restPort,
      path,
      method: incoming.method,
      headers: { ...incoming.headers, host: `127.0.0.1:${restPort}` },
    },
    (response) => {
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on('error', () => {
    outgoing.writeHead(502);
    outgoing.end('Isolated REST unavailable');
  });
  incoming.pipe(upstream);
});
const stop = () => child?.kill('SIGTERM');
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  // 接続先として明示されたポートのDBコンテナだけを解決し、同じDockerネットワークへ接続する。
  const inventory = await docker('docker', ['ps', '--format', '{{json .}}']);
  const candidates = inventory.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) =>
      new RegExp(`(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::\\]):${url.port}->[0-9]+/tcp`).test(
        row.Ports,
      ),
    );
  if (candidates.length !== 1) throw new Error('専用DBコンテナを一意に解決できません');
  const database = candidates[0],
    internalPort = new RegExp(`:${url.port}->([0-9]+)/tcp`).exec(database.Ports)[1];
  const networkInfo = await docker('docker', [
    'inspect',
    '--format',
    '{{json .NetworkSettings.Networks}}',
    database.ID,
  ]);
  const [network, settings] = Object.entries(JSON.parse(networkInfo.stdout)).find(
    ([, value]) => value.IPAddress,
  );
  const restDatabase = new URL(connection);
  restDatabase.hostname = settings.IPAddress;
  restDatabase.port = internalPort;
  stage = 'RESTコンテナの起動';
  await docker('docker', [
    'run',
    '--rm',
    '--detach',
    '--name',
    name,
    '--network',
    network,
    '--publish',
    '127.0.0.1::3000',
    '--env',
    `PGRST_DB_URI=${restDatabase}`,
    '--env',
    'PGRST_DB_SCHEMAS=public',
    '--env',
    'PGRST_DB_ANON_ROLE=anon',
    '--env',
    `PGRST_JWT_SECRET=${secret}`,
    'public.ecr.aws/supabase/postgrest:v14.13',
  ]);
  started = true;
  restPort = Number(
    (await docker('docker', ['port', name, '3000/tcp'])).stdout.trim().split(':').at(-1),
  );
  stage = 'RESTの起動確認';
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${restPort}/`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        await response.body?.cancel();
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('RESTの起動確認に失敗しました');
  await new Promise((resolve, reject) =>
    proxy.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  stage = 'SDK統合テスト';
  const proxyPort = proxy.address().port;
  child = spawn(
    process.execPath,
    [
      'node_modules/jest/bin/jest.js',
      '--runInBand',
      'src/lib/__tests__/mcp-date-first.integration.test.ts',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATE_FIRST_MCP_TEST_DATABASE_URL: connection,
        SUPABASE_URL: `http://127.0.0.1:${proxyPort}`,
        SUPABASE_SERVICE_ROLE_KEY: token,
        MCP_CLIENTS: '',
        NODE_ENV: 'test',
      },
    },
  );
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  process.exitCode = code;
} catch {
  // コマンド引数に含めた資格情報やJWTを、例外メッセージ経由で出力しない。
  process.stderr.write(
    `隔離MCP検証の「${stage}」に失敗しました。Docker・専用DB・RESTの利用可能性を確認してください。\n`,
  );
  process.exitCode = 1;
} finally {
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
  if (started) await docker('docker', ['stop', name]).catch(() => undefined);
}
