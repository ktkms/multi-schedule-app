'use client';

/** ネイティブの時刻入力と日付選択で、当日から翌朝までを指定する。 */
export default function DateFirstTimeInput({
  label,
  value,
  onChange,
  inputTestId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputTestId?: string;
}) {
  const nextDay = value.startsWith('翌') || value === '24:00';
  const time = value === '24:00' ? '00:00' : value.replace(/^翌/, '');
  return (
    <fieldset className="min-w-0 flex-1 space-y-2">
      <legend className="mb-2 text-sm">{label}</legend>
      <div className="flex gap-2">
        <select
          className="select w-24 shrink-0"
          aria-label={`${label}の日付`}
          value={nextDay ? 'next' : 'same'}
          onChange={(event) => onChange(`${event.target.value === 'next' ? '翌' : ''}${time}`)}
        >
          <option value="same">当日</option>
          <option value="next">翌日</option>
        </select>
        <input
          type="time"
          step={60}
          className="input min-w-0 flex-1"
          aria-label={`${label}時刻`}
          data-testid={inputTestId}
          value={time}
          onChange={(event) => onChange(`${nextDay ? '翌' : ''}${event.target.value}`)}
        />
      </div>
    </fieldset>
  );
}
