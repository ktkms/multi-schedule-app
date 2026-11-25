import { authPool } from '@/lib/auth';
import { saveDateFirstMcpAnswer } from '@/lib/mcp/date-first';

jest.mock('@/lib/auth', () => ({ authPool: { connect: jest.fn() } }));
const id = '11111111-1111-4111-8111-111111111111';
const input = {
  scheduling_mode: 'date_first',
  answer_kind: 'days',
  public_token: 'public-token-123',
  expected_revision: '0',
  request_id: id,
  name: '本人',
  day_changes: [{ id, status: null }],
};
const saved = { id, revision: '1', replayed: false, created: true };
const answer = { id, name: '本人', dayRevision: '1', timeRevision: '0', days: [], times: [] };
const client = () => ({
  query: jest.fn(async (sql: string): Promise<{ rows: { value: unknown }[] }> => ({
    rows: [{ value: sql.includes('my_answer') ? saved : answer }],
  })),
  release: jest.fn(),
});

beforeEach(() => jest.clearAllMocks());

it('本人回答の保存と取得を同じ直列化トランザクションで再試行する', async () => {
  const first = client(),
    second = client();
  first.query.mockImplementation(async (sql: string) => {
    if (sql.includes('read_answer'))
      throw Object.assign(new Error('serialization'), { code: '40001' });
    return { rows: [{ value: saved }] };
  });
  jest
    .mocked(authPool.connect)
    .mockResolvedValueOnce(first as never)
    .mockResolvedValueOnce(second as never);
  expect(await saveDateFirstMcpAnswer('trusted-owner', input)).toMatchObject({
    success: true,
    answer,
    created: true,
  });
  for (const db of [first, second]) {
    expect(db.query).toHaveBeenNthCalledWith(1, 'BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('date_first.my_answer'), [
      'trusted-owner',
      input.public_token,
      'days',
      '0',
      JSON.stringify(input.day_changes),
      id,
      '本人',
      false,
    ]);
    expect(db.release).toHaveBeenCalledTimes(1);
  }
  expect(first.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(second.query).toHaveBeenLastCalledWith('COMMIT');
});

it('保存後の取得結果が不正なら全体を戻し、ロールバックに失敗した接続を再利用しない', async () => {
  const db = client();
  db.query.mockImplementation(async (sql: string) => {
    if (sql === 'ROLLBACK') throw new Error('private rollback failure');
    return { rows: [{ value: sql.includes('my_answer') ? saved : { ...answer, days: null } }] };
  });
  jest.mocked(authPool.connect).mockResolvedValue(db as never);
  expect(await saveDateFirstMcpAnswer('trusted-owner', input)).toMatchObject({
    success: false,
    code: 'retryable_error',
  });
  expect(db.query).not.toHaveBeenCalledWith('COMMIT');
  expect(db.release).toHaveBeenCalledWith(true);
  expect(authPool.connect).toHaveBeenCalledTimes(1);
});
