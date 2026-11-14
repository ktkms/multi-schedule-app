'use server';

import { revalidatePath } from 'next/cache';
import { getAuthSession } from '@/lib/auth';
import {
  executeDateFirst,
  readDateFirstAnswer,
  readDateFirstDay,
  readDateFirstScheduleDraft,
} from './date-first-service';
import { dateFirstCommandSchema } from './date-first-schema';

/** セッション本人の予定だけを取得し、他人の回答には取り込ませない。 */
export async function getDateFirstScheduleDraft(token: string, participantId?: string) {
  const userId = (await getAuthSession())?.user?.id;
  if (!userId) return { success: false as const, message: 'ログインしてからご利用ください。' };
  try {
    const draft = await readDateFirstScheduleDraft(token, userId, participantId);
    return { success: true as const, draft };
  } catch {
    return {
      success: false as const,
      message:
        '予定を取得できませんでした。既に回答済みの場合は、自分の回答を選んで編集してください。',
    };
  }
}

/** 公開リンクの共同編集を維持し、個人の予定反映だけセッション本人へ限定する。 */
export async function saveDateFirst(input: unknown) {
  const command = dateFirstCommandSchema.safeParse(input);
  if (!command.success)
    return {
      success: false as const,
      code: 'invalid_input',
      message: '入力内容を確認してください。',
    };
  const personal = [
    'previewSync',
    'applySync',
    'previewAnswerSchedule',
    'applyAnswerSchedule',
  ].includes(command.data.operation);
  const userId = personal ? (await getAuthSession())?.user?.id : undefined;
  const result = await executeDateFirst(command.data, userId);
  if (
    result.success &&
    'token' in command.data &&
    !['previewSync', 'previewAnswerSchedule'].includes(command.data.operation)
  ) {
    try {
      revalidatePath(`/event/${command.data.token}`);
    } catch {
      return {
        ...result,
        warning:
          '保存しました。表示の更新に失敗したため、再読み込みして保存結果を確認してください。',
      };
    }
  }
  return result;
}
/** 公開リンク内で、明示選択した既存回答を共同編集用に取得する。 */
export async function getDateFirstAnswer(token: string, participantId: string) {
  return readDateFirstAnswer(token, participantId);
}
/** 公開リンク内の日付詳細を、他の日付の展開状態と独立して取得する。 */
export async function getDateFirstDayDetails(token: string, dayId: string) {
  return readDateFirstDay(token, dayId);
}
