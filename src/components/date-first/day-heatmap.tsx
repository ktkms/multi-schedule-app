'use client';

import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
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
}: {
  days: DateFirstEvent['days'];
  participantCount: number;
  activeDayId: string | null;
  onInspect: (id: string, anchor: HTMLButtonElement, pinned: boolean) => void;
  onLeave: () => void;
}) {
  const months = [...new Set(days.map((day) => day.date.slice(0, 7)))].sort();
  const [selectedMonth, setSelectedMonth] = useState(months[0] ?? '');
  const month = months.includes(selectedMonth) ? selectedMonth : months[0];
  if (!month) return <p className="text-sm">候補日はまだありません。</p>;
  const index = months.indexOf(month);
  const first = new Date(`${month}-01T00:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const candidates = new Map(days.map((day) => [day.date, day]));
  return (
    <div className="space-y-3" data-testid="date-first-day-heatmap">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn btn-ghost btn-square"
          aria-label="前の候補月"
          disabled={index === 0}
          onClick={() => setSelectedMonth(months[index - 1])}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <div className="flex flex-col items-center gap-1">
          <select
            className="select w-auto"
            aria-label="回答を表示する月"
            value={month}
            onChange={(event) => setSelectedMonth(event.target.value)}
          >
            {months.map((value) => (
              <option key={value} value={value}>
                {monthLabel(value)}
              </option>
            ))}
          </select>
          {months.length > 1 && (
            <span className="text-base-content/65 text-xs">
              候補月 {index + 1} / {months.length}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-square"
          aria-label="次の候補月"
          disabled={index === months.length - 1}
          onClick={() => setSelectedMonth(months[index + 1])}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="text-base-content/65 text-xs">色の濃さ：○の人数</p>
      <div className="grid grid-cols-7 gap-1">
        {['日', '月', '火', '水', '木', '金', '土'].map((weekday) => (
          <span key={weekday} className="text-base-content/65 text-center text-xs">
            {weekday}
          </span>
        ))}
        {Array.from({ length: first.getUTCDay() }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: last.getUTCDate() }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          const day = candidates.get(date);
          if (!day)
            return (
              <span key={date} className="text-base-content/40 min-h-16 p-1 text-center text-xs">
                {i + 1}
              </span>
            );
          const level =
            participantCount > 0 ? Math.min(5, Math.ceil((day.yes / participantCount) * 5)) : 0;
          const hasAnswer = day.yes + day.maybe + day.no > 0;
          return (
            <button
              key={day.id}
              type="button"
              data-testid={`day-results-${day.id}`}
              data-day-inspect={day.id}
              className={`focus-visible:outline-primary text-base-content flex min-h-16 min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-sm px-0.5 py-1 ${colors[level]}`}
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
                {i + 1}
                {day.confirmed && <Check size={14} className="shrink-0" aria-hidden="true" />}
              </span>
              {hasAnswer && <span className="text-sm font-semibold tabular-nums">○{day.yes}</span>}
              <span className="flex min-h-4 flex-wrap items-center justify-center gap-x-0.5 text-[11px] tabular-nums">
                {day.maybe > 0 && <span>△{day.maybe}</span>}
                {day.hasComment && (
                  <MessageSquare size={14} className="shrink-0" aria-hidden="true" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
