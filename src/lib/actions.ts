'use server';
import { createSupabaseAdmin, createSupabaseClient } from './supabase';
import { EventFetchError, EventNotFoundError } from './errors';
import { fetchAllPaginatedWithOrder, SupabaseQueryInterface } from './utils';
import type { Database } from './database.types';
import { v4 as uuidv4 } from 'uuid';
import { generatePublicToken } from './token';
import { revalidatePath } from 'next/cache';
import { getAuthSession } from '@/lib/auth';
import { cache } from 'react';
import { syncUserAvailabilities, upsertUserEventLink } from '@/lib/schedule-actions';

export type CreateEventSuccessResult = {
  success: true;
  publicToken: string;
  adminToken: string;
  redirectUrl: string;
};

export type CreateEventErrorResult = {
  success: false;
  message: string;
};

export type CreateEventActionResult = CreateEventSuccessResult | CreateEventErrorResult;

export type SubmitAvailabilityWarningCode = 'POST_SYNC_PARTIAL_FAILURE';

export type SubmitAvailabilityActionResult =
  | {
      success: true;
      message: string;
      participantId?: string;
      warningCodes?: SubmitAvailabilityWarningCode[];
    }
  | {
      success: false;
      message: string;
    };

type ParsedClockTime = {
  hours: number;
  minutes: number;
  seconds: number;
  is24HourEnd: boolean;
};

const toLocalDateTimeString = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;

const parseDateTimeParts = (value: string): { datePart: string; timePart: string } | null => {
  const matched = value
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!matched) return null;
  return {
    datePart: matched[1],
    timePart: matched[2],
  };
};

const parseClockTime = (value: string, allow24HourEnd: boolean): ParsedClockTime | null => {
  const matched = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!matched) return null;

  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  const seconds = Number(matched[3] ?? '0');
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds) ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }

  if (hours === 24 && minutes === 0 && seconds === 0 && allow24HourEnd) {
    return {
      hours: 0,
      minutes: 0,
      seconds: 0,
      is24HourEnd: true,
    };
  }

  if (hours < 0 || hours > 23) return null;
  return {
    hours,
    minutes,
    seconds,
    is24HourEnd: false,
  };
};

const createLocalDate = (datePart: string, clock: ParsedClockTime): Date | null => {
  const matched = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;

  const date = new Date(year, month - 1, day, clock.hours, clock.minutes, clock.seconds, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== clock.hours ||
    date.getMinutes() !== clock.minutes ||
    date.getSeconds() !== clock.seconds
  ) {
    return null;
  }

  return date;
};

const normalizeWallClockDateTimeRange = ({
  startDatePart,
  startTimePart,
  endDatePart,
  endTimePart,
}: {
  startDatePart: string;
  startTimePart: string;
  endDatePart: string;
  endTimePart: string;
}): { startTime: string; endTime: string } | null => {
  const startClock = parseClockTime(startTimePart, false);
  const endClock = parseClockTime(endTimePart, true);
  if (!startClock || !endClock) return null;

  const startDate = createLocalDate(startDatePart, startClock);
  const endDate = createLocalDate(endDatePart, endClock);
  if (!startDate || !endDate) return null;

  if (endClock.is24HourEnd) {
    endDate.setDate(endDate.getDate() + 1);
  }
  if (endDate <= startDate) {
    endDate.setDate(endDate.getDate() + 1);
  }

  return {
    startTime: toLocalDateTimeString(startDate),
    endTime: toLocalDateTimeString(endDate),
  };
};

/**
 * 新しいイベントを作成して候補日程を登録する
 * create_event_with_dates RPC を利用してトランザクション処理を行う
 */
