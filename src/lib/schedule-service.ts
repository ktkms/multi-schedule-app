import 'server-only';
import type { PoolClient } from 'pg';

import { authPool, getAuthSession } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase';
import {
  computeAutoFillAvailability,
  isFutureScheduleDate,
  isRangeOverlapping,
  toComparableDate,
  toTokyoWallClockDate,
  toWallClockUtcIso,
  type ScheduleBlock,
} from '@/lib/schedule-utils';

type EventDateRange = {
  id: string;
  event_id?: string;
  start_time: string;
  end_time: string;
};

type ScheduleContext = {
  isAuthenticated: boolean;
  hasSyncTargetEvents: boolean;
  lockedDateIds: string[];
  autoFillAvailabilities: Record<string, boolean>;
  dailyAutoFillDateIds: string[];
  overrideDateIds: string[];
  coveredDateIds: string[];
  uncoveredDateKeys: string[];
  uncoveredDayCount: number;
  requireWeeklyStep: boolean;
  hasAccountSeedData: boolean;
};

type UserScheduleBlockRow = {
  id: string;
  start_time: string;
  end_time: string;
  availability: boolean;
  source: string;
  event_id: string | null;
  updated_at?: string;
};

export type UserScheduleBounds = {
  minStartTime: string | null;
  maxEndTime: string | null;
};

type SyncPreviewDateRow = {
  eventDateId: string;
  startTime: string;
  endTime: string;
  currentAvailability: boolean;
  desiredAvailability: boolean;
  willChange: boolean;
  isProtected: boolean;
};

export type UserAvailabilitySyncPreviewEvent = {
  eventId: string;
  publicToken: string;
  title: string;
  isFinalized: boolean;
  changes: {
    total: number;
    availableToUnavailable: number;
    unavailableToAvailable: number;
    protected: number;
  };
  dates: SyncPreviewDateRow[];
};

export type UserAvailabilitySyncPreviewResult =
  | {
      success: true;
      events: UserAvailabilitySyncPreviewEvent[];
    }
  | {
      success: false;
      reason: 'unauthenticated';
      message: string;
      events: [];
    };

const toLocalDateTimeString = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;

const normalizeManualBlockRange = ({
  startTime,
  endTime,
}: {
  startTime: string;
  endTime: string;
}): { startTime: string; endTime: string } => {
  const startDate = toComparableDate(startTime);
  const endDate = toComparableDate(endTime);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { startTime, endTime };
  }

  const isSameDay =
    startDate.getFullYear() === endDate.getFullYear() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getDate() === endDate.getDate();
  const isMidnightEnd =
    endDate.getHours() === 0 &&
    endDate.getMinutes() === 0 &&
    endDate.getSeconds() === 0 &&
    endDate.getMilliseconds() === 0;

  // 同日 00:00 終了は「その日の終わり（翌日00:00）」として補正する。
  if (isSameDay && isMidnightEnd && endDate <= startDate) {
    const adjustedEnd = new Date(endDate);
    adjustedEnd.setDate(adjustedEnd.getDate() + 1);
    return {
      startTime: toLocalDateTimeString(startDate),
      endTime: toLocalDateTimeString(adjustedEnd),
    };
  }

  return { startTime, endTime };
};

const computeAccountBlockAutoFill = ({
  start,
  end,
  blocks,
}: {
  start: string;
  end: string;
  blocks: ScheduleBlock[];
}): boolean | null => {
  const targetRange = {
    start: toComparableDate(start),
    end: toComparableDate(end),
  };
  const overlappingBlocks = blocks.filter((block) =>
    isRangeOverlapping(targetRange, {
      start: toComparableDate(block.start_time),
      end: toComparableDate(block.end_time),
    }),
  );

  if (overlappingBlocks.length > 0) {
    return computeAutoFillAvailability({
      start,
      end,
      blocks: overlappingBlocks,
    });
  }

  return null;
};

type SyncPreviewBuildOptions = {
  targetEventIds?: string[];
  excludeEventId?: string;
  proposedBlocks?: ScheduleBlock[];
  strict?: boolean;
};

type SyncPreviewLink = {
  event_id: string;
  participant_id: string;
};

type SyncPreviewContext = {
  links: SyncPreviewLink[];
  eventsMap: Map<
    string,
    {
      id: string;
      title: string;
      public_token: string;
      is_finalized: boolean;
    }
  >;
  blocks: ScheduleBlock[];
  busyIntervals: Array<{ event_id: string; start_time: string; end_time: string }>;
  eventDatesByEventId: Map<string, EventDateRange[]>;
  protectedDateIdsByEventId: Map<string, Set<string>>;
  currentAvailabilitiesByParticipantId: Map<string, Map<string, boolean>>;
};

const SUPABASE_PAGE_SIZE = 1000;

const toLocalDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const resolveWeekRange = (
  weekStartDate: string,
): { rangeStart: string; rangeEnd: string } | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) return null;
  const weekStart = new Date(`${weekStartDate}T00:00:00`);
  if (Number.isNaN(weekStart.getTime())) return null;
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return {
    rangeStart: toWallClockUtcIso(`${weekStartDate}T00:00:00`),
    rangeEnd: toWallClockUtcIso(`${toLocalDateKey(weekEnd)}T00:00:00`),
  };
};

const fetchEventDateRanges = async (
  supabase: ReturnType<typeof createSupabaseAdmin>,
  eventIds: string[],
  strict = false,
): Promise<EventDateRange[]> => {
  const rows: EventDateRange[] = [];
  if (eventIds.length === 0) return rows;

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('event_dates')
      .select('id,event_id,start_time,end_time')
      .in('event_id', eventIds)
      .order('start_time', { ascending: true })
      .range(from, to);

    if (error) {
      if (strict) throw new Error('同期に必要なデータを取得できませんでした');
      console.error('イベント日程取得エラー:', error);
      return rows;
    }

    rows.push(
      ...((data ?? []).map((row) => ({
        id: row.id,
        event_id: row.event_id,
        start_time: row.start_time,
        end_time: row.end_time,
      })) as EventDateRange[]),
    );

    if (!data || data.length < SUPABASE_PAGE_SIZE) return rows;
  }
};

