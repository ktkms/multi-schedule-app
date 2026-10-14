/**
 * 日付フォーマット用ユーティリティ関数およびその他のユーティリティ
 */

// Supabase クエリに関するインターフェース
export interface SupabaseQueryInterface {
  range(from: number, to: number): SupabaseQueryInterface;
  order(column: string, options?: { ascending: boolean }): SupabaseQueryInterface;
  then<T>(onfulfilled?: (value: T) => T | PromiseLike<T>): Promise<T>;
}

// Supabaseのクエリ結果インターフェース
export interface SupabaseQueryResult<T> {
  data: T[] | null;
  error: Error | null;
}

// タイムスロットのインターフェース定義
export interface TimeSlot {
  date: Date;
  startTime: string; // HH:mm形式
  endTime: string; // HH:mm形式
}

// 日付を「YYYY/MM/DD」形式でフォーマットする
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

// 日付を「YYYY/MM/DD HH:MM」形式でフォーマットする
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

// 曜日を取得する（日本語）
export function getDayOfWeek(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
  return dayOfWeek[d.getDay()];
}

// 日付を「M/D (曜)」形式でフォーマットする
export function formatDateWithDay(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayOfWeek = getDayOfWeek(d);
  return `${month}/${day} (${dayOfWeek})`;
}

// 日付を「M/D (曜) HH:MM」形式でフォーマットする
export function formatDateTimeWithDay(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayOfWeek = getDayOfWeek(d);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${month}/${day} (${dayOfWeek}) ${hours}:${minutes}`;
}

// 時刻を「HH:MM」形式でフォーマットする
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  // 00:00は24:00として表示する条件があれば、ここでチェック
  if (hours === '00' && minutes === '00') {
    // 呼び出し側で前日の日付かどうかチェックが必要な場合は
    // そのロジックを追加する。基本的には単純に表示するだけ
    return '00:00';
  }

  return `${hours}:${minutes}`;
}

/**
 * Googleカレンダー用の日時フォーマットに変換する（UTC形式）
 * 形式: YYYYMMDDTHHmmssZ
 */
export function formatGoogleCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  // GoogleカレンダーではUTC形式（Z付き）
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * ICS形式の日時フォーマットに変換する（日本時間）
 * 形式: YYYYMMDDTHHmmss
 */
export function formatIcsDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  // ICS形式（日本時間を想定）
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * 日付を日本語形式でフォーマットする (YYYY年MM月DD日(曜日))
 */
export function formatJapaneseDate(date: Date): string {
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = weekdays[date.getDay()];

  return `${year}年${month}月${day}日(${weekday})`;
}

/**
 * 日時を日本語形式でフォーマットする (YYYY年MM月DD日(曜日) HH:mm)
 */
export function formatJapaneseDateTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${formatJapaneseDate(date)} ${hours}:${minutes}`;
}

/**
 * UUIDを生成する（クライアント側での一時的なID生成用）
 */
export function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Supabaseのクエリを使って、ページネーション処理を行いながら全てのデータを取得する関数
 * @param query Supabaseのクエリオブジェクト（from().select()など）
 * @param pageSize 1回あたりの取得サイズ（最大1000）
 * @returns 全データの配列
 */
export async function fetchAllPaginated<T>(
  query: SupabaseQueryInterface,
  pageSize = 1000,
): Promise<T[]> {
  return fetchAllPaginatedWithOrder<T>(query, 'created_at', { ascending: false }, pageSize);
}

/**
 * 指定したフィールドで並べ替えたデータをページネーション処理しながら全て取得する関数
 * 同値の行は一意なidの昇順で並べ、ページ境界での重複取得・取得漏れを防ぐ。
 * 取得中の追加・削除・並べ替え対象の更新に対するスナップショットは保証しない。
 * @param query 一意なid列を持つテーブルのSupabaseクエリ。並べ替えは未指定であること。
 * @param orderField 並び替えのフィールド
 * @param options 並び替えオプション
 * @param pageSize 1回あたりの取得サイズ（最大1000）
 * @returns 全データの配列
 */