export async function createEvent(formData: FormData): Promise<CreateEventActionResult> {
  const title = formData.get('title') as string;
  const description = formData.get('description') as string | null;

  // 日付と時間を別々に取得
  const startDates = formData.getAll('startDates') as string[];
  const startTimes = formData.getAll('startTimes') as string[];
  const endDates = formData.getAll('endDates') as string[];
  const endTimes = formData.getAll('endTimes') as string[];

  const useFullDateTime =
    startDates.length === 0 &&
    endDates.length === 0 &&
    startTimes.length === endTimes.length &&
    startTimes.every((t) => t.includes('T')) &&
    endTimes.every((t) => t.includes('T'));

  // Validation
  if (!title) {
    return { success: false, message: 'タイトルを入力してください' };
  }

  if (useFullDateTime) {
    if (!startTimes.length) {
      return { success: false, message: '候補日程の情報が正しくありません' };
    }
  } else {
    if (
      !startDates.length ||
      !startTimes.length ||
      !endDates.length ||
      !endTimes.length ||
      startDates.length !== startTimes.length ||
      startTimes.length !== endTimes.length
    ) {
      return { success: false, message: '候補日程の情報が正しくありません' };
    }
  }

  try {
    // Supabase 管理クライアント
    const supabaseAdmin = createSupabaseAdmin();

    // トークン生成
    const publicToken = generatePublicToken();
    const adminToken = uuidv4();

    // RPC に渡す日程データ配列
    const timeslots = [] as Array<{ start_time: string; end_time: string }>;

    if (useFullDateTime) {
      for (let i = 0; i < startTimes.length; i++) {
        timeslots.push({
          start_time: startTimes[i],
          end_time: endTimes[i],
        });
      }
    } else {
      for (let i = 0; i < startDates.length; i++) {
        const normalizedRange = normalizeWallClockDateTimeRange({
          startDatePart: startDates[i],
          startTimePart: startTimes[i],
          endDatePart: endDates[i],
          endTimePart: endTimes[i],
        });
        if (!normalizedRange) {
          return { success: false, message: '候補日程の情報が正しくありません' };
        }

        timeslots.push({
          start_time: normalizedRange.startTime,
          end_time: normalizedRange.endTime,
        });
      }
    }

    if (timeslots.length === 0) {
      return { success: false, message: '候補日程が生成できません' };
    }

    // RPCを用いてイベントと候補日程を登録
    const { data: created, error: createError } = await supabaseAdmin.rpc(
      'create_event_with_dates',
      {
        p_title: title,
        // descriptionがnullの場合は空文字を渡す
        p_description: description ?? '',
        p_public_token: publicToken,
        p_admin_token: adminToken,
        p_event_dates: timeslots,
      },
    );

    if (createError || !created?.length) {
      console.error('イベント作成エラー:', createError);
      return {
        success: false,
        message: 'DBエラー: イベント作成に失敗しました。もう一度お試しください。',
      };
    }

    const event = created[0];
    const createdEventId = event?.event_id;

    // ログイン済みの場合はサーバー側で履歴を同期する
    const session = await getAuthSession();
    if (session?.user?.id) {
      const { error: historyError } = await supabaseAdmin.rpc('upsert_event_access_history', {
        p_user_id: session.user.id,
        p_event_public_token: publicToken,
        p_event_title: title,
        p_is_created_by_me: true,
        p_accessed_at: new Date().toISOString(),
      });

      if (historyError) {
        console.error('イベント履歴の更新に失敗しました:', historyError);
      }

      if (createdEventId) {
        await upsertUserEventLink({
          userId: session.user.id,
          eventId: createdEventId,
          participantId: null,
        });
      }
    }

    // イベント作成が成功した場合、イベントページにリダイレクト
    // 管理ページURLは利用しなくなったため公開用URLのみを返す
    return {
      success: true,
      publicToken: event.public_token,
      adminToken: event.admin_token,
      redirectUrl: `/event/${event.public_token}`,
    };
  } catch (error) {
    console.error('イベント作成処理エラー:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '予期せぬエラーが発生しました',
    };
  }
}

/**
 * 特定の参加者IDに基づいて参加者情報と回答を取得する
 */
export async function getParticipantById(participantId: string, eventId: string) {
  const supabase = createSupabaseAdmin();

  // 参加者情報を取得
  const { data: participant, error: participantError } = await supabase
    .from('participants')
    .select('*')
    .eq('id', participantId)
    .eq('event_id', eventId)
    .single();

  if (participantError || !participant) {
    console.error('参加者取得エラー:', participantError);
    return null;
  }

  // 参加者の回答を取得
  let availabilities: Array<{ id: string; event_date_id: string; availability: boolean }>;
  try {
    const query = supabase
      .from('availabilities')
      .select('id,event_date_id,availability')
      .eq('participant_id', participantId)
      .eq('event_id', eventId);
    availabilities = await fetchAllPaginatedWithOrder(
      query as unknown as SupabaseQueryInterface,
      'created_at',
    );
  } catch (error) {
    console.error('回答取得エラー:', error);
    return null;
  }

  // 回答をイベント日付IDでマップ化
  const availabilityMap = availabilities.reduce(
    (acc, item) => {
      acc[item.event_date_id] = item.availability;
      return acc;
    },
    {} as Record<string, boolean>,
  );

  return {
    participant: redactCreationRequest(participant),
    availabilityMap,
  };
}

/**
 * 公開トークンからイベント情報を取得する
 *
 * @param publicToken - イベントの公開トークン
 * @throws {EventNotFoundError} イベントが存在しない場合
 * @throws {EventFetchError} Supabase からの取得に失敗した場合
 */
export async function getEvent(publicToken: string) {
  return getCachedEvent(publicToken);
}

/**
 * 公開トークンからイベント情報を取得する内部関数
 * 同一リクエスト内の重複取得を避けるため、cache()でラップして利用する。
 *
 * @param {string} publicToken - イベントの公開トークン
 * @returns {Promise<Database['public']['Tables']['events']['Row']>} イベント情報
 * @throws {EventNotFoundError} イベントが存在しない場合
 * @throws {EventFetchError} Supabase からの取得に失敗した場合
 */