const fetchSyncPreviewOverrideRows = async (
  supabase: ReturnType<typeof createSupabaseAdmin>,
  userId: string,
  eventIds: string[],
  strict = false,
): Promise<Array<{ event_id: string; event_date_id: string }>> => {
  const rows: Array<{ event_id: string; event_date_id: string }> = [];
  if (eventIds.length === 0) return rows;

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('user_event_availability_overrides')
      .select('event_id,event_date_id')
      .eq('user_id', userId)
      .in('event_id', eventIds)
      .order('event_id', { ascending: true })
      .order('event_date_id', { ascending: true })
      .range(from, to);

    if (error) {
      if (strict) throw new Error('同期に必要なデータを取得できませんでした');
      console.error('上書き情報取得エラー:', error);
      return rows;
    }

    rows.push(...((data ?? []) as typeof rows));

    if (!data || data.length < SUPABASE_PAGE_SIZE) return rows;
  }
};

const fetchSyncPreviewAvailabilityRows = async (
  supabase: ReturnType<typeof createSupabaseAdmin>,
  participantIds: string[],
  strict = false,
): Promise<Array<{ participant_id: string; event_date_id: string; availability: boolean }>> => {
  const rows: Array<{ participant_id: string; event_date_id: string; availability: boolean }> = [];
  if (participantIds.length === 0) return rows;

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('availabilities')
      .select('participant_id,event_date_id,availability')
      .in('participant_id', participantIds)
      .order('participant_id', { ascending: true })
      .order('event_date_id', { ascending: true })
      .range(from, to);

    if (error) {
      if (strict) throw new Error('同期に必要なデータを取得できませんでした');
      console.error('現在回答取得エラー:', error);
      return rows;
    }

    rows.push(...((data ?? []) as typeof rows));

    if (!data || data.length < SUPABASE_PAGE_SIZE) return rows;
  }
};

const fetchAvailabilityOverrideRows = async (
  supabase: ReturnType<typeof createSupabaseAdmin>,
  userId: string,
  eventIds: string[],
): Promise<Array<{ event_id: string; event_date_id: string; availability: boolean }>> => {
  const rows: Array<{ event_id: string; event_date_id: string; availability: boolean }> = [];
  if (eventIds.length === 0) return rows;

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('user_event_availability_overrides')
      .select('event_id,event_date_id,availability')
      .eq('user_id', userId)
      .in('event_id', eventIds)
      .order('event_id', { ascending: true })
      .order('event_date_id', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('上書き情報取得エラー:', error);
      return rows;
    }

    rows.push(...((data ?? []) as typeof rows));

    if (!data || data.length < SUPABASE_PAGE_SIZE) return rows;
  }
};

const fetchScheduleBlocksInRange = async ({
  supabase,
  userId,
  minStart,
  maxEnd,
  strict = false,
}: {
  supabase: ReturnType<typeof createSupabaseAdmin>;
  userId: string;
  minStart: string;
  maxEnd: string;
  strict?: boolean;
}): Promise<ScheduleBlock[]> => {
  const rows: ScheduleBlock[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('user_schedule_blocks')
      .select('start_time,end_time,availability')
      .eq('user_id', userId)
      .lt('start_time', maxEnd)
      .gt('end_time', minStart)
      .order('start_time', { ascending: true })
      .range(from, to);

    if (error) {
      if (strict) throw new Error('予定ブロックを取得できませんでした');
      console.error('予定ブロック取得エラー:', error);
      return rows;
    }

    rows.push(...((data ?? []) as ScheduleBlock[]));

    if (!data || data.length < SUPABASE_PAGE_SIZE) return rows;
  }
};

const buildSyncPreviewContext = async (
  userId: string,
  options?: SyncPreviewBuildOptions,
): Promise<SyncPreviewContext> => {
  const supabase = createSupabaseAdmin();

  const { data: allLinks, error: linkError } = await supabase
    .from('user_event_links')
    .select('event_id,participant_id')
    .eq('user_id', userId);

  if (linkError || !allLinks) {
    if (options?.strict) throw new Error('イベント紐づきを取得できませんでした');
    console.error('イベント紐付け取得エラー:', linkError);
    return {
      links: [],
      eventsMap: new Map(),
      blocks: [],
      busyIntervals: [],
      eventDatesByEventId: new Map(),
      protectedDateIdsByEventId: new Map(),
      currentAvailabilitiesByParticipantId: new Map(),
    };
  }

  const targetSet =
    options?.targetEventIds && options.targetEventIds.length > 0
      ? new Set(options.targetEventIds)
      : null;
  const links = allLinks
    .filter(
      (
        row,
      ): row is {
        event_id: string;
        participant_id: string;
      } => Boolean(row.event_id) && Boolean(row.participant_id),
    )
    .filter((row) => !targetSet || targetSet.has(row.event_id))
    .filter((row) => (options?.excludeEventId ? row.event_id !== options.excludeEventId : true));

  if (links.length === 0) {
    return {
      links: [],
      eventsMap: new Map(),
      blocks: [],
      busyIntervals: [],
      eventDatesByEventId: new Map(),
      protectedDateIdsByEventId: new Map(),
      currentAvailabilitiesByParticipantId: new Map(),
    };
  }

  const allEventIds = Array.from(new Set(allLinks.map((row) => row.event_id).filter(Boolean)));
  const scopedEventIds = Array.from(new Set(links.map((row) => row.event_id)));
  const scopedParticipantIds = Array.from(new Set(links.map((row) => row.participant_id)));

  const allEventDates = await fetchEventDateRanges(supabase, scopedEventIds, options?.strict);
  const eventDatesByEventId = new Map<string, EventDateRange[]>();
  allEventDates.forEach((row) => {
    if (!row.event_id) return;
    const current = eventDatesByEventId.get(row.event_id) ?? [];
    current.push({
      id: row.id,
      event_id: row.event_id,
      start_time: row.start_time,
      end_time: row.end_time,
    });
    eventDatesByEventId.set(row.event_id, current);
  });

  const blocks =
    allEventDates.length > 0
      ? await fetchScheduleBlocksInRange({
          supabase,
          userId,
          strict: options?.strict,
          minStart: allEventDates
            .map((row) => row.start_time)
            .reduce((min, value) => (value < min ? value : min), allEventDates[0].start_time),
          maxEnd: allEventDates
            .map((row) => row.end_time)
            .reduce((max, value) => (value > max ? value : max), allEventDates[0].end_time),
        })
      : [];

  const { data: finalizedDates, error: finalizedError } =
    allEventIds.length > 0
      ? await supabase
          .from('finalized_dates')
          .select('event_id,event_date_id,event_dates(start_time,end_time)')
          .in('event_id', allEventIds)
      : { data: [], error: null };

  if (options?.strict && finalizedError) throw new Error('確定日程を取得できませんでした');

  const busyIntervals = (finalizedDates ?? [])
    .map((row) => {
      const eventDate = Array.isArray(row.event_dates) ? row.event_dates[0] : row.event_dates;
      if (!eventDate?.start_time || !eventDate?.end_time) return null;
      return {
        event_id: row.event_id,
        start_time: eventDate.start_time,
        end_time: eventDate.end_time,
      };
    })
    .filter((row): row is { event_id: string; start_time: string; end_time: string } =>
      Boolean(row),
    );

  const { data: eventsData, error: eventsError } = await supabase
    .from('events')
    .select('id,title,public_token,is_finalized,scheduling_mode')
    .in('id', scopedEventIds);
  if (eventsError) {
    if (options?.strict) throw new Error('イベント情報を取得できませんでした');
    console.error('イベント情報取得エラー:', eventsError);
  }
  const eventsMap = new Map(
    (eventsData ?? [])
      .filter((row) => row.scheduling_mode !== 'date_first')
      .map((row) => [row.id, row]),
  );

  const overrides = await fetchSyncPreviewOverrideRows(
    supabase,
    userId,
    scopedEventIds,
    options?.strict,
  );
  const protectedDateIdsByEventId = new Map<string, Set<string>>();
  overrides.forEach((row) => {
    const set = protectedDateIdsByEventId.get(row.event_id) ?? new Set<string>();
    set.add(row.event_date_id);
    protectedDateIdsByEventId.set(row.event_id, set);
  });

  const currentAvailabilities = await fetchSyncPreviewAvailabilityRows(
    supabase,
    scopedParticipantIds,
    options?.strict,
  );
  const currentAvailabilitiesByParticipantId = new Map<string, Map<string, boolean>>();
  currentAvailabilities.forEach((row) => {
    const map = currentAvailabilitiesByParticipantId.get(row.participant_id) ?? new Map();
    map.set(row.event_date_id, row.availability);
    currentAvailabilitiesByParticipantId.set(row.participant_id, map);
  });

  return {
    links,
    eventsMap,
    blocks,
    busyIntervals,
    eventDatesByEventId,
    protectedDateIdsByEventId,
    currentAvailabilitiesByParticipantId,
  };
};

