'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import useSelectionDragController from '@/hooks/useSelectionDragController';
import { candidateDayLabel } from '@/lib/date-first-ui';

/** 暦日をそのまま選択し、端末由来のUTC変換を保存値へ持ち込まない。 */
export default function DateFirstDatePicker({
  value,
  onChange,
  existing = [],
}: {
  value: string[];
  onChange: (days: string[]) => void;
  existing?: string[];
}) {
  const monthId = useId();
  const container = useRef<HTMLDivElement>(null);
  const working = useRef(value);
  const active = useRef(false);
  useEffect(() => {
    if (!active.current) working.current = value;
  }, [value]);
  const onDragEnd = useCallback(() => {
    active.current = false;
  }, []);
  const [month, setMonth] = useState(
    () =>
      value[0]?.slice(0, 7) ??
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7),
  );
  const first = new Date(`${month}-01T00:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const count = last.getUTCDate();
  const dateKeys = Array.from(
    { length: count },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
  const drag = useSelectionDragController({
    isSelected: (key) => value.includes(key),
    onDragStart: () => {
      active.current = true;
      working.current = value;
    },
    onDragEnd,
    applySelection: (keys, selected) => {
      const next = new Set(active.current ? working.current : value);
      for (const key of keys) {
        if (existing.includes(key) || key >= '9999-12-31') continue;
        if (!selected) next.delete(key);
        else if (next.size + existing.length < 90) next.add(key);
      }
      working.current = [...next].sort();
      onChange(working.current);
    },
    shouldIgnorePointerEnter: () => !active.current,
    getKeyFromElement: (element) =>
      container.current?.contains(element)
        ? (element?.closest<HTMLElement>('[data-selection-key]')?.dataset.selectionKey ?? null)
        : null,
    disableBodyScroll: true,
  });
  const move = (amount: number) => {
    const date = new Date(first);
    date.setUTCMonth(date.getUTCMonth() + amount);
    setMonth(date.toISOString().slice(0, 7));
  };
  return (
    <div ref={container} className="space-y-4" data-testid="date-first-date-picker">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => move(-1)}
          aria-label="前の月"
          disabled={drag.isDragging || month <= '0001-01'}
        >
          前月
        </button>
        <label className="sr-only" htmlFor={monthId}>
          表示月
        </label>
        <input
          id={monthId}
          type="month"
          className="input w-40"
          value={month}
          disabled={drag.isDragging}
          min="0001-01"
          max="9999-12"
          onChange={(e) => {
            if (e.target.value) setMonth(e.target.value);
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => move(1)}
          aria-label="次の月"
          disabled={drag.isDragging || month >= '9999-12'}
        >
          翌月
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['日', '月', '火', '水', '木', '金', '土'].map((day) => (
          <span key={day} className="text-base-content/65 text-center text-sm">
            {day}
          </span>
        ))}
        {Array.from({ length: first.getUTCDay() }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {dateKeys.map((date, i) => {
          const selected = value.includes(date),
            registered = existing.includes(date);
          const disabled =
            registered ||
            date >= '9999-12-31' ||
            (!selected && value.length + existing.length >= 90);
          return (
            <button
              key={date}
              type="button"
              {...drag.getCellProps(date, { disabled })}
              data-testid={`candidate-date-${date}`}
              className={`btn touch-none px-0 ${selected ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={selected}
              aria-label={`${candidateDayLabel(date)}${registered ? ' 追加済み' : ''}`}
              disabled={disabled}
              onClick={(event) => {
                if (event.detail === 0 && !disabled) drag.toggleKey(date);
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <p className="text-sm" aria-live="polite">
        {value.length}日選択 / 残り{Math.max(0, 90 - existing.length - value.length)}日追加可能
      </p>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((day) => (
            <button
              key={day}
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label={`${candidateDayLabel(day)}を外す`}
              onClick={() => onChange(value.filter((d) => d !== day))}
            >
              {candidateDayLabel(day)} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