const fetchEventByPublicToken = async (
  publicToken: string,
): Promise<Database['public']['Tables']['events']['Row']> => {
  const supabase = createSupabaseAdmin();

  // イベントを取得
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('public_token', publicToken)
    .single();

  if (error) {
    console.error('イベント取得エラー:', error);
    // 行が見つからない場合は NotFoundError を投げる
    if (error.code === 'PGRST116' || error.message.includes('no rows')) {
      throw new EventNotFoundError();
    }
    throw new EventFetchError(error.message);
  }

  if (!data) {
    // data が null の場合も NotFound とみなす
    throw new EventNotFoundError();
  }

  return redactCreationRequest(data);
};

/** 作成要求の再送照合に使う内部値は、公開リンクの取得結果へ転送しない。 */
function redactCreationRequest<T extends object>(row: T): T {
  return {
    ...row,
    ...('creation_request_id' in row ? { creation_request_id: null } : {}),
    ...('creation_payload_hash' in row ? { creation_payload_hash: null } : {}),
  };
}

const getCachedEvent = cache(fetchEventByPublicToken);

/**
 * イベントの最終アクセス時刻を、一定時間以上経過している場合のみ更新する
 *
 * @param {string} publicToken - イベントの公開トークン
 * @param {number} minIntervalMinutes - 更新間隔（分）
 * @returns {Promise<void>} 更新処理の完了
 */
export async function touchEventLastAccessedIfStale(
  publicToken: string,
  minIntervalMinutes = 15,
): Promise<void> {
  if (!publicToken) return;

  const supabase = createSupabaseAdmin();
  const now = new Date();
  const { data: eventRow, error: fetchError } = await supabase
    .from('events')
    .select('id,last_accessed_at')
    .eq('public_token', publicToken)
    .maybeSingle();
  if (fetchError) {
    console.error('イベント最終アクセス取得エラー:', fetchError);
    return;
  }
  if (!eventRow) {
    return;
  }

  const lastAccessedTime = eventRow.last_accessed_at
    ? new Date(eventRow.last_accessed_at).getTime()
    : null;
  const minIntervalMs = Math.max(minIntervalMinutes, 0) * 60 * 1000;
  if (lastAccessedTime !== null && now.getTime() - lastAccessedTime < minIntervalMs) {
    return;
  }

  const { error: updateError } = await supabase
    .from('events')
    .update({ last_accessed_at: now.toISOString() })
    .eq('id', eventRow.id);
  if (updateError) {
    console.error('イベント最終アクセス更新エラー:', updateError);
  }
}

/**
 * イベントIDに基づいて参加者一覧を取得する
 */
export async function getParticipants(
  eventId: string,
): Promise<Database['public']['Tables']['participants']['Row'][]> {
  const supabase = createSupabaseAdmin();

  try {
    const query = supabase.from('participants').select('*').eq('event_id', eventId);

    const participants = await fetchAllPaginatedWithOrder<
      Database['public']['Tables']['participants']['Row']
    >(query as unknown as SupabaseQueryInterface, 'created_at', {
      ascending: true,
    });
    return participants.map(redactCreationRequest);
  } catch (error) {
    console.error('参加者一覧取得エラー:', error);
    return [];
  }
}

/**
 * イベントの全回答データを取得する
 */
export async function getAvailabilities(
  eventId: string,
): Promise<Database['public']['Tables']['availabilities']['Row'][]> {
  const supabase = createSupabaseAdmin();

  try {
    const query = supabase.from('availabilities').select('*').eq('event_id', eventId);

    return await fetchAllPaginatedWithOrder<Database['public']['Tables']['availabilities']['Row']>(
      query as unknown as SupabaseQueryInterface,
      'created_at',
      {
        ascending: true,
      },
    );
  } catch (error) {
    console.error('回答データ取得エラー:', error);
    return [];
  }
}

/**
 * 確定した日程IDのリストを取得する
 */
export async function getFinalizedDateIds(eventId: string, finalDateId: string | null) {
  const supabase = createSupabaseAdmin();

  let data: Array<{ event_date_id: string }>;
  try {
    const query = supabase.from('finalized_dates').select('event_date_id').eq('event_id', eventId);
    data = await fetchAllPaginatedWithOrder(
      query as unknown as SupabaseQueryInterface,
      'created_at',
    );
  } catch (error) {
    console.error('確定日程取得エラー:', error);

    // 互換性のため、エラーが発生した場合やデータがない場合は
    // 古い形式（final_date_id）を使用
    if (finalDateId) {
      return [finalDateId];
    }

    return [];
  }

  if (data.length > 0) {
    // event_date_idの配列を返す
    return data.map((item) => item.event_date_id);
  } else if (finalDateId) {
    // 旧形式の互換性のため、finalized_dates テーブルにデータがない場合は
    // final_date_id があれば使用
    return [finalDateId];
  }

  // event.is_finalizedがtrueかつfinalDateIdが存在する場合は必ず返す
  if (data.length === 0 && finalDateId) {
    return [finalDateId];
  }

  return [];
}

