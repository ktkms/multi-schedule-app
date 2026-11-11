'use client';

import { useState } from 'react';
import { Check, MessageSquare } from 'lucide-react';
import type { DateFirstEvent } from '@/lib/date-first-schema';
import { candidateDayLabel } from '@/lib/date-first-ui';

const colors = [
  'bg-base-200',
  'bg-primary/10',
  'bg-primary/20',
  'bg-primary/30',
  'bg-primary/40',
  'bg-primary/50',
];
const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;

/** ○の人数を濃淡で比較し、条件付きの△を確実な参加人数へ混ぜない。 */
export default function DateFirstDayHeatmap({
  days,
  participantCount,
  activeDayId,
  onInspect,
  onLeave,
  onViewChange = () => {},
}: {
  days: DateFirstEvent['days'];
  participantCount: number;
  activeDayId: string | null;
  onInspect: (id: string, anchor: HTMLButtonElement, pinned: boolean) => void;
  onLeave: () => void;
  onViewChange?: () => void;
}) {
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const months = [...new Set(days.map((day) => day.date.slice(0, 7)))].sort();
  const candidates = new Map(days.map((day) => [day.date, day]));
  if (!months.length) return <p className="text-sm">候補日はまだありません。</p>;

  const renderDay = (day: DateFirstEvent['days'][number], date: string, number: number) => {
    const level =
      participantCount > 0 ? Math.min(5, Math.ceil((day.yes / participantCount) * 5)) : 0;
    const hasAnswer = day.yes + day.maybe + day.no > 0;
    return (
      <button
        key={day.id}
        type="button"
        data-testid={`day-results-${day.id}`}
        data-day-inspect={day.id}
        className={`focus-visible:outline-primary text-base-content flex min-w-0 cursor-pointer rounded-sm ${view === 'list' ? 'min-h-11 w-full flex-row items-center justify-between gap-2 px-3 py-2 text-left' : 'min-h-16 flex-col items-center justify-center gap-0.5 px-0.5 py-1'} ${colors[level]}`}
        aria-label={`${candidateDayLabel(date)} ${hasAnswer ? `○${day.yes}人、△${day.maybe}人、×${day.no}人` : '回答なし'}、未回答${day.unanswered}人${day.confirmed ? '、確定済み' : ''}${day.hasComment ? '、コメントあり' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={activeDayId === day.id}
        aria-controls={activeDayId === day.id ? 'date-first-day-detail' : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') onInspect(day.id, event.currentTarget, false);
        }}
        onPointerLeave={onLeave}
        onClick={(event) => onInspect(day.id, event.currentTarget, true)}
      >
        <span className="flex items-center gap-0.5 text-xs">
          <span>{view === 'list' ? candidateDayLabel(date) : number}</span>
          {day.confirmed && <Check size={14} className="shrink-0" aria-hidden="true" />}
        </span>
        {hasAnswer && <span className="text-sm font-semibold tabular-nums">○{day.yes}</span>}
        <span
          className={`flex min-h-4 flex-wrap gap-x-2 text-[11px] tabular-nums ${view === 'list' ? 'items-center justify-end' : 'items-center justify-center gap-x-0.5'}`}
        >
          {day.maybe > 0 && <span>△{day.maybe}</span>}
          {view === 'list' && hasAnswer && <span>未回答{day.unanswered}</span>}
          {day.hasComment && <MessageSquare size={14} className="shrink-0" aria-hidden="true" />}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-3" data-testid="date-first-day-heatmap">
      <div className="flex justify-end">
        <div className="join" aria-label="回答の表示形式">
          <button
            type="button"
            className={`btn btn-sm join-item ${view === 'calendar' ? 'btn-active' : 'btn-ghost'}`}
            aria-pressed={view === 'calendar'}
            onClick={() => {
              setView('calendar');
              onViewChange();
            }}
          >
            カレンダー
          </button>
          <button
            type="button"
            className={`btn btn-sm join-item ${view === 'list' ? 'btn-active' : 'btn-ghost'}`}
            aria-pressed={view === 'list'}
            onClick={() => {
              setView('list');
              onViewChange();
            }}
          >
            リスト
          </button>
        </div>
      </div>
      {view === 'calendar' ? (
        <div className="space-y-6" data-testid="date-first-calendar-view">
          {months.map((month, monthIndex) => {
            const first = new Date(`${month}-01T00:00:00Z`);
            const monthEnd = new Date(first);
            monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
            const monthDays = days
              .filter((day) => day.date.startsWith(`${month}-`))
              .sort((a, b) => a.date.localeCompare(b.date));
            const finalDate = monthIndex === months.length - 1 ? monthDays.at(-1)?.date : undefined;
            const finalCandidate = finalDate ? Number(finalDate.slice(-2)) : monthEnd.getUTCDate();
            const end = finalDate
              ? Math.min(
                  monthEnd.getUTCDate(),
                  finalCandidate + (6 - new Date(`${finalDate}T00:00:00Z`).getUTCDay()),
                )
              : monthEnd.getUTCDate();
            return (
              <section key={month} aria-label={monthLabel(month)} className="space-y-2">
                <h3 className="font-medium">{monthLabel(month)}</h3>
                <div className="grid grid-cols-7 gap-1">
                  {['日', '月', '火', '水', '木', '金', '土'].map((weekday) => (
                    <span key={weekday} className="text-base-content/65 text-center text-xs">
                      {weekday}
                    </span>
                  ))}
                  {Array.from({ length: first.getUTCDay() }, (_, i) => (
                    <span key={`blank-${i}`} aria-hidden="true" />
                  ))}
                  {Array.from({ length: end }, (_, i) => {
                    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                    const day = candidates.get(date);
                    return day ? (
                      renderDay(day, date, i + 1)
                    ) : (
                      <span
                        key={date}
                        className="text-base-content/40 min-h-16 p-1 text-center text-xs"
                      >
                        {i + 1}
                      </span>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-5" data-testid="date-first-list-view">
          {months.map((month) => (
            <section key={month} aria-label={monthLabel(month)} className="space-y-2">
              <h3 className="font-medium">{monthLabel(month)}</h3>
              <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {days
                  .filter((day) => day.date.startsWith(`${month}-`))
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((day) => (
                    <li key={day.id}>{renderDay(day, day.date, Number(day.date.slice(-2)))}</li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
