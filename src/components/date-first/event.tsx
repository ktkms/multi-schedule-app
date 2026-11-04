'use client';

import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { getDateFirstDayDetails } from '@/lib/date-first-actions';
import { type DateFirstEvent, type DayDetails, formatDayMinute } from '@/lib/date-first-schema';
import { candidateDayLabel, dayIntervalText } from '@/lib/date-first-ui';
import { addEventToHistory, getEventHistory } from '@/lib/utils';
import { recordEventHistory } from '@/lib/event-history-actions';
import { useSession } from 'next-auth/react';
import { dateFirstCalendarEntries } from '@/lib/date-first-calendar';
import DateFirstAccount from './account';
import { DateFirstConfiguration } from './manage';

function DayResults({ token, dayId }: { token: string; dayId: string }) {
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
      {details.map((row) => (
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
                className="btn btn-ghost btn-square relative"
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
                <MessageSquare size={18} aria-hidden="true" />
                <span className="bg-primary absolute right-2 top-2 h-1.5 w-1.5 rounded-full" />
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

/** 日別集計を主導線とし、複数日・複数コメントの独立した展開を許す。 */
export default function DateFirstEventView({
  data,
  myParticipantId = null,
  signedIn = false,
  initialParticipantId,
}: {
  data: DateFirstEvent;
  myParticipantId?: string | null;
  signedIn?: boolean;
  initialParticipantId?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set()),
    [timeDays, setTimeDays] = useState<Set<string>>(new Set());
  const { title, token } = data.event;
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
    <div className="app-page-narrow space-y-8" data-testid="date-first-event">
      <nav aria-label="回答方法" className="flex flex-wrap gap-3">
        <a className="btn btn-primary" href={`/event/${token}/input`}>
          日付を回答
        </a>
        {data.slots.length > 0 && (
          <a className="btn btn-outline" href={`/event/${token}/input?kind=times`}>
            時間を回答
          </a>
        )}
      </nav>
      {data.days.some((d) => d.confirmed) && (
        <section aria-label="確定内容" className="space-y-2">
          <h2 className="text-lg font-semibold">確定した日程</h2>
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
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">日付ごとの回答</h2>
        <div className="text-base-content/65 grid grid-cols-[minmax(0,1fr)_repeat(4,3rem)] text-center text-xs">
          <span className="text-left">日付</span>
          <span>○</span>
          <span>△</span>
          <span>×</span>
          <span>未回答</span>
        </div>
        {data.days.map((day) => (
          <div key={day.id}>
            <button
              type="button"
              data-testid={`day-results-${day.id}`}
              className="hover:bg-base-200 focus-visible:outline-primary grid min-h-12 w-full grid-cols-[minmax(0,1fr)_repeat(4,3rem)] items-center rounded-sm text-center"
              aria-expanded={open.has(day.id)}
              aria-controls={`day-detail-${day.id}`}
              onClick={() =>
                setOpen((old) => {
                  const next = new Set(old);
                  if (next.has(day.id)) next.delete(day.id);
                  else next.add(day.id);
                  return next;
                })
              }
            >
              <span className="flex min-w-0 flex-wrap text-left text-sm font-medium">
                <span className="whitespace-nowrap">{day.date.slice(0, 4)}/</span>
                <span className="whitespace-nowrap">{candidateDayLabel(day.date).slice(5)}</span>
              </span>
              <span>{day.yes}</span>
              <span>{day.maybe}</span>
              <span>{day.no}</span>
              <span>{day.unanswered}</span>
            </button>
            {open.has(day.id) && (
              <div id={`day-detail-${day.id}`}>
                <DayResults token={token} dayId={day.id} />
              </div>
            )}
          </div>
        ))}
      </section>
      {data.slots.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">時間ごとの回答</h2>
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
                    {data.slots
                      .filter((s) => s.dayId === day.id)
                      .map((slot) => (
                        <li key={slot.id} className="flex flex-wrap justify-between gap-2 text-sm">
                          <span className="tabular-nums">
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
        </section>
      )}
      <DateFirstAccount
        data={data}
        myParticipantId={myParticipantId}
        signedIn={signedIn}
        initialParticipantId={initialParticipantId}
      />
      <details>
        <summary className="cursor-pointer py-2 font-semibold">
          参加者{data.participants.length}人・回答を編集
        </summary>
        <ul className="mt-3 space-y-3">
          {data.participants.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="min-w-0 flex-1 break-words">{p.name}</span>
              <a className="link" href={`/event/${token}/input?participant_id=${p.id}`}>
                日付を編集
              </a>
              {data.slots.length > 0 && (
                <a
                  className="link"
                  href={`/event/${token}/input?participant_id=${p.id}&kind=times`}
                >
                  時間を編集
                </a>
              )}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer py-2 font-semibold">候補日・時間を追加、変更</summary>
        <DateFirstConfiguration data={data} />
      </details>
      <div className="flex flex-wrap gap-3">
        <a className="btn btn-outline" href={`/event/${token}/finalize`}>
          日付・日時を確定、変更
        </a>
        <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
          最新の回答を読み込む
        </button>
      </div>
    </div>
  );
}