// EventDate 型はテーブル定義に合わせてください
type EventDate = {
  id: string;
  event_id: string;
  start_time: string; // ISO 8601形式のタイムスタンプ
  end_time: string; // ISO 8601形式のタイムスタンプ
  label?: string | undefined; // 任意のラベル
  created_at: string; // ISO 8601形式のタイムスタンプ
};

/**
 * イベントIDに基づいて、Supabaseの1000件制限を超えて全件取得する
 */
export async function getEventDates(eventId: string): Promise<EventDate[]> {
  const supabase = createSupabaseAdmin();
  const pageSize = 1000; // 1ページあたり取得件数
  let page = 0; // ページカウンタ
  let allDates: EventDate[] = [];

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from('event_dates')
      .select('*')
      .eq('event_id', eventId)
      .order('start_time', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('イベント日程取得エラー:', error);
      break; // エラー時はループを抜けてこれまでの結果を返す
    }
    if (!data || data.length === 0) {
      break; // 取得データが空なら最後のページに到達
    }

    // Supabaseの型ではlabelがstring | nullのためnullを除外して結合
    allDates = allDates.concat(
      data.map((d) => ({
        ...d,
        label: d.label ?? undefined,
      })),
    );

    if (data.length < pageSize) {
      // 取得件数が pageSize 未満ならもう次ページは無い
      break;
    }
    page++;
  }

  return allDates;
}

/**
 * 参加者の回答を保存するアクション
 */
export async function submitAvailability(
  formData: FormData,
): Promise<SubmitAvailabilityActionResult> {
  try {
    const eventId = formData.get('eventId') as string;
    const publicToken = formData.get('publicToken') as string;
    const participantName = formData.get('participant_name') as string;
    const comment = (formData.get('comment') as string) || null;
    const syncScope = (formData.get('sync_scope') as string) === 'all' ? 'all' : 'current';
    const shouldDeferSync = (formData.get('sync_defer') as string) === 'true';
    const overrideDateIdsRaw = formData.get('override_date_ids') as string | null;
    let overrideDateIds: string[] = [];
    if (overrideDateIdsRaw) {
      try {
        overrideDateIds = JSON.parse(overrideDateIdsRaw) as string[];
      } catch (error) {
        console.error('上書き対象の解析に失敗しました:', error);
        overrideDateIds = [];
      }
    }

    if (!eventId || !publicToken || !participantName) {
      return { success: false, message: '必須項目が未入力です' };
    }

    // 編集モードの場合、既存の参加者IDが提供される
    const participantId = formData.get('participantId') as string | null;

    const availabilityEntries = [] as Array<{
      event_date_id: string;
      availability: boolean;
    }>;

    for (const [key, value] of formData.entries()) {
      if (key.startsWith('availability_')) {
        const dateId = key.replace('availability_', '');
        availabilityEntries.push({
          event_date_id: dateId,
          availability: value === 'on',
        });
      }
    }

    if (availabilityEntries.length === 0) {
      return {
        success: false,
        message: '少なくとも1つの回答を入力してください',
      };
    }

    const session = await getAuthSession();
    const userId = session?.user?.id ?? null;
    const supabase = createSupabaseAdmin();
    const { data: bundleData, error: bundleError } = await supabase.rpc(
      'submit_availability_bundle',
      {
        p_event_id: eventId,
        p_public_token: publicToken,
        p_participant_id: participantId,
        p_participant_name: participantName,
        p_comment: comment,
        p_availabilities: availabilityEntries,
        p_user_id: userId,
        p_override_date_ids: overrideDateIds,
      },
    );

    if (bundleError) {
      console.error('回答送信RPCエラー:', bundleError);
      if (bundleError.message.includes('イベントが見つかりません')) {
        return { success: false, message: 'イベントが見つかりません' };
      }
      if (bundleError.message.includes('参加者情報の更新に失敗')) {
        return { success: false, message: '参加者情報の更新に失敗しました' };
      }
      return {
        success: false,
        message: '回答の保存に失敗しました。時間をおいて再度お試しください。',
      };
    }

    const bundleResult = Array.isArray(bundleData) ? bundleData[0] : bundleData;
    if (!bundleResult?.success) {
      return {
        success: false,
        message:
          typeof bundleResult?.message === 'string'
            ? bundleResult.message
            : '回答の保存に失敗しました。時間をおいて再度お試しください。',
      };
    }

    const persistedParticipantId =
      typeof bundleResult.participant_id === 'string' ? bundleResult.participant_id : null;
    const eventTitle =
      typeof bundleResult.event_title === 'string' ? bundleResult.event_title : null;

    if (userId && syncScope === 'all' && !shouldDeferSync) {
      await syncUserAvailabilities({
        userId,
        scope: 'all',
        currentEventId: eventId,
      });
    }

    try {
      revalidatePath(`/event/${publicToken}`);
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('revalidatePath error:', e);
      }
    }

    type NonCriticalTaskResult = {
      task: 'event_history';
      success: boolean;
      message?: string;
      detail?: unknown;
    };

    const nonCriticalTasks: Array<Promise<NonCriticalTaskResult>> = [];
    if (userId && eventTitle) {
      nonCriticalTasks.push(
        (async () => {
          try {
            const { error } = await supabase.rpc('upsert_event_access_history', {
              p_user_id: userId,
              p_event_public_token: publicToken,
              p_event_title: eventTitle,
              p_is_created_by_me: false,
              p_accessed_at: new Date().toISOString(),
            });
            if (error) {
              return {
                task: 'event_history',
                success: false,
                message: 'イベント履歴同期に失敗しました',
                detail: error,
              } satisfies NonCriticalTaskResult;
            }
            return { task: 'event_history', success: true } satisfies NonCriticalTaskResult;
          } catch (error) {
            return {
              task: 'event_history',
              success: false,
              message: 'イベント履歴同期で例外が発生しました',
              detail: error,
            } satisfies NonCriticalTaskResult;
          }
        })(),
      );
    }

    const warningCodes: SubmitAvailabilityWarningCode[] = [];
    if (nonCriticalTasks.length > 0) {
      const results = await Promise.all(nonCriticalTasks);
      const failedTasks = results.filter((result) => !result.success);
      failedTasks.forEach((result) => {
        console.error('回答送信後の非必須更新に失敗しました:', {
          task: result.task,
          message: result.message,
          detail: result.detail,
        });
      });
      if (failedTasks.length > 0) {
        warningCodes.push('POST_SYNC_PARTIAL_FAILURE');
      }
    }

    return {
      success: true,
      message: '回答を送信しました。ありがとうございます！',
      ...(persistedParticipantId ? { participantId: persistedParticipantId } : {}),
      ...(warningCodes.length > 0 ? { warningCodes } : {}),
    };
  } catch (err) {
    console.error('Error in submitAvailability:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : '予期せぬエラーが発生しました',
    };
  }
}

