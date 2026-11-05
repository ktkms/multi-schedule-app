'use client';

import Link from 'next/link';
import type { DateFirstEvent } from '@/lib/date-first-schema';
import DateFirstAccount from '@/components/date-first/account';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WeekNavigationBar from '@/components/week-navigation-bar';
import {
  applyUserAvailabilitySyncForEvent,
  fetchUserAvailabilitySyncPreviewResult,
  type UserAvailabilitySyncPreviewEvent,
} from '@/lib/schedule-actions';
import {
  buildSyncPreviewState,
  createEmptySyncPreviewState,
  type SyncPreviewState,
} from '@/components/sync/sync-preview-state';
import { addDays, endOfWeek, startOfWeek } from 'date-fns';

type SyncReviewPageProps = {
  publicToken: string;
  currentEventId: string;
  dateFirstTargets?: { data: DateFirstEvent; participantId: string }[];
  syncWarning?: 'partial' | null;
};

const toLocalDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const toLocalTimeKey = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const toDisplayTimeRangeKey = (start: Date, end: Date): string => {
  const startTime = toLocalTimeKey(start);
  const endTime = toLocalTimeKey(end);
  const spansNextDay = toLocalDateKey(start) !== toLocalDateKey(end);
  if (spansNextDay && endTime === '00:00') {
    return `${startTime}-24:00`;
  }
  return `${startTime}-${endTime}`;
};

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const toWeeklyDateBuckets = (dateKeys: string[]): string[][] => {
  if (dateKeys.length === 0) return [];
  const firstWeekStart = startOfWeek(new Date(`${dateKeys[0]}T00:00:00`), { weekStartsOn: 1 });
  const lastWeekEnd = endOfWeek(new Date(`${dateKeys[dateKeys.length - 1]}T00:00:00`), {
    weekStartsOn: 1,
  });

  const buckets: string[][] = [];
  for (
    let cursor = new Date(firstWeekStart);
    cursor.getTime() <= lastWeekEnd.getTime();
    cursor = addDays(cursor, 7)
  ) {
    const week: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(cursor, i);
      week.push(toLocalDateKey(date));
    }
    buckets.push(week);
  }
  return buckets;
};

