'use client';

import { useState } from 'react';
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
  const [month, setMonth] = useState(
    () =>
      value[0]?.slice(0, 7) ??
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).slice(0, 7),
  );
  const first = new Date(`${month}-01T00:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const count = last.getUTCDate();
  const move = (amount: number) => {
    const date = new Date(first);
    date.setUTCMonth(date.getUTCMonth() + amount);
    setMonth(date.toISOString().slice(0, 7));
  };
  return (
    <div className="space-y-4" data-testid="date-first-date-picker">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => move(-1)}
          aria-label="前の月"
          disabled={month <= '0001-01'}
        >
          前月
        </button>
        <label className="sr-only" htmlFor="candidate-month">
          表示月
        </label>
        <input
          id="candidate-month"
          type="month"
          className="input w-40"
          value={month}
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
          disabled={month >= '9999-12'}
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
        {Array.from({ length: count }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`,
            selected = value.includes(date),
            registered = existing.includes(date);
          return (
            <button
              key={date}
              type="button"
              data-testid={`candidate-date-${date}`}
              className={`btn px-0 ${selected ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={selected}
              aria-label={`${candidateDayLabel(date)}${registered ? ' 追加済み' : ''}`}
              disabled={
                registered ||
                date >= '9999-12-31' ||
                (!selected && value.length + existing.length >= 90)
              }
              onClick={() =>
                onChange(selected ? value.filter((d) => d !== date) : [...value, date].sort())
              }
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
