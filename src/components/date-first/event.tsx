'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, X } from 'lucide-react';
import { useDeviceDetect } from '@/hooks/useDeviceDetect';
import { getDateFirstDayDetails, getDateFirstAnswer } from '@/lib/date-first-actions';
import {
  type DateFirstEvent,
  type DateFirstAnswer,
  type DayDetails,
  formatDayMinute,
} from '@/lib/date-first-schema';
import { candidateDayLabel, dayIntervalText } from '@/lib/date-first-ui';
import { addEventToHistory, getEventHistory } from '@/lib/utils';
import { recordEventHistory } from '@/lib/event-history-actions';
import { useSession } from 'next-auth/react';
import { dateFirstCalendarEntries } from '@/lib/date-first-calendar';
import { DateFirstConfiguration } from './manage';
import DateFirstDayHeatmap from './day-heatmap';
import ExistingAnswerMenu from '@/components/event-client/existing-answer-menu';
import EventHistory from '@/components/event-history';
import EventAnswerLinkEditor from '@/components/event-client/event-answer-link-editor';
import ShareAvailableDatesButton from '@/components/share-available-dates-button';

function DayResults({
  token,
  dayId,
  excluded,
}: {
  token: string;
  dayId: string;
  excluded: Set<string>;
}) {
  const [details, setDetails] = useState<DayDetails | null>(null),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  const [comments, setComments] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    getDateFirstDayDetails(token, dayId)
      .then((value) => {
        if (active) setDetails(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [token, dayId, retry]);
  if (error)
    return (
      <div className="py-3">
        <p role="alert">回答の詳細を取得できませんでした。</p>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setError(false);
            setRetry(retry + 1);
          }}
        >
          再試行
        </button>
      </div>
    );
  if (!details)
    return (
      <p role="status" className="py-3 text-sm">
        回答を読み込み中…
      </p>
    );
  if (details.length === 0) return <p className="py-3 text-sm">まだ回答はありません。</p>;
  return (
    <ul className="space-y-3 py-3">
      {details
        .filter((row) => !excluded.has(row.id))
        .map((row) => (
          <li key={row.id}>
            <div className="flex items-start gap-3">
              <span className="w-12 shrink-0 text-center">
                {row.status === 'yes'
                  ? '○'
                  : row.status === 'maybe'
                    ? '△'
                    : row.status === 'no'
                      ? '×'
                      : '未回答'}
              </span>
              <div className="min-w-0 flex-1">
                <span className="break-words font-medium">{row.name}</span>
                {row.status === 'maybe' && row.intervals.length > 0 && (
                  <p className="mt-1 break-words text-sm tabular-nums">
                    {dayIntervalText(row.intervals)}
                  </p>
                )}
              </div>
              {row.comment && (
                <button
                  type="button"
                  className="btn btn-ghost btn-square shrink-0"
                  aria-label={`${row.name}さんのコメント`}
                  aria-expanded={comments.has(row.id)}
                  onClick={() =>
                    setComments((old) => {
                      const next = new Set(old);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                >
                  <span className="relative inline-flex" aria-hidden="true">
                    <MessageSquare size={20} />
                    <span className="bg-primary absolute -right-0.5 -top-0.5 size-1.5 rounded-full" />
                  </span>
                </button>
              )}
            </div>
            {comments.has(row.id) && (
              <p className="ml-15 mt-2 whitespace-pre-wrap break-words text-sm">{row.comment}</p>
            )}
          </li>
        ))}
    </ul>
  );
}

/** 段階に応じた回答の入口と、日付・時間の集計を同じ画面にまとめる。 */
export default function DateFirstEventView({
  data,
  myParticipantId = null,
  initialParticipantId,
  openDateAddition = false,
}: {
  data: DateFirstEvent;
  myParticipantId?: string | null;
  signedIn?: boolean;
  initialParticipantId?: string;
  openDateAddition?: boolean;
}) {
  const [timeDays, setTimeDays] = useState<Set<string>>(new Set());
  const [linkedId, setLinkedId] = useState(myParticipantId);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [comparisonAnswers, setComparisonAnswers] = useState<DateFirstAnswer[] | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState(false);
  const loadComparison = async () => {
    if (comparisonAnswers || comparisonLoading) return;
    setComparisonLoading(true);
    setComparisonError(false);
    try {
      const answers: DateFirstAnswer[] = [];
      for (let i = 0; i < data.participants.length; i += 10) {
        const batch = await Promise.all(
          data.participants.slice(i, i + 10).map((p) => getDateFirstAnswer(data.event.token, p.id)),
        );
        if (batch.some((answer) => answer === null)) throw new Error('回答が変更されています');
        answers.push(...batch.filter((answer): answer is DateFirstAnswer => answer !== null));
      }
      setComparisonAnswers(answers);
    } catch {
      setComparisonError(true);
    } finally {
      setComparisonLoading(false);
    }
  };
  const visibleParticipants = data.participants.filter((p) => !excluded.has(p.id));
  const visibleAnswers = comparisonAnswers?.filter((answer) => !excluded.has(answer.id));
  const displayDays = data.days.map((day) => {
    if (!visibleAnswers) return day;
    const rows = visibleAnswers.map((answer) => answer.days.find((row) => row.id === day.id));
    return {
      ...day,
      yes: rows.filter((row) => row?.status === 'yes').length,
      maybe: rows.filter((row) => row?.status === 'maybe').length,
      no: rows.filter((row) => row?.status === 'no').length,
      unanswered: rows.filter((row) => !row?.status).length,
      hasComment: rows.some((row) => row?.comment?.trim()),
    };
  });
  const displaySlots = data.slots.map((slot) => {
    if (!visibleAnswers) return slot;
    const rows = visibleAnswers.map((answer) => answer.times.find((row) => row.id === slot.id));
    return {
      ...slot,
      yes: rows.filter((row) => row?.availability === true).length,
      no: rows.filter((row) => row?.availability === false).length,
      unanswered: rows.filter((row) => row?.availability == null).length,
    };
  });
  const currentKind = data.event.stage === 'times' && data.slots.length > 0 ? 'times' : 'days';
  const continuationId = linkedId ?? initialParticipantId;
  const [configurationOpen, setConfigurationOpen] = useState(openDateAddition);
  const [inspection, setInspection] = useState<{
    id: string;
    left: number;
    top: number;
    width: number;
    pinned: boolean;
  } | null>(null);
  const detailPanel = useRef<HTMLDivElement>(null);
  const detailAnchor = useRef<HTMLButtonElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isMobile } = useDeviceDetect();
  const inspectedDay = displayDays.find((day) => day.id === inspection?.id);
  const keepDetails = () => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const closeDetails = () => {
    keepDetails();
    if (inspection?.pinned) detailAnchor.current?.focus();
    setInspection(null);
  };
  const leaveDetails = () => {
    if (inspection?.pinned) return;
    keepDetails();
    hideTimer.current = setTimeout(() => setInspection(null), 120);
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !detailPanel.current?.contains(target) &&
        !target.closest('[data-day-inspect]')
      )
        setInspection(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspection(null);
    };
    const dismiss = () => setInspection(null);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', dismiss);
      window.removeEventListener('resize', dismiss);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    };
  }, []);
  const { title, token } = data.event;
  useEffect(() => {
    if (inspection?.pinned)
      detailPanel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [inspection?.id, inspection?.pinned]);
  const { status } = useSession();
  useEffect(() => {
    const previous = getEventHistory().find((item) => item.id === token);
    const item = {
      id: token,
      title,
      createdAt: new Date().toISOString(),
      isCreatedByMe: previous?.isCreatedByMe ?? false,
      answeredByMe: previous?.answeredByMe,
      myParticipantName: previous?.myParticipantName,
    };
    addEventToHistory(item);
    if (status === 'authenticated') void recordEventHistory(item);
  }, [title, token, status]);
  return (
    <div className="app-page space-y-8" data-testid="date-first-event">
      {data.days.some((d) => d.confirmed) && (
        <section aria-label="確定内容" className="space-y-2">
          <h2 className="section-heading">確定した日程</h2>
          {data.days
            .filter((d) => d.confirmed)
            .map((day) => {
              const slots = data.slots.filter((s) => s.dayId === day.id && s.finalized);
              return (
                <p key={day.id}>
                  {candidateDayLabel(day.date)}：
                  {slots.length ? dayIntervalText(slots.map((s) => [s.start, s.end])) : '時間未定'}
                </p>
              );
            })}
          <div className="flex flex-wrap gap-3">
            <a
              className="btn btn-ghost btn-sm"
              href={`/api/calendar/ics/${data.event.id}?token=${token}`}
            >
              ICSをダウンロード
            </a>
          </div>
          <details>
            <summary className="cursor-pointer py-2 text-sm">Googleカレンダーに追加</summary>
            <ul className="mt-2 space-y-2">
              {dateFirstCalendarEntries(data).map((entry) => {
                const slot = data.slots.find((slot) => slot.id === entry.id);
                const label = entry.allDay
                  ? `${candidateDayLabel(entry.start)} 時間未定`
                  : slot
                    ? `${candidateDayLabel(data.days.find((day) => day.id === slot.dayId)!.date)} ${formatDayMinute(slot.start)}〜${formatDayMinute(slot.end)}`
                    : '';
                return (
                  <li key={entry.id}>
                    <a
                      className="link text-sm"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={`/api/calendar/${data.event.id}?token=${token}&googleCalendar=true&dateId=${entry.id}`}
                    >
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </details>
          <p className="text-base-content/65 text-sm">
            取り込み済みの予定は、ここで変更・解除しても自動更新されません。
          </p>
        </section>
      )}
      <section
        className="surface space-y-4 overflow-visible p-5 sm:p-6"
        aria-labelledby="date-first-answer-actions"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-heading" id="date-first-answer-actions">
            参加予定を入力する
          </h2>
          <EventAnswerLinkEditor
            eventId={data.event.id}
            eventPublicToken={token}
            participants={data.participants}
            linkedParticipantId={linkedId}
            onLinkedParticipantIdChange={setLinkedId}
          />
        </div>
        <p className="text-sm">
          {currentKind === 'times'
            ? '候補の時間に回答してください。日付の回答がある方は、同じ名前の回答を編集してください。'
            : '参加できる日付を回答してください。'}
        </p>
        <div className="flex flex-wrap gap-3" data-testid="date-first-day-actions">
          {currentKind === 'times' && continuationId ? (
            <a
              className="btn btn-primary"
              href={`/event/${token}/input?participant_id=${continuationId}&kind=times`}
            >
              時間を回答する
            </a>
          ) : currentKind === 'days' || data.participants.length === 0 ? (
            <a className="btn btn-primary" href={`/event/${token}/input?kind=${currentKind}`}>
              新しく回答する
            </a>
          ) : null}
          {data.participants.length > 0 && (
            <ExistingAnswerMenu
              eventPublicToken={token}
              linkedParticipantId={linkedId}
              participants={data.participants}
              answerKind={currentKind === 'times' ? 'times' : undefined}
            />
          )}
          {currentKind === 'times' && data.participants.length > 0 && (
            <a className="btn btn-ghost" href={`/event/${token}/input?kind=times`}>
              初めて回答する
            </a>
          )}
        </div>
        {currentKind === 'times' && (
          <details>
            <summary className="cursor-pointer py-2 text-sm">日付の回答を編集する</summary>
            <div className="mt-2">
              <ExistingAnswerMenu
                eventPublicToken={token}
                linkedParticipantId={linkedId}
                participants={data.participants}
              />
            </div>
          </details>
        )}
      </section>
      <section className="space-y-4" aria-labelledby="date-first-results-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-heading" id="date-first-results-heading">
            回答状況
          </h2>
          <p className="text-base-content/65 text-sm">
            {excluded.size
              ? `表示${visibleParticipants.length}人 / 参加者${data.participants.length}人`
              : `参加者${data.participants.length}人`}
          </p>
        </div>
        <div className="max-w-3xl">
          <DateFirstDayHeatmap
            days={displayDays}
            participantCount={visibleParticipants.length}
            activeDayId={inspection?.id ?? null}
            onInspect={(id, anchor, pinned) => {
              if (!pinned && (isMobile || inspection?.pinned)) return;
              keepDetails();
              if (pinned && inspection?.pinned && inspection.id === id) {
                closeDetails();
                return;
              }
              const rect = anchor.getBoundingClientRect();
              const width = Math.min(384, window.innerWidth - 16);
              detailAnchor.current = anchor;
              setInspection({
                id,
                pinned,
                width,
                left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8)),
                top: Math.max(64, Math.min(rect.top, window.innerHeight * 0.4)),
              });
            }}
            onLeave={leaveDetails}
          />
        </div>
        {inspection &&
          inspectedDay &&
          createPortal(
            <div
              ref={detailPanel}
              id="date-first-day-detail"
              role="dialog"
              aria-modal="false"
              aria-label={`${candidateDayLabel(inspectedDay.date)}の回答詳細`}
              className="bg-base-100 border-base-300 fixed z-50 max-h-[55dvh] overflow-y-auto rounded-md border p-3"
              style={
                isMobile
                  ? { top: 'calc(env(safe-area-inset-top, 0px) + 64px)', left: 8, right: 8 }
                  : { top: inspection.top, left: inspection.left, width: inspection.width }
              }
              onPointerEnter={keepDetails}
              onPointerLeave={leaveDetails}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  closeDetails();
                }
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">{candidateDayLabel(inspectedDay.date)}</h3>
                <button
                  type="button"
                  className="btn btn-ghost btn-square"
                  aria-label="回答詳細を閉じる"
                  onClick={closeDetails}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                <span>○{inspectedDay.yes}</span>
                <span>△{inspectedDay.maybe}</span>
                <span>×{inspectedDay.no}</span>
                <span>未回答{inspectedDay.unanswered}</span>
              </p>
              <DayResults
                key={inspectedDay.id}
                token={token}
                dayId={inspectedDay.id}
                excluded={excluded}
              />
            </div>,
            document.body,
          )}
        {data.slots.length > 0 && (
          <div className="max-w-3xl space-y-3">
            <h3 className="font-medium">時間ごとの回答</h3>
            {data.days
              .filter((d) => d.target)
              .map((day) => (
                <div key={day.id}>
                  <button
                    type="button"
                    className="btn btn-ghost justify-start px-0"
                    aria-expanded={timeDays.has(day.id)}
                    onClick={() =>
                      setTimeDays((old) => {
                        const next = new Set(old);
                        if (next.has(day.id)) next.delete(day.id);
                        else next.add(day.id);
                        return next;
                      })
                    }
                  >
                    {candidateDayLabel(day.date)}
                  </button>
                  {timeDays.has(day.id) && (
                    <ul className="space-y-3 py-2">
                      {displaySlots
                        .filter((s) => s.dayId === day.id)
                        .map((slot) => (
                          <li
                            key={slot.id}
                            className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm tabular-nums"
                          >
                            <span className="min-w-40">
                              {formatDayMinute(slot.start)}〜{formatDayMinute(slot.end)}
                            </span>
                            <span>
                              ○{slot.yes}・×{slot.no}・未回答{slot.unanswered}
                              {slot.finalized ? '（確定済み）' : ''}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ))}
          </div>
        )}
        {data.participants.length > 0 && (
          <details
            onToggle={(event) => {
              if (event.currentTarget.open) void loadComparison();
            }}
          >
            <summary className="cursor-pointer py-2 text-sm font-medium">
              参加者の表示・共通日程の共有
            </summary>
            <div className="mt-3 space-y-4">
              {comparisonLoading && (
                <p role="status" className="text-sm">
                  回答を読み込み中…
                </p>
              )}
              {comparisonError && (
                <div>
                  <p role="alert" className="text-error text-sm">
                    回答を取得できませんでした。
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void loadComparison()}
                  >
                    再試行
                  </button>
                </div>
              )}
              {comparisonAnswers && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">表示選択:</span>
                    {data.participants.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`btn btn-outline btn-sm min-h-9 ${excluded.has(p.id) ? 'text-base-content/45 line-through' : ''}`}
                        aria-pressed={!excluded.has(p.id)}
                        onClick={() =>
                          setExcluded((old) => {
                            const next = new Set(old);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            return next;
                          })
                        }
                      >
                        {p.name}
                        {linkedId === p.id ? '（自分）' : ''}
                      </button>
                    ))}
                  </div>
                  {visibleParticipants.length > 0 && (
                    <ShareAvailableDatesButton
                      key={visibleParticipants.map((p) => p.id).join(',') + currentKind}
                      eventTitle={data.event.title}
                      publicToken={token}
                      participants={visibleParticipants}
                      eventDates={
                        currentKind === 'days'
                          ? displayDays.map((day) => ({
                              id: day.id,
                              start_time: `${day.date}T00:00:00`,
                              end_time: `${day.date}T24:00:00`,
                            }))
                          : displaySlots.map((slot) => {
                              const day = data.days.find((day) => day.id === slot.dayId)!;
                              const start = new Date(`${day.date}T00:00:00Z`);
                              start.setUTCMinutes(slot.start);
                              const end = new Date(`${day.date}T00:00:00Z`);
                              end.setUTCMinutes(slot.end);
                              return {
                                id: slot.id,
                                start_time: start.toISOString().slice(0, 19),
                                end_time: end.toISOString().slice(0, 19),
                              };
                            })
                      }
                      availabilities={visibleAnswers!.flatMap((answer) =>
                        currentKind === 'days'
                          ? answer.days
                              .filter((row) => row.status === 'yes')
                              .map((row) => ({
                                participant_id: answer.id,
                                event_date_id: row.id,
                                availability: true,
                              }))
                          : answer.times
                              .filter((row) => row.availability === true)
                              .map((row) => ({
                                participant_id: answer.id,
                                event_date_id: row.id,
                                availability: true,
                              })),
                      )}
                    />
                  )}
                  <p className="text-base-content/65 text-xs">
                    日付の共有には○の回答だけを含めます。
                  </p>
                </>
              )}
            </div>
          </details>
        )}
      </section>
      <section
        className="surface space-y-5 p-5 sm:p-6"
        aria-labelledby="date-first-management-heading"
      >
        <div>
          <h2 className="section-heading" id="date-first-management-heading">
            イベント日程の管理
          </h2>
          <p className="section-description">日付・日時の確定や、候補の追加・変更ができます。</p>
        </div>
        <div
          className={
            configurationOpen ? 'grid items-start gap-6' : 'grid items-start gap-6 md:grid-cols-2'
          }
        >
          <div className="space-y-3" hidden={configurationOpen}>
            <h3 className="font-medium">日程の確定</h3>
            <a className="btn btn-primary" href={`/event/${token}/finalize`}>
              {data.days.some((day) => day.confirmed) ? '確定内容を変更する' : '日程を確定する'}
            </a>
          </div>
          <details
            id="candidate-date-addition"
            className="scroll-mt-24"
            open={configurationOpen}
            onToggle={(event) => setConfigurationOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer py-2 font-medium">候補日程の追加・変更</summary>
            <DateFirstConfiguration data={data} />
          </details>
        </div>
      </section>
      <EventHistory maxDisplay={3} />
    </div>
  );
}