const buildSyncPreviewMatrix = (event: UserAvailabilitySyncPreviewEvent) => {
  const dateKeys = new Set<string>();
  const timeKeys = new Set<string>();
  const map: Record<string, (typeof event.dates)[number]> = {};

  event.dates.forEach((row) => {
    const start = new Date(row.startTime);
    const end = new Date(row.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    const dateKey = toLocalDateKey(start);
    const timeKey = toDisplayTimeRangeKey(start, end);
    dateKeys.add(dateKey);
    timeKeys.add(timeKey);
    map[`${dateKey}_${timeKey}`] = row;
  });

  const sortedDates = Array.from(dateKeys).sort();
  const sortedTimes = Array.from(timeKeys).sort(
    (a, b) => toMinutes(a.split('-')[0]) - toMinutes(b.split('-')[0]),
  );

  return { sortedDates, sortedTimes, map };
};

const resolveInitialSyncPreviewWeekPage = (event: UserAvailabilitySyncPreviewEvent): number => {
  const matrix = buildSyncPreviewMatrix(event);
  const dateBuckets = toWeeklyDateBuckets(matrix.sortedDates);
  if (dateBuckets.length === 0) return 0;

  const changedDateKeys = event.dates
    .filter((row) => row.willChange)
    .map((row) => {
      const start = new Date(row.startTime);
      return Number.isNaN(start.getTime()) ? null : toLocalDateKey(start);
    })
    .filter((key): key is string => key !== null)
    .sort();

  const firstChangedDateKey = changedDateKeys[0];
  if (!firstChangedDateKey) return 0;

  const page = dateBuckets.findIndex((week) => week.includes(firstChangedDateKey));
  return page >= 0 ? page : 0;
};

const reconcileEventAfterApply = ({
  event,
  selectedAvailabilities,
  overwriteProtected,
}: {
  event: UserAvailabilitySyncPreviewEvent;
  selectedAvailabilities: Record<string, boolean>;
  overwriteProtected: boolean;
}): UserAvailabilitySyncPreviewEvent => {
  const dates = event.dates.map((row) => {
    const requested =
      row.eventDateId in selectedAvailabilities
        ? selectedAvailabilities[row.eventDateId]
        : row.desiredAvailability;

    const nextCurrentAvailability =
      row.isProtected && !overwriteProtected ? row.currentAvailability : requested;
    const nextWillChange = nextCurrentAvailability !== row.desiredAvailability;

    return {
      ...row,
      currentAvailability: nextCurrentAvailability,
      willChange: nextWillChange,
    };
  });

  const total = dates.filter((row) => row.willChange).length;

  return {
    ...event,
    dates,
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
  };
};

const emptyDateFirstTargets: { data: DateFirstEvent; participantId: string }[] = [];

export default function SyncReviewPage({
  publicToken,
  currentEventId,
  syncWarning = null,
  dateFirstTargets = emptyDateFirstTargets,
}: SyncReviewPageProps) {
  const router = useRouter();
  const [syncPreviewEvents, setSyncPreviewEvents] = useState<UserAvailabilitySyncPreviewEvent[]>(
    [],
  );
  const [syncCellSelectionMap, setSyncCellSelectionMap] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [syncPreviewWeekPageMap, setSyncPreviewWeekPageMap] = useState<Record<string, number>>({});
  const [syncOverwriteMap, setSyncOverwriteMap] = useState<Record<string, boolean>>({});
  const [syncAllowFinalizedMap, setSyncAllowFinalizedMap] = useState<Record<string, boolean>>({});
  const [syncMessageMap, setSyncMessageMap] = useState<Record<string, string>>({});
  const [syncPreviewError, setSyncPreviewError] = useState<string | null>(null);
  const [isSyncPreviewLoading, setIsSyncPreviewLoading] = useState(true);
  const [syncApplyingEventIds, setSyncApplyingEventIds] = useState<Set<string>>(new Set());
  const syncApplyingEventIdsRef = useRef<Set<string>>(new Set());

  const backToEventPath = useMemo(
    () => `/event/${publicToken}${syncWarning === 'partial' ? '?sync_warning=partial' : ''}`,
    [publicToken, syncWarning],
  );

  const loadSyncPreview = useCallback(async () => {
    const applyPreviewState = (previewState: SyncPreviewState) => {
      setSyncPreviewEvents(previewState.events);
      setSyncCellSelectionMap(previewState.cellSelectionMap);
      setSyncPreviewWeekPageMap(previewState.weekPageMap);
      setSyncOverwriteMap(previewState.overwriteMap);
      setSyncAllowFinalizedMap(previewState.allowFinalizedMap);
      setSyncMessageMap(previewState.messageMap);
    };

    setIsSyncPreviewLoading(true);
    setSyncPreviewError(null);
    try {
      const result = await fetchUserAvailabilitySyncPreviewResult({
        excludeEventId: currentEventId,
      });
      const filteredPreview = result.events;

      if (!result.success) {
        applyPreviewState(createEmptySyncPreviewState());
        setSyncPreviewError(result.message);
        return;
      }

      if (filteredPreview.length === 0 && dateFirstTargets.length === 0) {
        router.replace(backToEventPath);
        return;
      }

      applyPreviewState(
        buildSyncPreviewState(filteredPreview, (event) => resolveInitialSyncPreviewWeekPage(event)),
      );
    } catch (error) {
      console.error('反映対象取得エラー:', error);
      applyPreviewState(createEmptySyncPreviewState());
      setSyncPreviewError('反映対象の取得に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setIsSyncPreviewLoading(false);
    }
  }, [backToEventPath, currentEventId, router, dateFirstTargets]);

  useEffect(() => {
    void loadSyncPreview();
  }, [loadSyncPreview]);

  useEffect(() => {
    if (
      !isSyncPreviewLoading &&
      !syncPreviewError &&
      syncPreviewEvents.length === 0 &&
      dateFirstTargets.length === 0 &&
      syncApplyingEventIds.size === 0
    ) {
      router.replace(backToEventPath);
    }
  }, [
    backToEventPath,
    isSyncPreviewLoading,
    router,
    syncApplyingEventIds.size,
    syncPreviewError,
    syncPreviewEvents.length,
    dateFirstTargets.length,
  ]);

  const handleApplyForEvent = useCallback(
    async (eventId: string) => {
      if (syncApplyingEventIdsRef.current.has(eventId)) return;

      syncApplyingEventIdsRef.current.add(eventId);
      setSyncApplyingEventIds((prev) => {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      });
      try {
        const selectedAvailabilities = syncCellSelectionMap[eventId] ?? {};
        const overwriteProtected = syncOverwriteMap[eventId] ?? false;
        const result = await applyUserAvailabilitySyncForEvent({
          eventId,
          selectedAvailabilities,
          overwriteProtected,
          allowFinalized: syncAllowFinalizedMap[eventId] ?? false,
        });

        if (!result.success && result.message === 'ログインが必要です') {
          router.replace(backToEventPath);
          return;
        }

        setSyncMessageMap((prev) => ({
          ...prev,
          [eventId]: result.message,
        }));
        if (result.success) {
          setSyncPreviewEvents((prev) =>
            prev.flatMap((event) => {
              if (event.eventId !== eventId) return [event];
              const reconciled = reconcileEventAfterApply({
                event,
                selectedAvailabilities,
                overwriteProtected,
              });
              return reconciled.changes.total > 0 ? [reconciled] : [];
            }),
          );
          setSyncCellSelectionMap((prev) => {
            const next = { ...prev };
            delete next[eventId];
            return next;
          });
          setSyncPreviewWeekPageMap((prev) => {
            const next = { ...prev };
            delete next[eventId];
            return next;
          });
          setSyncOverwriteMap((prev) => {
            const next = { ...prev };
            delete next[eventId];
            return next;
          });
          setSyncAllowFinalizedMap((prev) => {
            const next = { ...prev };
            delete next[eventId];
            return next;
          });
        }
      } finally {
        syncApplyingEventIdsRef.current.delete(eventId);
        setSyncApplyingEventIds((prev) => {
          const next = new Set(prev);
          next.delete(eventId);
          return next;
        });
      }
    },
    [backToEventPath, router, syncAllowFinalizedMap, syncCellSelectionMap, syncOverwriteMap],
  );

  const handleCancelForEvent = useCallback((eventId: string) => {
    setSyncPreviewEvents((prev) => prev.filter((event) => event.eventId !== eventId));
    setSyncCellSelectionMap((prev) => {
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
    setSyncPreviewWeekPageMap((prev) => {
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
    setSyncOverwriteMap((prev) => {
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
    setSyncAllowFinalizedMap((prev) => {
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
    setSyncMessageMap((prev) => {
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
  }, []);

  if (isSyncPreviewLoading) {
    return (
      <div className="app-page py-8" data-testid="sync-review-page">
        <p className="text-base-content/60 text-sm">反映対象を確認しています...</p>
      </div>
    );
  }

  return (
    <div className="app-page py-8" data-testid="sync-review-page">
      <header className="page-header flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="page-eyebrow">SYNC</p>
          <h1 className="page-title">他のイベントへ反映</h1>
          <p className="page-description">イベントごとに変更内容を確認してから反映できます。</p>
        </div>
        <Link href={backToEventPath} className="btn btn-outline btn-sm">
          イベント結果ページへ戻る
        </Link>
      </header>
      {syncPreviewError && (
        <div className="alert alert-warning mb-4">
          <span>{syncPreviewError}</span>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => void loadSyncPreview()}
          >
            再読み込み
          </button>
        </div>
      )}

      {dateFirstTargets.map(({ data, participantId }) => (
        <section className="surface mb-4 space-y-3 p-5 sm:p-6" key={data.event.id}>
          <h2 className="section-heading">
            <Link className="link" href={`/event/${data.event.token}`}>
              {data.event.title}
            </Link>
          </h2>
          <DateFirstAccount data={data} myParticipantId={participantId} />
        </section>
      ))}
      <div className="space-y-3">
        {syncPreviewEvents.map((event) => {
          const matrix = buildSyncPreviewMatrix(event);
          const dateBuckets = toWeeklyDateBuckets(matrix.sortedDates);
          const currentWeekPage = Math.min(
            syncPreviewWeekPageMap[event.eventId] ?? 0,
            Math.max(dateBuckets.length - 1, 0),
          );
          const visibleDates = dateBuckets[currentWeekPage] ?? [];
          const isUpdating = syncApplyingEventIds.has(event.eventId);
          const selection = syncCellSelectionMap[event.eventId] ?? {};
          const weekPeriodLabel =
            visibleDates.length > 0
              ? `${new Date(`${visibleDates[0]}T00:00:00`).toLocaleDateString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                })} 〜 ${new Date(
                  `${visibleDates[visibleDates.length - 1]}T00:00:00`,
                ).toLocaleDateString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                })}`
              : '-';

          return (
            <div
              key={event.eventId}
              className="surface p-4 sm:p-5"
              data-testid={`sync-review-event-${event.eventId}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <Link
                      href={`/event/${event.publicToken}`}
                      className="link link-hover break-words"
                    >
                      {event.title}
                    </Link>
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <span className="badge badge-info badge-outline">
                      変更 {event.changes.total}件
                    </span>
                    {event.changes.availableToUnavailable > 0 && (
                      <span className="badge badge-error badge-outline">
                        可→不可 {event.changes.availableToUnavailable}
                      </span>
                    )}
                    {event.changes.unavailableToAvailable > 0 && (
                      <span className="badge badge-success badge-outline">
                        不可→可 {event.changes.unavailableToAvailable}
                      </span>
                    )}
                    {event.changes.protected > 0 && (
                      <span className="badge badge-warning badge-outline">
                        保護 {event.changes.protected}件
                      </span>
                    )}
                    {event.isFinalized && <span className="badge badge-warning">確定済み</span>}
                  </div>
                </div>
              </div>

              {dateBuckets.length > 1 && (
                <div className="mb-2">
                  <WeekNavigationBar
                    periodLabel={weekPeriodLabel}
                    currentPage={currentWeekPage}
                    totalPages={dateBuckets.length}
                    onPageChange={(page) =>
                      setSyncPreviewWeekPageMap((prev) => ({
                        ...prev,
                        [event.eventId]: page,
                      }))
                    }
                    hidePageIndicator={true}
                  />
                </div>
              )}

              <div className="overflow-x-auto">
                <table
                  data-testid="sync-schedule-table"
                  className="table-xs min-w-md table w-full table-fixed border-collapse"
                >
                  <thead>
                    <tr className="bg-base-200">
                      <th className="border-base-300 w-20 border px-1 py-1 text-center">時間</th>
                      {visibleDates.map((dateKey) => {
                        const date = new Date(`${dateKey}T00:00:00`);
                        return (
                          <th
                            key={dateKey}
                            className="border-base-300 border px-0.5 py-1 text-center"
                          >
                            <div className="flex flex-col items-center leading-tight">
                              <span className="text-xs font-semibold">
                                {date.toLocaleDateString('ja-JP', {
                                  month: 'numeric',
                                  day: 'numeric',
                                })}
                              </span>
                              <span className="text-base-content/60 text-xs">
                                ({date.toLocaleDateString('ja-JP', { weekday: 'short' })})
                              </span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.sortedTimes.map((timeKey) => (
                      <tr key={`${event.eventId}_${timeKey}`}>
                        <th className="border-base-300 border px-1 py-1 text-xs">{timeKey}</th>
                        {visibleDates.map((dateKey) => {
                          const slot = matrix.map[`${dateKey}_${timeKey}`];
                          if (!slot) {
                            return (
                              <td
                                key={`${dateKey}_${timeKey}`}
                                className="border-base-300 text-base-content/30 border text-center text-xs"
                              >
                                -
                              </td>
                            );
                          }

                          const selected =
                            slot.eventDateId in selection
                              ? selection[slot.eventDateId]
                              : slot.desiredAvailability;
                          const willApplyChange = selected !== slot.currentAvailability;
                          const cellClass = willApplyChange
                            ? selected
                              ? 'bg-success text-success-content ring-success ring-2'
                              : 'bg-warning/80 text-warning-content ring-warning ring-2'
                            : 'bg-base-200/50 text-base-content/40';

                          return (
                            <td
                              key={`${dateKey}_${timeKey}`}
                              className="border-base-300 border p-0.5 md:p-1"
                            >
                              <button
                                type="button"
                                className={`mx-auto block aspect-square w-7 rounded-md text-xs font-semibold md:aspect-auto md:h-10 md:w-full md:text-sm ${cellClass}`}
                                onClick={() =>
                                  slot.willChange &&
                                  setSyncCellSelectionMap((prev) => ({
                                    ...prev,
                                    [event.eventId]: {
                                      ...(prev[event.eventId] ?? {}),
                                      [slot.eventDateId]:
                                        (prev[event.eventId]?.[slot.eventDateId] ??
                                          slot.desiredAvailability) === slot.desiredAvailability
                                          ? slot.currentAvailability
                                          : slot.desiredAvailability,
                                    },
                                  }))
                                }
                                disabled={!slot.willChange}
                                aria-label={`${event.title} ${dateKey} ${timeKey}`}
                              >
                                {selected ? '○' : '×'}
                                {slot.isProtected && <span className="ml-1 text-[10px]">保</span>}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                {event.changes.protected > 0 && (
                  <label className="label cursor-pointer gap-2 py-0">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={syncOverwriteMap[event.eventId] ?? false}
                      onChange={(e) =>
                        setSyncOverwriteMap((prev) => ({
                          ...prev,
                          [event.eventId]: e.target.checked,
                        }))
                      }
                    />
                    <span className="label-text text-xs">保護された枠も上書きする</span>
                  </label>
                )}

                {event.isFinalized && (
                  <label className="label cursor-pointer gap-2 py-0">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={syncAllowFinalizedMap[event.eventId] ?? false}
                      onChange={(e) =>
                        setSyncAllowFinalizedMap((prev) => ({
                          ...prev,
                          [event.eventId]: e.target.checked,
                        }))
                      }
                    />
                    <span className="label-text text-xs">確定済みイベントにも反映する</span>
                  </label>
                )}

                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  disabled={isUpdating}
                  data-testid={`sync-review-cancel-${event.eventId}`}
                  onClick={() => handleCancelForEvent(event.eventId)}
                >
                  この変更をキャンセル
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary ml-auto"
                  disabled={isUpdating}
                  data-testid={`sync-review-apply-${event.eventId}`}
                  onClick={() => void handleApplyForEvent(event.eventId)}
                >
                  {isUpdating ? '適用中...' : 'この変更を適用'}
                </button>
              </div>

              {syncMessageMap[event.eventId] && (
                <p className="text-base-content/70 mt-2 text-xs">{syncMessageMap[event.eventId]}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