/**
 * イベント日程確定アクション
 */
export async function finalizeEvent(eventId: string, dateIds: string[]) {
  try {
    if (!eventId || !dateIds) {
      return { success: false, message: '必須パラメータが不足しています' };
    }

    const supabase = createSupabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, public_token')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      console.error('Event retrieval error:', eventError);
      return { success: false, message: 'イベントが見つかりません' };
    }

    if (dateIds.length > 0) {
      const { data: dateCheck, error: dateCheckError } = await supabase
        .from('event_dates')
        .select('id')
        .eq('event_id', eventId)
        .in('id', dateIds);

      if (dateCheckError || !dateCheck || dateCheck.length !== dateIds.length) {
        console.error('Invalid date selection:', dateCheckError);
        return { success: false, message: '選択された日程が見つかりません' };
      }
    }

    const { error: finalizeError } = await supabase.rpc('finalize_event_safe', {
      p_event_id: eventId,
      p_date_ids: dateIds,
    });

    if (finalizeError) {
      console.error('Event finalization error:', finalizeError);
      return { success: false, message: 'イベント確定処理に失敗しました' };
    }

    try {
      revalidatePath(`/event/${event.public_token}`);
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('revalidatePath error:', e);
      }
    }

    try {
      const { data: linkedUsers } = await supabase
        .from('user_event_links')
        .select('user_id')
        .eq('event_id', eventId);

      const uniqueUserIds = Array.from(
        new Set((linkedUsers ?? []).map((row) => row.user_id).filter(Boolean)),
      );

      for (const userId of uniqueUserIds) {
        await syncUserAvailabilities({
          userId,
          scope: 'all',
          currentEventId: eventId,
        });
      }
    } catch (syncError) {
      console.error('確定イベントの同期エラー:', syncError);
    }

    const message = dateIds.length === 0 ? 'イベント確定を解除しました' : undefined;
    return { success: true, message };
  } catch (err) {
    console.error('Error in finalizeEvent:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : '予期せぬエラーが発生しました',
    };
  }
}

/**
 * イベントURLから参加情報を取得
 */