export async function fetchAllPaginatedWithOrder<T>(
  query: SupabaseQueryInterface,
  orderField: string,
  options: { ascending: boolean } = { ascending: true },
  pageSize = 1000,
): Promise<T[]> {
  // orderはクエリを変更してソート条件を追記するため、ページごとに繰り返さない。
  let orderedQuery = query.order(orderField, options);
  if (orderField !== 'id') {
    orderedQuery = orderedQuery.order('id', { ascending: true });
  }

  let allData: T[] = [];
  let page = 0;
  let hasMoreData = true;

  while (hasMoreData) {
    const result = (await orderedQuery.range(
      page * pageSize,
      (page + 1) * pageSize - 1,
    )) as unknown as SupabaseQueryResult<T>;

    const { data, error } = result;

    if (error) {
      console.error('データ取得エラー:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      hasMoreData = false;
    } else {
      allData = [...allData, ...data];

      if (data.length < pageSize) {
        hasMoreData = false;
      } else {
        page++;
      }
    }
  }

  return allData;
}

/**
 * 履歴に保存するイベント情報の型定義
 */
export interface EventHistoryItem {
  id: string; // イベントの公開ID
  title: string; // イベントのタイトル
  createdAt: string; // 作成日時またはアクセス日時（ISO文字列）
  isCreatedByMe: boolean; // 自分が作成したかどうか
  answeredByMe?: boolean; // 自分の回答が紐づいているかどうか
  myParticipantName?: string | null; // 自分の回答名
}

type StoredEventHistoryItem = EventHistoryItem & { adminToken?: string };

// ローカルストレージのキー
const EVENT_HISTORY_KEY = 'multi_schedule_event_history';
export const EVENT_HISTORY_DEFAULT_MAX_ITEMS = 10;
export const EVENT_HISTORY_SYNC_MAX_ITEMS = 30;

/**
 * 過去のイベント履歴をローカルストレージから取得する
 */
export function getEventHistory(): EventHistoryItem[] {
  if (typeof window === 'undefined') return [];

  try {
    const historyJson = localStorage.getItem(EVENT_HISTORY_KEY);
    if (!historyJson) return [];

    const history = JSON.parse(historyJson) as StoredEventHistoryItem[];
    return history.map((item) => ({
      id: item.id,
      title: item.title,
      createdAt: item.createdAt,
      isCreatedByMe: Boolean(item.isCreatedByMe),
      answeredByMe: Boolean(item.answeredByMe),
      myParticipantName: item.myParticipantName ?? null,
    }));
  } catch (error) {
    console.error('イベント履歴の取得に失敗しました:', error);
    return [];
  }
}

/**
 * イベントを履歴に追加する
 * @param event 追加するイベント情報
 * @param maxItems 履歴の最大保持数
 */
export function addEventToHistory(
  event: EventHistoryItem,
  maxItems = EVENT_HISTORY_DEFAULT_MAX_ITEMS,
): void {
  if (typeof window === 'undefined') return;

  try {
    let history = getEventHistory();

    // 同じIDのイベントが既に存在する場合は削除（後で先頭に追加するため）
    history = history.filter((item) => item.id !== event.id);

    // 新しいイベントを先頭に追加
    history.unshift(event);

    // 最大数を超えた場合、古いものから削除
    if (history.length > maxItems) {
      history = history.slice(0, maxItems);
    }

    // 保存
    localStorage.setItem(EVENT_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('イベント履歴の保存に失敗しました:', error);
  }
}

/**
 * イベント履歴を指定した配列で上書きする
 * @param history 保存する履歴配列
 */
export function setEventHistory(history: EventHistoryItem[]): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(EVENT_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('イベント履歴の上書きに失敗しました:', error);
  }
}

/**
 * 特定のイベントを履歴から削除する
 */
export function removeEventFromHistory(eventId: string): void {
  if (typeof window === 'undefined') return;

  try {
    let history = getEventHistory();
    history = history.filter((item) => item.id !== eventId);
    localStorage.setItem(EVENT_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('イベント履歴の削除に失敗しました:', error);
  }
}

/**
 * 全てのイベント履歴を削除する
 */
export function clearEventHistory(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(EVENT_HISTORY_KEY);
  } catch (error) {
    console.error('イベント履歴のクリアに失敗しました:', error);
  }
}

/**
 * Googleカレンダー予定作成画面のURLを生成する
 * @param title イベントタイトル
 * @param start ISO8601形式の開始日時（例: 2025-05-10T10:00:00Z）
 * @param end ISO8601形式の終了日時（例: 2025-05-10T11:00:00Z）
 * @param description イベント説明（省略可）
 * @param location 開催場所（省略可）
 * @returns Googleカレンダー予定作成画面のURL
 */
export function generateGoogleCalendarUrl({
  title,
  start,
  end,
  description = '',
  location = '',
}: {
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
}): string {
  // Googleカレンダーの日時形式: YYYYMMDDTHHmmssZ
  const format = (iso: string) => {
    const d = new Date(iso);
    // Google Calendar format: YYYYMMDDTHHmmssZ (UTC形式)
    return (
      d.getUTCFullYear().toString() +
      (d.getUTCMonth() + 1).toString().padStart(2, '0') +
      d.getUTCDate().toString().padStart(2, '0') +
      'T' +
      d.getUTCHours().toString().padStart(2, '0') +
      d.getUTCMinutes().toString().padStart(2, '0') +
      d.getUTCSeconds().toString().padStart(2, '0') +
      'Z'
    );
  };
  const params = new URLSearchParams({
    text: title,
    dates: `${format(start)}/${format(end)}`,
    details: description,
    location,
  });
  return `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`;
}