const buildUserAvailabilitySyncPreview = async (
  userId: string,
  options?: SyncPreviewBuildOptions,
): Promise<UserAvailabilitySyncPreviewEvent[]> => {
  const context = await buildSyncPreviewContext(userId, options);
  if (options?.proposedBlocks) {
    const proposed = options.proposedBlocks;
    const keys = new Set(
      proposed.map(
        (row) => `${toWallClockUtcIso(row.start_time)}/${toWallClockUtcIso(row.end_time)}`,
      ),
    );
    context.blocks = [
      ...context.blocks.filter(
        (row) =>
          !keys.has(`${toWallClockUtcIso(row.start_time)}/${toWallClockUtcIso(row.end_time)}`),
      ),
      ...proposed,
    ];
  }
  if (context.links.length === 0) return [];

  const previewEvents: UserAvailabilitySyncPreviewEvent[] = [];
  const now = toTokyoWallClockDate();

  for (const link of context.links) {
    const eventInfo = context.eventsMap.get(link.event_id);
    if (!eventInfo) continue;
    const eventDates = (context.eventDatesByEventId.get(link.event_id) ?? []).filter((date) =>
      isFutureScheduleDate(date, now),
    );
    if (eventDates.length === 0) continue;
    const protectedSet = context.protectedDateIdsByEventId.get(link.event_id) ?? new Set<string>();
    const currentMap =
      context.currentAvailabilitiesByParticipantId.get(link.participant_id) ??
      new Map<string, boolean>();

    const dates: SyncPreviewDateRow[] = eventDates.map((date) => {
      const currentAvailability = currentMap.get(date.id) ?? false;

      let desiredAvailability = currentAvailability;
      const hasBusyOverlap = context.busyIntervals.some((busy) => {
        if (busy.event_id === link.event_id) return false;
        return isRangeOverlapping(
          { start: new Date(date.start_time), end: new Date(date.end_time) },
          { start: new Date(busy.start_time), end: new Date(busy.end_time) },
        );
      });

      if (hasBusyOverlap) {
        desiredAvailability = false;
      } else {
        const auto = computeAccountBlockAutoFill({
          start: date.start_time,
          end: date.end_time,
          blocks: context.blocks,
        });
        if (auto !== null) {
          desiredAvailability = auto;
        }
      }

      const willChange = currentAvailability !== desiredAvailability;
      const isProtected = protectedSet.has(date.id);

      return {
        eventDateId: date.id,
        startTime: date.start_time,
        endTime: date.end_time,
        currentAvailability,
        desiredAvailability,
        willChange,
        isProtected,
      };
    });

    const total = dates.filter((row) => row.willChange).length;
    if (total === 0) continue;

    previewEvents.push({
      eventId: link.event_id,
      publicToken: eventInfo.public_token,
      title: eventInfo.title,
      isFinalized: eventInfo.is_finalized,
      changes: {
        total,
        availableToUnavailable: dates.filter(
          (row) => row.willChange && row.currentAvailability && !row.desiredAvailability,
        ).length,
        unavailableToAvailable: dates.filter(
          (row) => row.willChange && !row.currentAvailability && row.desiredAvailability,
        ).length,
        protected: dates.filter((row) => row.willChange && row.isProtected).length,
      },
      dates,
    });
  }

  return previewEvents.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
};

const splitToHourlyRanges = (start: string, end: string): Array<{ start: string; end: string }> => {
  const startDate = toComparableDate(start);
  const endDate = toComparableDate(end);
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate >= endDate
  ) {
    return [];
  }

  const result: Array<{ start: string; end: string }> = [];
  let cursor = new Date(
    Date.UTC(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate(),
      startDate.getHours(),
      startDate.getMinutes(),
      startDate.getSeconds(),
      startDate.getMilliseconds(),
    ),
  );
  const endAt = new Date(
    Date.UTC(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate(),
      endDate.getHours(),
      endDate.getMinutes(),
      endDate.getSeconds(),
      endDate.getMilliseconds(),
    ),
  );

  while (cursor < endAt) {
    const next = new Date(cursor.getTime() + 60 * 60 * 1000);
    const chunkEnd = next < endAt ? next : endAt;
    result.push({
      start: new Date(cursor).toISOString(),
      end: new Date(chunkEnd).toISOString(),
    });
    cursor = chunkEnd;
  }

  return result;
};