export async function getEventInfoFromUrl(eventUrl: string) {
  try {
    let publicToken = eventUrl.trim();

    if (publicToken.includes('/')) {
      const urlParts = publicToken.split('/');
      publicToken = urlParts[urlParts.length - 1];

      if (publicToken.includes('?')) {
        publicToken = publicToken.split('?')[0];
      }
    }

    if (!publicToken || publicToken.length < 5) {
      return { success: false, message: '無効なイベントURLまたはトークンです' };
    }

    const supabase = createSupabaseClient();

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, public_token, created_at')
      .eq('public_token', publicToken)
      .single();

    if (eventError || !event) {
      console.error('Event retrieval error:', eventError);
      return { success: false, message: 'イベントが見つかりません' };
    }

    const eventDatesQuery = supabase
      .from('event_dates')
      .select('id, start_time, end_time')
      .eq('event_id', event.id);
    const eventDates = await fetchAllPaginatedWithOrder<{
      id: string;
      start_time: string;
      end_time: string;
    }>(eventDatesQuery as unknown as SupabaseQueryInterface, 'start_time');

    return {
      success: true,
      event,
      eventDates,
    };
  } catch (err) {
    console.error('Error in getEventInfoFromUrl:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : '予期せぬエラーが発生しました',
    };
  }
}

/**
 * イベント間で回答をコピー
 */
export async function copyAvailabilityBetweenEvents(
  sourceEventUrl: string,
  targetEventId: string,
  participantName: string,
  matchType: 'exact' | 'time' | 'day' | 'both' = 'both',
) {
  try {
    if (!sourceEventUrl || !targetEventId || !participantName) {
      return { success: false, message: '必須パラメータが不足しています' };
    }

    const sourceResult = await getEventInfoFromUrl(sourceEventUrl);
    if (!sourceResult.success || !sourceResult.event) {
      return sourceResult;
    }

    const supabase = createSupabaseClient();

    const { data: targetEvent, error: targetEventError } = await supabase
      .from('events')
      .select('id, public_token')
      .eq('id', targetEventId)
      .single();

    if (targetEventError || !targetEvent) {
      console.error('Target event retrieval error:', targetEventError);
      return { success: false, message: 'コピー先のイベントが見つかりません' };
    }

    const targetDatesQuery = supabase
      .from('event_dates')
      .select('id, start_time, end_time')
      .eq('event_id', targetEventId);
    const targetDates = await fetchAllPaginatedWithOrder<{
      id: string;
      start_time: string;
      end_time: string;
    }>(targetDatesQuery as unknown as SupabaseQueryInterface, 'start_time');

    if (targetDates.length === 0) {
      return { success: false, message: 'コピー先の日程情報が取得できません' };
    }

    const { data: sourceParticipant, error: participantError } = await supabase
      .from('participants')
      .select('id')
      .eq('event_id', sourceResult.event.id)
      .eq('name', participantName)
      .maybeSingle();

    if (participantError) {
      console.error('Source participant retrieval error:', participantError);
      return { success: false, message: '参加者情報の取得に失敗しました' };
    }

    if (!sourceParticipant) {
      return {
        success: false,
        message: `コピー元のイベントに「${participantName}」という名前の参加者が見つかりません`,
      };
    }

    const sourceAvailabilitiesQuery = supabase
      .from('availabilities')
      .select('event_date_id, availability, event_date:event_dates(start_time, end_time)')
      .eq('participant_id', sourceParticipant.id);
    const sourceAvailabilities = await fetchAllPaginatedWithOrder<{
      event_date_id: string;
      availability: boolean;
      event_date: { start_time: string; end_time: string } | null;
    }>(sourceAvailabilitiesQuery as unknown as SupabaseQueryInterface, 'created_at');

    if (sourceAvailabilities.length === 0) {
      return {
        success: false,
        message: 'コピー元の回答データが見つかりません',
      };
    }

    interface AvailabilityMatch {
      event_id: string;
      event_date_id: string;
      availability: boolean;
      _sourceTimeKey?: string;
      _targetTimeKey?: string;
      _sourceDay?: number;
      _targetDay?: number;
    }

    const availabilityMatches: AvailabilityMatch[] = [];

    targetDates.forEach((targetDate) => {
      const targetStart = new Date(targetDate.start_time);
      const targetEnd = new Date(targetDate.end_time);
      const targetTimeKey = `${targetStart.getHours().toString().padStart(2, '0')}:${targetStart
        .getMinutes()
        .toString()
        .padStart(2, '0')}-${targetEnd.getHours().toString().padStart(2, '0')}:${targetEnd
        .getMinutes()
        .toString()
        .padStart(2, '0')}`;
      const targetDay = targetStart.getDay();

      let matchFound = false;

      for (const sourceAvail of sourceAvailabilities) {
        if (!sourceAvail.event_date) continue;

        const eventDate = Array.isArray(sourceAvail.event_date)
          ? sourceAvail.event_date[0]
          : sourceAvail.event_date;

        if (!eventDate || !eventDate.start_time || !eventDate.end_time) continue;

        const sourceStart = new Date(eventDate.start_time);
        const sourceEnd = new Date(eventDate.end_time);
        const sourceTimeKey = `${sourceStart.getHours().toString().padStart(2, '0')}:${sourceStart
          .getMinutes()
          .toString()
          .padStart(2, '0')}-${sourceEnd.getHours().toString().padStart(2, '0')}:${sourceEnd
          .getMinutes()
          .toString()
          .padStart(2, '0')}`;
        const sourceDay = sourceStart.getDay();

        let isMatch = false;

        switch (matchType) {
          case 'exact':
            isMatch =
              sourceStart.toISOString() === targetStart.toISOString() &&
              sourceEnd.toISOString() === targetEnd.toISOString();
            break;
          case 'time':
            isMatch = sourceTimeKey === targetTimeKey;
            break;
          case 'day':
            isMatch = sourceDay === targetDay;
            break;
          case 'both':
          default:
            isMatch = sourceTimeKey === targetTimeKey && sourceDay === targetDay;
            break;
        }

        if (isMatch) {
          availabilityMatches.push({
            event_id: targetEventId,
            event_date_id: targetDate.id,
            availability: sourceAvail.availability,
            _sourceTimeKey: sourceTimeKey,
            _targetTimeKey: targetTimeKey,
            _sourceDay: sourceDay,
            _targetDay: targetDay,
          });
          matchFound = true;
          break;
        }
      }

      if (!matchFound) {
        availabilityMatches.push({
          event_id: targetEventId,
          event_date_id: targetDate.id,
          availability: false,
        });
      }
    });

    let targetParticipantId: string;

    const { data: existingParticipant } = await supabase
      .from('participants')
      .select('id')
      .eq('event_id', targetEventId)
      .eq('name', participantName)
      .maybeSingle();

    if (existingParticipant) {
      targetParticipantId = existingParticipant.id;

      await supabase.from('availabilities').delete().eq('participant_id', targetParticipantId);
    } else {
      const responseToken = uuidv4();
      const { data: newParticipant, error: newPartError } = await supabase
        .from('participants')
        .insert({
          event_id: targetEventId,
          name: participantName,
          response_token: responseToken,
        })
        .select('id')
        .single();

      if (newPartError || !newParticipant) {
        console.error('Participant creation error:', newPartError);
        return { success: false, message: '参加者の作成に失敗しました' };
      }

      targetParticipantId = newParticipant.id;
    }

    const finalAvailabilities = availabilityMatches.map((item) => ({
      ...item,
      participant_id: targetParticipantId,
    }));

    const { error: insertError } = await supabase
      .from('availabilities')
      .insert(
        finalAvailabilities.map(
          ({ _sourceTimeKey, _targetTimeKey, _sourceDay, _targetDay, ...rest }) => rest,
        ),
      );

    if (insertError) {
      console.error('Availability insertion error:', insertError);
      return { success: false, message: '回答のコピーに失敗しました' };
    }

    const session = await getAuthSession();
    if (session?.user?.id) {
      await upsertUserEventLink({
        userId: session.user.id,
        eventId: targetEventId,
        participantId: targetParticipantId,
      });
    }

    try {
      revalidatePath(`/event/${targetEvent.public_token}`);
    } catch (e) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('revalidatePath error:', e);
      }
    }

    return {
      success: true,
      message: `${participantName}さんの回答をコピーしました`,
      matches: availabilityMatches.filter((m) => m.availability).length,
      total: availabilityMatches.length,
      participantId: targetParticipantId,
    };
  } catch (err) {
    console.error('Error in copyAvailabilityBetweenEvents:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : '予期せぬエラーが発生しました',
    };
  }
}

