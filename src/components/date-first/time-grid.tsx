'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  id,
}: {
  value: DayInterval[];
  baseRanges: DayInterval[];
  onChange: (value: DayInterval[]) => void;
  disabled?: boolean;
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
    shouldIgnorePointerDown: () => disabled,
    shouldIgnorePointerEnter: () => disabled || !active.current,
    onDragStart,
    onDragEnd,
    getKeyFromElement: (element) =>
      element?.closest<HTMLElement>(`[data-time-grid="${id}"] [data-selection-key]`)?.dataset
        .selectionKey ?? null,
    disableBodyScroll: true,
  });
  const hasPartial = value.some(([lo, hi]) => lo % 60 !== 0 || hi % 60 !== 0);
  return (
    <div className="space-y-2" data-time-grid={id}>
      <div className="-mx-3 space-y-1 sm:mx-0" role="group" aria-label="参加可能な時間">
        {Array.from({ length: Math.ceil((end - start) / 720) }, (_, row) => {
          const rowStart = start + row * 720;
          return (
            <div key={row} data-time-row className="grid grid-cols-[repeat(14,minmax(0,1fr))]">
              <button
                type="button"
                className="min-h-11 text-sm disabled:opacity-30"
                disabled={disabled || start <= 0}
                aria-label="表示を1時間早める"
                onClick={() => setStart(Math.max(0, start - 60))}
              >
                ＋
              </button>
              {Array.from(
                { length: Math.min(12, (end - rowStart) / 60) },
                (_, index) => rowStart + index * 60,
              ).map((lo) => {
                const full = coversDayInterval(value, lo, lo + 60),
                  partial = !full && value.some(([a, b]) => a < lo + 60 && b > lo);
                return (
                  <button
                    key={lo}
                    type="button"
                    {...drag.getCellProps(`${id}:${lo}`, { disabled })}
                    disabled={disabled}
                    className={`border-base-100 min-h-11 touch-none rounded-sm border text-xs tabular-nums ${full ? 'bg-primary text-primary-content' : partial ? 'bg-primary/20 underline' : 'bg-base-200'}`}
                    aria-label={`${formatDayMinute(lo)}〜${formatDayMinute(lo + 60)}`}
                    aria-pressed={partial ? 'mixed' : full}
                    onClick={(event) => {
                      if (event.detail === 0) drag.toggleKey(`${id}:${lo}`);
                    }}
                  >
                    {lo >= 1440 ? `翌${(lo - 1440) / 60}` : lo / 60}
                  </button>
                );
              })}
              <button
                type="button"
                className="col-start-14 min-h-11 text-sm disabled:opacity-30"
                disabled={disabled || end >= 1800}
                aria-label="表示を1時間遅く延ばす"
                onClick={() => setEnd(Math.min(1800, end + 60))}
              >
                ＋
              </button>
            </div>
          );
        })}
      </div>
      {hasPartial && <p className="text-sm tabular-nums">{dayIntervalText(value)}</p>}
    </div>
  );
}