/**
 * 回答画面に表示するユーザー予定のコンテキストを取得する。
 * @param {string} eventId 対象イベントID
 * @param {EventDateRange[]} eventDates 対象イベントの日程一覧
 * @param {string | null | undefined} resolvedUserId 呼び出し元で解決済みのユーザーID
 * @returns {Promise<ScheduleContext>} 回答画面用の予定コンテキスト
 */
export async function getUserScheduleContext(
  eventId: string,
  eventDates: EventDateRange[],
  resolvedUserId?: string | null,
): Promise<ScheduleContext> {
  const toDateKey = (value: string): string => {
    const date = toComparableDate(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const toTimeSlotKey = (start: string, end: string): string => {
    const startDate = toComparableDate(start);
    const endDate = toComparableDate(end);
    const toHm = (date: Date) =>
      `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return `${toHm(startDate)}-${toHm(endDate)}`;
  };

  const userId = resolvedUserId === undefined ? (await getAuthSession())?.user?.id : resolvedUserId;
  if (!userId) {
    return {
      isAuthenticated: false,
      hasSyncTargetEvents: false,
      lockedDateIds: [],
      autoFillAvailabilities: {},
      dailyAutoFillDateIds: [],
      overrideDateIds: [],
      coveredDateIds: [],
      uncoveredDateKeys: [],
      uncoveredDayCount: 0,
      requireWeeklyStep: false,
      hasAccountSeedData: false,
    };
  }

  if (eventDates.length === 0) {
    return {
      isAuthenticated: true,
      hasSyncTargetEvents: false,
      lockedDateIds: [],
      autoFillAvailabilities: {},
      dailyAutoFillDateIds: [],
      overrideDateIds: [],
      coveredDateIds: [],
      uncoveredDateKeys: [],
      uncoveredDayCount: 0,
      requireWeeklyStep: false,
      hasAccountSeedData: false,
    };
  }

  const supabase = createSupabaseAdmin();

  const startTimes = eventDates.map((d) => d.start_time);
  const endTimes = eventDates.map((d) => d.end_time);
  const minStart = startTimes.reduce((min, value) => (value < min ? value : min), startTimes[0]);
  const maxEnd = endTimes.reduce((max, value) => (value > max ? value : max), endTimes[0]);

  const blocksPromise = supabase
    .from('user_schedule_blocks')
    .select('start_time,end_time,availability,source')
    .eq('user_id', userId)
    .lt('start_time', maxEnd)
    .gt('end_time', minStart);

  const relatedEventsPromise = (async () => {
    const { data: linkEvents } = await supabase
      .from('user_event_links')
      .select('event_id,participant_id')
      .eq('user_id', userId);
    const linkedEventIds = (linkEvents ?? []).map((row) => row.event_id).filter(Boolean);
    const { data: finalizedDates } =
      linkedEventIds.length > 0
        ? await supabase
            .from('finalized_dates')
            .select('event_id,event_date_id,event_dates(start_time,end_time)')
            .in('event_id', linkedEventIds)
        : { data: [] };

    return { linkEvents, finalizedDates };
  })();

  const overridesPromise = supabase
    .from('user_event_availability_overrides')
    .select('event_date_id')
    .eq('user_id', userId)
    .eq('event_id', eventId);

  const [
    { data: blocks, error: blocksError },
    { linkEvents, finalizedDates },
    { data: overrides },
  ] = await Promise.all([blocksPromise, relatedEventsPromise, overridesPromise]);

  if (blocksError) {
    console.error('予定ブロック取得エラー:', blocksError);
  }

  const hasSyncTargetEvents = (linkEvents ?? []).some(
    (row) => row.event_id !== eventId && Boolean(row.participant_id),
  );

  const busyIntervals = (finalizedDates ?? [])
    .map((row) => {
      const eventDate = Array.isArray(row.event_dates) ? row.event_dates[0] : row.event_dates;
      if (!eventDate?.start_time || !eventDate?.end_time) return null;
      return {
        event_id: row.event_id,
        start_time: eventDate.start_time,
        end_time: eventDate.end_time,
      };
    })
    .filter((row): row is { event_id: string; start_time: string; end_time: string } =>
      Boolean(row),
    );

  const overrideDateIds = (overrides ?? []).map((row) => row.event_date_id);

  const lockedDateIds = eventDates
    .filter((date) =>
      busyIntervals.some((busy) => {
        if (busy.event_id === eventId) return false;
        return isRangeOverlapping(
          { start: new Date(date.start_time), end: new Date(date.end_time) },
          { start: new Date(busy.start_time), end: new Date(busy.end_time) },
        );
      }),
    )
    .map((date) => date.id);

  const lockedSet = new Set(lockedDateIds);
  const autoFillAvailabilities: Record<string, boolean> = {};
  const dailyCoveredSet = new Set<string>(lockedDateIds);
  const dailyAutoFillSet = new Set<string>();

  eventDates.forEach((date) => {
    const blockOnlyResult = computeAutoFillAvailability({
      start: date.start_time,
      end: date.end_time,
      blocks: (blocks ?? []) as ScheduleBlock[],
    });
    if (blockOnlyResult !== null) {
      dailyCoveredSet.add(date.id);
    }

    if (lockedSet.has(date.id)) return;
    const result = computeAccountBlockAutoFill({
      start: date.start_time,
      end: date.end_time,
      blocks: (blocks ?? []) as ScheduleBlock[],
    });
    if (result !== null) {
      autoFillAvailabilities[date.id] = result;
      if (blockOnlyResult !== null) {
        dailyAutoFillSet.add(date.id);
      }
    }
  });

  const coveredSet = new Set<string>([...lockedDateIds, ...Object.keys(autoFillAvailabilities)]);
  const coveredDateIds = eventDates
    .filter((date) => coveredSet.has(date.id))
    .map((date) => date.id);

  // Step2必須/省略判定は、週テンプレではなく「各日予定（blocks）で判定可能な枠」ベースで算出する。

  const uncoveredDateKeys = Array.from(
    new Set(
      eventDates
        .filter((date) => !dailyCoveredSet.has(date.id))
        .map((date) => toDateKey(date.start_time)),
    ),
  ).sort();
  const uncoveredDayCount = uncoveredDateKeys.length;
  const uncoveredCellCount = eventDates.filter((date) => !dailyCoveredSet.has(date.id)).length;
  const uniqueTimeSlotCount = new Set(
    eventDates.map((date) => toTimeSlotKey(date.start_time, date.end_time)),
  ).size;
  const weeklyCellCount = 7 * uniqueTimeSlotCount;
  const requireWeeklyStep = uncoveredCellCount > weeklyCellCount;
  const hasAccountSeedData = Boolean(blocks && blocks.length > 0) || lockedDateIds.length > 0;

  return {
    isAuthenticated: true,
    hasSyncTargetEvents,
    lockedDateIds,
    autoFillAvailabilities,
    dailyAutoFillDateIds: Array.from(dailyAutoFillSet),
    overrideDateIds,
    coveredDateIds,
    uncoveredDateKeys,
    uncoveredDayCount,
    requireWeeklyStep,
    hasAccountSeedData,
  };
}

export async function upsertUserEventLink({
  userId,
  eventId,
  participantId,
}: {
  userId: string;
  eventId: string;
  participantId?: string | null;
}): Promise<{ success: boolean; code?: string; message?: string }> {
  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from('user_event_links').upsert(
    {
      user_id: userId,
      event_id: eventId,
      participant_id: participantId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,event_id' },
  );

  if (error) {
    console.error('ユーザーイベント紐付けの更新に失敗しました:', error);
    return { success: false, code: error.code, message: error.message };
  }
  return { success: true };
}

/** 回答の可・不可を予定枠へ変換し、同じ枠の重複を統合する。矛盾する回答は保存しない。 */
export function buildAnswerScheduleBlocks(eventDates: EventDateRange[], selectedDateIds: string[]) {
  const selected = new Set(selectedDateIds);
  const blocks = new Map<string, ScheduleBlock>();
  for (const date of eventDates) {
    for (const range of splitToHourlyRanges(date.start_time, date.end_time)) {
      const start_time = toWallClockUtcIso(range.start);
      const end_time = toWallClockUtcIso(range.end);
      const availability = selected.has(date.id);
      const key = `${start_time}/${end_time}`;
      const previous = blocks.get(key);
      if (previous && previous.availability !== availability) return null;
      blocks.set(key, { start_time, end_time, availability });
    }
  }
  return [...blocks.values()];
}

export async function upsertUserScheduleBlocks({
  userId,
  eventId,
  eventDates,
  selectedDateIds,
}: {
  userId: string;
  eventId: string;
  eventDates: EventDateRange[];
  selectedDateIds: string[];
}): Promise<{ success: boolean; message?: string }> {
  if (eventDates.length === 0) return { success: true };
  const blocks = buildAnswerScheduleBlocks(eventDates, selectedDateIds);
  if (!blocks)
    return {
      success: false,
      message: '重なる候補日時の回答が矛盾しています。保存する候補を選び直してください',
    };
  const payload = blocks.map((block) => ({
    user_id: userId,
    ...block,
    source: 'event',
    event_id: eventId,
    updated_at: new Date().toISOString(),
  }));

  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from('user_schedule_blocks')
    .upsert(payload, { onConflict: 'user_id,start_time,end_time' });

  if (error) {
    console.error('予定ブロックの更新に失敗しました:', error);
    return { success: false, message: '予定ブロックの更新に失敗しました' };
  }

  return { success: true };
}

export async function saveAvailabilityOverrides({
  userId,
  eventId,
  overrideDateIds,
  selectedDateIds,
}: {
  userId: string;
  eventId: string;
  overrideDateIds: string[];
  selectedDateIds: string[];
}): Promise<void> {
  const supabase = createSupabaseAdmin();

  if (overrideDateIds.length === 0) {
    const { error: clearError } = await supabase
      .from('user_event_availability_overrides')
      .delete()
      .eq('user_id', userId)
      .eq('event_id', eventId);
    if (clearError) {
      console.error('上書き情報の削除に失敗しました:', clearError);
    }
    return;
  }

  const selectedSet = new Set(selectedDateIds);
  const payload = overrideDateIds.map((dateId) => ({
    user_id: userId,
    event_id: eventId,
    event_date_id: dateId,
    availability: selectedSet.has(dateId),
    reason: 'conflict_override',
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabase
    .from('user_event_availability_overrides')
    .upsert(payload, { onConflict: 'user_id,event_id,event_date_id' });

  if (upsertError) {
    console.error('上書き情報の保存に失敗しました:', upsertError);
    return;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('user_event_availability_overrides')
    .select('event_date_id')
    .eq('user_id', userId)
    .eq('event_id', eventId);

  if (existingError) {
    console.error('上書き情報の取得に失敗しました:', existingError);
    return;
  }

  const overrideIdSet = new Set(overrideDateIds);
  const staleDateIds = (existingRows ?? [])
    .map((row) => row.event_date_id)
    .filter((dateId) => !overrideIdSet.has(dateId));

  if (staleDateIds.length === 0) return;

  const { error: deleteError } = await supabase
    .from('user_event_availability_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .in('event_date_id', staleDateIds);

  if (deleteError) {
    console.error('不要な上書き情報の削除に失敗しました:', deleteError);
  }
}

export async function syncUserAvailabilities({
  userId,
  scope,
  currentEventId,
}: {
  userId: string;
  scope: 'current' | 'all';
  currentEventId?: string;
}): Promise<void> {
  const supabase = createSupabaseAdmin();

  const { data: allLinks, error: linkError } = await supabase
    .from('user_event_links')
    .select('event_id, participant_id,event:events!inner(scheduling_mode)')
    .eq('user_id', userId);

  if (linkError) {
    console.error('イベント紐付け取得エラー:', linkError);
    return;
  }

  const links = (allLinks ?? []).filter(
    (link): link is typeof link & { participant_id: string } => {
      if (!link.participant_id) return false;
      if (link.event?.scheduling_mode === 'date_first') return false;
      if (scope === 'current') {
        return currentEventId ? link.event_id === currentEventId : false;
      }
      if (currentEventId) {
        return link.event_id !== currentEventId;
      }
      return true;
    },
  );

  if (links.length === 0) return;

  const allEventIds = (allLinks ?? []).map((link) => link.event_id);
  const targetEventIds = Array.from(new Set(links.map((link) => link.event_id)));
  const participantIds = Array.from(new Set(links.map((link) => link.participant_id)));

  const eventDatesRows = await fetchEventDateRanges(supabase, targetEventIds);
  const blocks =
    eventDatesRows.length > 0
      ? await fetchScheduleBlocksInRange({
          supabase,
          userId,
          minStart: eventDatesRows
            .map((row) => row.start_time)
            .reduce((min, value) => (value < min ? value : min), eventDatesRows[0].start_time),
          maxEnd: eventDatesRows
            .map((row) => row.end_time)
            .reduce((max, value) => (value > max ? value : max), eventDatesRows[0].end_time),
        })
      : [];

  const { data: finalizedDates } =
    allEventIds.length > 0
      ? await supabase
          .from('finalized_dates')
          .select('event_id,event_date_id,event_dates(start_time,end_time)')
          .in('event_id', allEventIds)
      : { data: [] };

  const busyIntervals = (finalizedDates ?? [])
    .map((row) => {
      const eventDate = Array.isArray(row.event_dates) ? row.event_dates[0] : row.event_dates;
      if (!eventDate?.start_time || !eventDate?.end_time) return null;
      return {
        event_id: row.event_id,
        start_time: eventDate.start_time,
        end_time: eventDate.end_time,
      };
    })
    .filter((row): row is { event_id: string; start_time: string; end_time: string } =>
      Boolean(row),
    );

  const eventDatesByEventId = new Map<string, EventDateRange[]>();
  eventDatesRows.forEach((row) => {
    if (!row.event_id) return;
    const current = eventDatesByEventId.get(row.event_id) ?? [];
    current.push({
      id: row.id,
      event_id: row.event_id,
      start_time: row.start_time,
      end_time: row.end_time,
    });
    eventDatesByEventId.set(row.event_id, current);
  });

  const overridesRows = await fetchAvailabilityOverrideRows(supabase, userId, targetEventIds);
  const overrideMapByEventId = new Map<string, Map<string, boolean>>();
  overridesRows.forEach((row) => {
    const map = overrideMapByEventId.get(row.event_id) ?? new Map<string, boolean>();
    map.set(row.event_date_id, row.availability);
    overrideMapByEventId.set(row.event_id, map);
  });

  const currentAvailabilitiesRows = await fetchSyncPreviewAvailabilityRows(
    supabase,
    participantIds,
  );
  const currentAvailabilitiesByParticipantId = new Map<string, Set<string>>();
  currentAvailabilitiesRows.forEach((row) => {
    if (!row.availability) return;
    const set = currentAvailabilitiesByParticipantId.get(row.participant_id) ?? new Set<string>();
    set.add(row.event_date_id);
    currentAvailabilitiesByParticipantId.set(row.participant_id, set);
  });

  for (const link of links) {
    const eventDates = eventDatesByEventId.get(link.event_id) ?? [];
    if (eventDates.length === 0) continue;

    const overrideMap = overrideMapByEventId.get(link.event_id) ?? new Map<string, boolean>();
    const selectedSet = new Set(
      currentAvailabilitiesByParticipantId.get(link.participant_id) ?? [],
    );

    eventDates.forEach((date) => {
      const override = overrideMap.get(date.id);
      if (override !== undefined) {
        if (override) {
          selectedSet.add(date.id);
        } else {
          selectedSet.delete(date.id);
        }
        return;
      }

      const hasBusyOverlap = busyIntervals.some((busy) => {
        if (busy.event_id === link.event_id) return false;
        return isRangeOverlapping(
          { start: new Date(date.start_time), end: new Date(date.end_time) },
          { start: new Date(busy.start_time), end: new Date(busy.end_time) },
        );
      });
      if (hasBusyOverlap) {
        selectedSet.delete(date.id);
        return;
      }

      const auto = computeAccountBlockAutoFill({
        start: date.start_time,
        end: date.end_time,
        blocks,
      });

      if (auto === true) {
        selectedSet.add(date.id);
      } else if (auto === false) {
        selectedSet.delete(date.id);
      }
    });

    const payload = Array.from(selectedSet).map((dateId) => ({
      event_date_id: dateId,
      availability: true,
    }));

    const { error: syncError } = await supabase.rpc('update_participant_availability', {
      p_participant_id: link.participant_id,
      p_event_id: link.event_id,
      p_availabilities: payload,
    });

    if (syncError) {
      console.error('回答同期エラー:', syncError);
    }
  }
}

export async function fetchUserAvailabilitySyncPreview(
  userId: string | null,
  options?: SyncPreviewBuildOptions,
): Promise<UserAvailabilitySyncPreviewEvent[]> {
  const result = await fetchUserAvailabilitySyncPreviewResult(userId, options);
  if (!result.success) {
    throw new Error(result.message);
  }
  return result.events;
}

export async function fetchUserAvailabilitySyncPreviewResult(
  userId: string | null,
  options?: SyncPreviewBuildOptions,
): Promise<UserAvailabilitySyncPreviewResult> {
  if (!userId) {
    return {
      success: false,
      reason: 'unauthenticated',
      message: 'ログイン状態を確認できませんでした。ページを再読み込みしてから再度お試しください。',
      events: [],
    };
  }
  return {
    success: true,
    events: await buildUserAvailabilitySyncPreview(userId, options),
  };
}

/** MCPでは本人の紐づきを先にロックし、再計算中の回答変更や紐づけ変更と競合させない。 */
export async function applyUserAvailabilitySyncForEvent(
  userId: string | null,
  input: Parameters<typeof applyAvailabilitySyncForUserInternal>[1],
) {
  if (!input.strict || !userId) return applyAvailabilitySyncForUserInternal(userId, input);
  const db = await authPool.connect();
  try {
    await db.query('BEGIN');
    const owned = await db.query<{ participant_id: string | null }>(
      'SELECT participant_id FROM public.user_event_links WHERE user_id = $1 AND event_id = $2 FOR UPDATE',
      [userId, input.eventId],
    );
    if (!owned.rows[0]?.participant_id) throw new Error('本人の回答の紐づきを確認できません');
    const result = await applyAvailabilitySyncForUserInternal(userId, input, db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

async function applyAvailabilitySyncForUserInternal(
  userId: string | null,
  {
    eventId,
    selectedAvailabilities,
    overwriteProtected,
    allowFinalized,
    strict = false,
  }: {
    eventId: string;
    selectedAvailabilities?: Record<string, boolean>;
    overwriteProtected: boolean;
    allowFinalized: boolean;
    strict?: boolean;
  },
  transactionDb?: PoolClient,
): Promise<{ success: boolean; message: string; updatedCount: number }> {
  if (!userId) {
    return { success: false, message: 'ログインが必要です', updatedCount: 0 };
  }

  const previewEvents = await buildUserAvailabilitySyncPreview(userId, {
    targetEventIds: [eventId],
    strict,
  });
  const target = previewEvents.find((row) => row.eventId === eventId);
  if (!target) {
    return { success: true, message: 'このイベントに反映すべき変更はありません', updatedCount: 0 };
  }
  if (target.isFinalized && !allowFinalized) {
    return {
      success: false,
      message: '確定済みイベントです。更新する場合は許可を有効にしてください',
      updatedCount: 0,
    };
  }

  const selectedDates = target.dates
    .filter((row) => {
      const requested =
        selectedAvailabilities && row.eventDateId in selectedAvailabilities
          ? selectedAvailabilities[row.eventDateId]
          : row.desiredAvailability;

      if (row.isProtected && !overwriteProtected) {
        return row.currentAvailability;
      }
      return requested;
    })
    .map((row) => row.eventDateId);

  const supabase = createSupabaseAdmin();
  const { data: link, error: linkError } = await supabase
    .from('user_event_links')
    .select('participant_id')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (linkError || !link?.participant_id) {
    return { success: false, message: '参加者情報の取得に失敗しました', updatedCount: 0 };
  }

  const previewDateIds = new Set(target.dates.map((row) => row.eventDateId));
  const existingAvailabilities = await fetchSyncPreviewAvailabilityRows(
    supabase,
    [link.participant_id],
    strict,
  );

  const preservedSelectedDates = (existingAvailabilities ?? [])
    .filter((row) => row.availability && !previewDateIds.has(row.event_date_id))
    .map((row) => row.event_date_id);

  const payloadDateIds = Array.from(new Set([...preservedSelectedDates, ...selectedDates]));
  const payload = payloadDateIds.map((eventDateId) => ({
    event_date_id: eventDateId,
    availability: true,
  }));

  let syncError: unknown = null;
  if (strict) {
    if (!transactionDb) throw new Error('同期用のトランザクションがありません');
    await transactionDb.query(
      'SELECT public.update_participant_availability($1::uuid,$2::uuid,$3::jsonb)',
      [link.participant_id, eventId, JSON.stringify(payload)],
    );
  } else {
    const result = await supabase.rpc('update_participant_availability', {
      p_participant_id: link.participant_id,
      p_event_id: eventId,
      p_availabilities: payload,
    });
    syncError = result.error;
  }

  if (syncError) {
    console.error('イベント単位同期エラー:', syncError);
    return { success: false, message: 'イベント更新に失敗しました', updatedCount: 0 };
  }

  const updatedCount = target.dates.filter((row) => {
    const requested =
      selectedAvailabilities && row.eventDateId in selectedAvailabilities
        ? selectedAvailabilities[row.eventDateId]
        : row.desiredAvailability;
    if (row.isProtected && !overwriteProtected) return false;
    return requested !== row.currentAvailability;
  }).length;

  return { success: true, message: 'イベントを更新しました', updatedCount };
}

/**
 * 回答済み内容を自分の予定として保存し、他イベントの反映候補数を返す
 *
 * @param {string} eventId - 回答元イベントID
 * @param {string} participantId - 保存対象の参加者ID
 * @returns {Promise<{ success: boolean; message: string; previewCount: number }>} 保存結果と反映候補数
 */
export async function saveParticipantAnswerAsUserSchedule({
  eventId,
  participantId,
}: {
  eventId: string;
  participantId: string;
}): Promise<{ success: boolean; message: string; previewCount: number }> {
  const session = await getAuthSession();
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false, message: 'ログインが必要です', previewCount: 0 };
  }
  if (!eventId || !participantId) {
    return { success: false, message: '回答情報が不足しています', previewCount: 0 };
  }

  const supabase = createSupabaseAdmin();
  const { data: existingLink, error: existingLinkError } = await supabase
    .from('user_event_links')
    .select('participant_id')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existingLinkError) {
    console.error('予定保存前の紐づけ確認エラー:', existingLinkError);
    return { success: false, message: '回答情報の確認に失敗しました', previewCount: 0 };
  }
  if (existingLink?.participant_id && existingLink.participant_id !== participantId) {
    return {
      success: false,
      message: 'この回答は現在のアカウントに紐づいていないため保存できません',
      previewCount: 0,
    };
  }

  const { data: participant, error: participantError } = await supabase
    .from('participants')
    .select('id,event_id')
    .eq('id', participantId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (participantError || !participant) {
    console.error('予定保存対象の参加者取得エラー:', participantError);
    return { success: false, message: '回答情報の取得に失敗しました', previewCount: 0 };
  }

  const eventDates = await fetchEventDateRanges(supabase, [eventId]);

  if (eventDates.length === 0) {
    return { success: false, message: 'イベント日程の取得に失敗しました', previewCount: 0 };
  }

  const availabilities = await fetchSyncPreviewAvailabilityRows(supabase, [participantId]);

  const selectedDateIds = (availabilities ?? [])
    .filter((row) => row.availability)
    .map((row) => row.event_date_id);

  const linkResult = await upsertUserEventLink({ userId, eventId, participantId });
  if (!linkResult.success) {
    return { success: false, message: 'イベント紐づけの保存に失敗しました', previewCount: 0 };
  }

  const scheduleResult = await upsertUserScheduleBlocks({
    userId,
    eventId,
    eventDates,
    selectedDateIds,
  });
  if (!scheduleResult.success) {
    return {
      success: false,
      message: scheduleResult.message ?? '自分の予定への保存に失敗しました',
      previewCount: 0,
    };
  }

  const preview = await buildUserAvailabilitySyncPreview(userId, {
    excludeEventId: eventId,
  });

  return {
    success: true,
    message: '自分の予定として保存しました',
    previewCount: preview.length,
  };
}

/**
 * ログインユーザーの予定期間境界を取得する
 * @returns {Promise<UserScheduleBounds>} 最古の開始日時と最新の終了日時
 */
export async function fetchUserScheduleBounds(): Promise<UserScheduleBounds> {
  const session = await getAuthSession();
  const userId = session?.user?.id;
  if (!userId) return { minStartTime: null, maxEndTime: null };

  const supabase = createSupabaseAdmin();
  const [firstResult, lastResult] = await Promise.all([
    supabase
      .from('user_schedule_blocks')
      .select('start_time')
      .eq('user_id', userId)
      .order('start_time', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('user_schedule_blocks')
      .select('end_time')
      .eq('user_id', userId)
      .order('end_time', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (firstResult.error || lastResult.error) {
    console.error('予定期間取得エラー:', firstResult.error ?? lastResult.error);
    return { minStartTime: null, maxEndTime: null };
  }

  return {
    minStartTime: firstResult.data?.start_time ?? null,
    maxEndTime: lastResult.data?.end_time ?? null,
  };
}

/**
 * ログインユーザーの指定週に重なる予定を取得する
 * @param {string} weekStartDate 月曜日のYYYY-MM-DD
 * @returns {Promise<UserScheduleBlockRow[]>} 指定週の予定
 */
export async function fetchUserScheduleBlocks(
  userId: string | null,
  weekStartDate: string,
  strict = false,
): Promise<UserScheduleBlockRow[]> {
  if (!userId) {
    return [];
  }
  const weekRange = resolveWeekRange(weekStartDate);
  if (!weekRange) {
    console.error('予定ブロック取得エラー: 週開始日の形式が不正です');
    return [];
  }

  const supabase = createSupabaseAdmin();
  const rows: UserScheduleBlockRow[] = [];

  for (let page = 0; ; page += 1) {
    const from = page * SUPABASE_PAGE_SIZE;
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('user_schedule_blocks')
      .select('id,start_time,end_time,availability,source,event_id,updated_at')
      .eq('user_id', userId)
      .lt('start_time', weekRange.rangeEnd)
      .gt('end_time', weekRange.rangeStart)
      .order('start_time', { ascending: true })
      .order('end_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      if (strict) throw new Error('予定を取得できませんでした');
      console.error('予定ブロック取得エラー:', error);
      return [];
    }

    rows.push(...((data ?? []) as UserScheduleBlockRow[]));
    if (!data || data.length < SUPABASE_PAGE_SIZE) return rows;
  }
}

export async function upsertUserScheduleBlock({
  startTime,
  endTime,
  availability,
  replaceBlockId,
}: {
  startTime: string;
  endTime: string;
  availability: boolean;
  replaceBlockId?: string;
}): Promise<{ success: boolean; message?: string }> {
  const session = await getAuthSession();
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false, message: 'ログインが必要です' };
  }

  const normalizedRange = normalizeManualBlockRange({ startTime, endTime });
  const startDate = toComparableDate(normalizedRange.startTime);
  const endDate = toComparableDate(normalizedRange.endTime);
  if (
    !normalizedRange.startTime ||
    !normalizedRange.endTime ||
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate >= endDate
  ) {
    return { success: false, message: '時間帯の指定が正しくありません' };
  }

  const supabase = createSupabaseAdmin();
  if (replaceBlockId) {
    const { error: deleteError } = await supabase
      .from('user_schedule_blocks')
      .delete()
      .eq('id', replaceBlockId)
      .eq('user_id', userId);
    if (deleteError) {
      console.error('予定ブロック置換削除エラー:', deleteError);
      return { success: false, message: '予定ブロックの更新に失敗しました' };
    }
  }

  const ranges = splitToHourlyRanges(normalizedRange.startTime, normalizedRange.endTime);
  if (ranges.length === 0) {
    return { success: false, message: '時間帯の指定が正しくありません' };
  }

  const payload = ranges.map((range) => ({
    user_id: userId,
    start_time: toWallClockUtcIso(range.start),
    end_time: toWallClockUtcIso(range.end),
    availability,
    source: 'manual',
    event_id: null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('user_schedule_blocks')
    .upsert(payload, { onConflict: 'user_id,start_time,end_time' });

  if (error) {
    console.error('予定ブロック更新エラー:', error);
    return { success: false, message: '予定ブロックの更新に失敗しました' };
  }

  return { success: true };
}

/**
 * 日付ブロックの変更を一括保存する
 * クライアントからは1回のServer Action呼び出しで反映し、待ち時間を短縮する。
 */
export async function saveUserScheduleBlockChanges(
  userId: string | null,
  {
    upserts,
    deleteIds,
  }: {
    upserts: Array<{
      startTime: string;
      endTime: string;
      availability: boolean;
      replaceBlockId?: string;
    }>;
    deleteIds: string[];
  },
): Promise<{ success: boolean; message?: string; updatedCount: number }> {
  if (!userId) {
    return { success: false, message: 'ログインが必要です', updatedCount: 0 };
  }

  const supabase = createSupabaseAdmin();
  const deleteTargetIds = new Set(deleteIds);
  const payload: Array<{
    user_id: string;
    start_time: string;
    end_time: string;
    availability: boolean;
    source: string;
    event_id: string | null;
    updated_at: string;
  }> = [];

  for (const row of upserts) {
    if (row.replaceBlockId) {
      deleteTargetIds.add(row.replaceBlockId);
    }

    const normalizedRange = normalizeManualBlockRange({
      startTime: row.startTime,
      endTime: row.endTime,
    });
    const startDate = toComparableDate(normalizedRange.startTime);
    const endDate = toComparableDate(normalizedRange.endTime);
    if (
      !normalizedRange.startTime ||
      !normalizedRange.endTime ||
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      startDate >= endDate
    ) {
      return {
        success: false,
        message: '時間帯の指定が正しくありません',
        updatedCount: 0,
      };
    }

    const ranges = splitToHourlyRanges(normalizedRange.startTime, normalizedRange.endTime);
    if (ranges.length === 0) {
      return {
        success: false,
        message: '時間帯の指定が正しくありません',
        updatedCount: 0,
      };
    }

    payload.push(
      ...ranges.map((range) => ({
        user_id: userId,
        start_time: toWallClockUtcIso(range.start),
        end_time: toWallClockUtcIso(range.end),
        availability: row.availability,
        source: 'manual',
        event_id: null,
        updated_at: new Date().toISOString(),
      })),
    );
  }

  const deleteIdList = Array.from(deleteTargetIds);
  if (deleteIdList.length > 0) {
    const { error: deleteError } = await supabase
      .from('user_schedule_blocks')
      .delete()
      .eq('user_id', userId)
      .in('id', deleteIdList);
    if (deleteError) {
      console.error('予定ブロック一括削除エラー:', deleteError);
      return {
        success: false,
        message: '予定ブロックの更新に失敗しました',
        updatedCount: 0,
      };
    }
  }

  if (payload.length > 0) {
    const { error: upsertError } = await supabase
      .from('user_schedule_blocks')
      .upsert(payload, { onConflict: 'user_id,start_time,end_time' });
    if (upsertError) {
      console.error('予定ブロック一括更新エラー:', upsertError);
      return {
        success: false,
        message: '予定ブロックの更新に失敗しました',
        updatedCount: 0,
      };
    }
  }

  return { success: true, updatedCount: payload.length };
}

export async function removeUserScheduleBlock(blockId: string): Promise<{ success: boolean }> {
  const session = await getAuthSession();
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false };
  }

  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from('user_schedule_blocks')
    .delete()
    .eq('id', blockId)
    .eq('user_id', userId);

  if (error) {
    console.error('予定ブロック削除エラー:', error);
    return { success: false };
  }

  return { success: true };
}