/**
 * 参加者IDを指定して回答をアカウントに紐づける
 */
export async function linkMyParticipantAnswerById({
  eventId,
  participantId,
  confirmNameMismatch: _confirmNameMismatch,
}: {
  eventId: string;
  participantId: string;
  confirmNameMismatch?: boolean;
}): Promise<{ success: boolean; message: string; requiresConfirmation?: boolean }> {
  const session = await getAuthSession();
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false, message: 'ログインが必要です' };
  }

  if (!eventId || !participantId) {
    return { success: false, message: 'イベントまたは参加者が不正です' };
  }

  try {
    const supabase = createSupabaseAdmin();
    const { data: participant, error: participantError } = await supabase
      .from('participants')
      .select('id,event_id,name')
      .eq('id', participantId)
      .eq('event_id', eventId)
      .maybeSingle();

    if (participantError || !participant) {
      return { success: false, message: '指定した回答が見つかりません' };
    }

    const { data: existingLink, error: existingLinkError } = await supabase
      .from('user_event_links')
      .select('user_id')
      .eq('participant_id', participantId)
      .maybeSingle();

    if (existingLinkError) {
      console.error('既存紐づけ確認エラー:', existingLinkError);
      return { success: false, message: '回答の確認に失敗しました' };
    }

    if (existingLink?.user_id && existingLink.user_id !== userId) {
      return {
        success: false,
        message: 'この回答はすでに別アカウントに紐づいています',
      };
    }

    const linkResult = await upsertUserEventLink({
      userId,
      eventId,
      participantId,
    });
    if (!linkResult.success) {
      if (linkResult.code === '23505') {
        return {
          success: false,
          message: 'この回答はすでに別アカウントに紐づいています',
        };
      }
      return {
        success: false,
        message: linkResult.message ?? '回答の紐づけに失敗しました',
      };
    }

    return { success: true, message: '回答をアカウントに紐づけました' };
  } catch (error) {
    console.error('回答ID紐づけエラー:', error);
    return { success: false, message: '回答の紐づけに失敗しました' };
  }
}

