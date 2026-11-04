import { saveDateFirst } from '@/lib/date-first-actions';
import { executeDateFirst } from '@/lib/date-first-service';
import { getAuthSession } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

jest.mock('@/lib/date-first-service', () => ({ executeDateFirst: jest.fn() }));
jest.mock('@/lib/auth', () => ({ getAuthSession: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
});

it('匿名の共同編集ではログインを要求せず、保存後の表示更新失敗を警告として返す', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  jest.mocked(executeDateFirst).mockResolvedValue({ success: true, value: { id } });
  jest.mocked(revalidatePath).mockImplementation(() => {
    throw new Error('cache failure');
  });
  expect(
    await saveDateFirst({
      operation: 'saveDays',
      token: 'public-token-123',
      participantId: id,
      revision: '0',
      changes: [{ id, status: null }],
    }),
  ).toMatchObject({ success: true, value: { id }, warning: expect.any(String) });
  expect(getAuthSession).not.toHaveBeenCalled();
  expect(executeDateFirst).toHaveBeenCalledTimes(1);
});

it('予定からの反映にクライアント由来の本人IDを受け付けない', async () => {
  expect(
    await saveDateFirst({
      operation: 'previewSync',
      token: 'public-token-123',
      userId: 'another-user',
    }),
  ).toMatchObject({ success: false, code: 'invalid_input' });
  expect(executeDateFirst).not.toHaveBeenCalled();
});

it.each([
  { operation: 'previewSync' },
  { operation: 'applySync', fingerprint: 'a'.repeat(64), acknowledgedIds: [] },
  { operation: 'previewAnswerSchedule', slotIds: ['11111111-1111-4111-8111-111111111111'] },
  {
    operation: 'applyAnswerSchedule',
    slotIds: ['11111111-1111-4111-8111-111111111111'],
    fingerprint: 'a'.repeat(64),
  },
])('本人用の$operationはセッション本人で実行する', async (operation) => {
  jest
    .mocked(getAuthSession)
    .mockResolvedValue({ user: { id: 'session-owner' } } as Awaited<
      ReturnType<typeof getAuthSession>
    >);
  jest.mocked(executeDateFirst).mockResolvedValue({ success: true, value: {} });
  const command = { ...operation, token: 'public-token-123' };
  expect(await saveDateFirst(command)).toMatchObject({ success: true });
  expect(executeDateFirst).toHaveBeenCalledWith(command, 'session-owner');
  expect(revalidatePath).toHaveBeenCalledTimes(operation.operation.startsWith('preview') ? 0 : 1);
});
