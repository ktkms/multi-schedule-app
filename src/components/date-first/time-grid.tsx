'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import useSelectionDragController from '@/hooks/useSelectionDragController';
import { formatDayMinute } from '@/lib/date-first-schema';
import {
  coversDayInterval,
  paintDayInterval,
  dayIntervalText,
  type DayInterval,
} from '@/lib/date-first-ui';

/** 表示拡張は保存せず、操作したセルの区間だけを親へ返す。 */
export default function DateFirstTimeGrid({
  value,
  baseRanges,
  onChange,
  disabled = false,
  readOnly = false,
  id,
}: {
  value: DayInterval[];
  baseRanges: DayInterval[];
  onChange: (value: DayInterval[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  id: string;
}) {
  const all = [...baseRanges, ...value];
  const active = useRef(false);
  const working = useRef(value);
  useEffect(() => {
    if (!active.current) working.current = value;
  }, [value]);
  const onDragStart = useCallback(() => {
    active.current = true;
  }, []);
  const onDragEnd = useCallback(() => {
    active.current = false;
  }, []);
  const [start, setStart] = useState(
    () => Math.floor(Math.min(...(all.length ? all.map((r) => r[0]) : [600])) / 60) * 60,
  );
  const [end, setEnd] = useState(
    () => Math.ceil(Math.max(...(all.length ? all.map((r) => r[1]) : [1320])) / 60) * 60,
  );
  useEffect(() => {
    if (active.current || value.length === 0) return;
    const lo = Math.floor(Math.min(...value.map((range) => range[0])) / 60) * 60;
    const hi = Math.ceil(Math.max(...value.map((range) => range[1])) / 60) * 60;
    setStart((old) => Math.min(old, lo));
    setEnd((old) => Math.max(old, hi));
  }, [value]);
  const drag = useSelectionDragController({
    isSelected: (key) =>
      coversDayInterval(value, Number(key.split(':').at(-1)), Number(key.split(':').at(-1)) + 60),
    applySelection: (keys, selected) => {
      let next = active.current ? working.current : value;
      for (const key of keys) {
        const lo = Number(key.split(':').at(-1));
        next = paintDayInterval(next, lo, lo + 60, selected);
      }
      working.current = next;
      onChange(next);
    },
    shouldIgnorePointerDown: () => disabled || readOnly,
    shouldIgnorePointerEnter: () => disabled || readOnly || !active.current,
    onDragStart,
    onDragEnd,
    getKeyFromElement: (element) =>
      element?.closest<HTMLElement>(`[data-time-grid="${id}"] [data-selection-key]`)?.dataset
        .selectionKey ?? null,
    disableBodyScroll: true,
  });
  const hasPartial = value.some(([lo, hi]) => lo % 60 !== 0 || hi % 60 !== 0);
  const cellWidth = 'min-w-0 basis-[min(2.25rem,calc(100%/14))] shrink-0';
  return (
    <div className="space-y-2" data-time-grid={id}>
      <p id={`${id}-time-help`} className="text-base-content/65 text-sm">
        可能な時間を入力してください。
      </p>
      <div
        className="-mx-3 flex flex-wrap gap-y-1 sm:mx-0"
        role="group"
        aria-label="参加可能な時間"
        aria-describedby={`${id}-time-help`}
      >
        <button
          type="button"
          className={`${cellWidth} min-h-11 disabled:opacity-30`}
          disabled={disabled || start <= 0}
          aria-label="表示を1時間早める"
          onClick={() => {
            if (!readOnly) setStart(Math.max(0, start - 60));
          }}
        >
          <Plus size={16} className="mx-auto" aria-hidden="true" />
        </button>
        {Array.from({ length: (end - start) / 60 }, (_, index) => start + index * 60).map((lo) => {
          const full = coversDayInterval(value, lo, lo + 60);
          const partial = !full && value.some(([a, b]) => a < lo + 60 && b > lo);
          const last = lo === end - 60;
          const cell = (
            <button
              key={lo}
              type="button"
              {...drag.getCellProps(`${id}:${lo}`, { disabled: disabled || readOnly })}
              disabled={disabled}
              className={`border-base-100 min-h-11 touch-none rounded-sm border text-xs tabular-nums ${last ? 'w-full min-w-0' : cellWidth} ${full ? 'bg-primary text-primary-content' : partial ? 'bg-primary/20 underline' : 'bg-base-200'}`}
              aria-label={`${formatDayMinute(lo)}〜${formatDayMinute(lo + 60)}`}
              aria-pressed={partial ? 'mixed' : full}
              onClick={(event) => {
                if (!readOnly && event.detail === 0) drag.toggleKey(`${id}:${lo}`);
              }}
            >
              {lo >= 1440 ? `翌${(lo - 1440) / 60}` : lo / 60}
            </button>
          );
          return last ? (
            <div
              key="time-end"
              className="grid shrink-0 basis-[min(4.5rem,calc(100%/7))] grid-cols-2"
            >
              {cell}
              <button
                type="button"
                className="min-h-11 disabled:opacity-30"
                disabled={disabled || end >= 1800}
                aria-label="表示を1時間後ろに延ばす"
                onClick={() => {
                  if (!readOnly) setEnd(Math.min(1800, end + 60));
                }}
              >
                <Plus size={16} className="mx-auto" aria-hidden="true" />
              </button>
            </div>
          ) : (
            cell
          );
        })}
      </div>
      {hasPartial && <p className="text-sm tabular-nums">{dayIntervalText(value)}</p>}
    </div>
  );
}