/**
 * 指定したイベントの回答紐づけを解除する
 */
export async function unlinkMyParticipantAnswerByEventPublicToken(
  eventPublicToken: string,
): Promise<{ success: boolean; message: string }> {
  const session = await getAuthSession();
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false, message: 'ログインが必要です' };
  }

  if (!eventPublicToken) {
    return { success: false, message: 'イベントが不正です' };
  }

  try {
    const supabase = createSupabaseAdmin();
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id')
      .eq('public_token', eventPublicToken)
      .maybeSingle();

    if (eventError || !event?.id) {
      return { success: false, message: '対象イベントが見つかりません' };
    }

    const linkResult = await upsertUserEventLink({
      userId,
      eventId: event.id,
      participantId: null,
    });

    if (!linkResult.success) {
      return {
        success: false,
        message: linkResult.message ?? '回答紐づけの解除に失敗しました',
      };
    }

    return { success: true, message: '回答の紐づけを解除しました' };
  } catch (error) {
    console.error('回答紐づけ解除エラー:', error);
    return { success: false, message: '回答紐づけの解除に失敗しました' };
  }
}

/**
 * ログインユーザーに紐づく、このイベントの参加者IDを取得する
 */
export async function getMyLinkedParticipantIdForEvent(eventId: string): Promise<string | null> {
  const session = await getAuthSession();
  const userId = session?.user?.id;
  if (!userId || !eventId) return null;

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from('user_event_links')
      .select('participant_id')
      .eq('user_id', userId)
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) {
      console.error('紐づき回答取得エラー:', error);
      return null;
    }

    return data?.participant_id ?? null;
  } catch (error) {
    console.error('紐づき回答取得例外:', error);
    return null;
  }
}

/**
 * イベント日程追加アクション
 */
export async function addEventDates(formData: FormData) {
  try {
    const eventId = formData.get('eventId') as string;
    const starts = formData.getAll('start') as string[];
    const ends = formData.getAll('end') as string[];

    if (!eventId || !starts.length || !ends.length || starts.length !== ends.length) {
      return {
        success: false,
        message: '日程追加に必要な情報が不足しています',
      };
    }

    const supabase = createSupabaseAdmin();

    const dateEntries = starts
      .map((start, i) => {
        const startParts = parseDateTimeParts(start);
        const endParts = parseDateTimeParts(ends[i]);
        if (!startParts || !endParts) return null;

        const normalizedRange = normalizeWallClockDateTimeRange({
          startDatePart: startParts.datePart,
          startTimePart: startParts.timePart,
          endDatePart: endParts.datePart,
          endTimePart: endParts.timePart,
        });
        if (!normalizedRange) return null;

        return {
          start_time: normalizedRange.startTime,
          end_time: normalizedRange.endTime,
        };
      })
      .filter(
        (
          row,
        ): row is {
          start_time: string;
          end_time: string;
        } => row !== null,
      );

    if (dateEntries.length !== starts.length) {
      return {
        success: false,
        message: '日程の形式が正しくありません',
      };
    }

    const { error: addError } = await supabase.rpc('add_event_dates_safe', {
      p_event_id: eventId,
      p_event_dates: dateEntries,
    });

    if (addError) {
      console.error('Event dates addition error:', addError);
      if (addError.message && addError.message.includes('既存の日程と重複しています')) {
        return { success: false, message: '既存の日程と重複しています' };
      }
      return { success: false, message: '日程の追加に失敗しました' };
    }

    return { success: true };
  } catch (err) {
    console.error('addEventDates error:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : '予期せぬエラーが発生しました',
    };
  }
}

/**
 * 参加者名の重複チェック
 */
export async function checkParticipantExists(eventId: string, name: string) {
  try {
    if (!eventId || !name.trim()) {
      return { exists: false };
    }
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from('participants')
      .select('id')
      .eq('event_id', eventId)
      .eq('name', name.trim())
      .maybeSingle();
    if (error) {
      console.error('参加者検索エラー:', error);
      return { exists: false };
    }
    return { exists: !!data };
  } catch (err) {
    console.error('checkParticipantExists error:', err);
    return { exists: false };
  }
}
