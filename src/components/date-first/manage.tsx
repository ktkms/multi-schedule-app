'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveDateFirst } from '@/lib/date-first-actions';
import { type DateFirstEvent, formatDayMinute } from '@/lib/date-first-schema';
import {
  candidateDayLabel,
  dayIntervalText,
  parseDayMinute,
  type DayInterval,
} from '@/lib/date-first-ui';
import ConfirmationModal from '@/components/common/confirmation-modal';
import DateFirstDatePicker from './date-picker';

/** 候補の構造変更を回答保存から分け、解除される確定日時を同じ確認で提示する。 */
export function DateFirstConfiguration({ data }: { data: DateFirstEvent }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [days, setDays] = useState<string[]>([]),
    [targets, setTargets] = useState(data.days.filter((d) => d.target).map((d) => d.id));
  const [dayId, setDayId] = useState(data.days.find((d) => d.target)?.id ?? data.days[0]?.id ?? '');
  const [start, setStart] = useState('10:00'),
    [end, setEnd] = useState('22:00'),
    [unit, setUnit] = useState(60);
  const [retire, setRetire] = useState<string[]>([]),
    [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<'days' | 'targets' | 'slots' | null>(null);
  const [retireOnly, setRetireOnly] = useState(false);
  const [pending, startTransition] = useTransition();
  const confirmed = data.days.some((d) => d.confirmed),
    day = data.days.find((d) => d.id === dayId);
  const lo = parseDayMinute(start),
    hi = parseDayMinute(end);
  const ranges: DayInterval[] = [];
  if (lo !== null && hi !== null && lo < hi) {
    if (unit === 0) ranges.push([lo, hi]);
    else
      for (let value = lo; value < hi; value += unit)
        ranges.push([value, Math.min(hi, value + unit)]);
  }
  const removed = data.slots.filter((s) => retire.includes(s.id)),
    unfinalized = removed.filter((s) => s.finalized);
  const previewRanges = retireOnly ? [] : ranges;
  const save = () =>
    startTransition(async () => {
      const base = { token: data.event.token, revision: data.event.revision };
      const command =
        confirmation === 'days'
          ? { operation: 'addDays' as const, ...base, days }
          : confirmation === 'targets'
            ? { operation: 'setTargets' as const, ...base, dayIds: targets }
            : {
                operation: 'configure' as const,
                ...base,
                dayId,
                ranges: previewRanges,
                retireIds: retire,
                acknowledgedIds: unfinalized.map((s) => s.id),
              };
      try {
        const result = await saveDateFirst(command);
        if (!result.success) {
          setError(result.message);
          setConfirmation(null);
          return;
        }
        window.location.reload();
      } catch {
        setError(
          '結果を取得できませんでした。入力を保持しています。保存結果を確認してから再試行してください。',
        );
        setConfirmation(null);
      }
    });
  return (
    <div className="mt-5 space-y-8" data-testid="date-first-configuration">
      {error && (
        <p className="text-error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={!ready || pending} className="space-y-4">
        <legend className="mb-3 font-semibold">候補日を追加</legend>
        <DateFirstDatePicker
          value={days}
          onChange={setDays}
          existing={data.days.map((d) => d.date)}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={days.length === 0}
          onClick={() => setConfirmation('days')}
        >
          追加する日付を確認
        </button>
      </fieldset>
      {!confirmed && (
        <fieldset disabled={!ready || pending} className="space-y-3">
          <legend className="mb-3 font-semibold">時間を調整する対象日</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {data.days.map((day) => (
              <label key={day.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={targets.includes(day.id)}
                  onChange={(e) =>
                    setTargets((old) =>
                      e.target.checked ? [...old, day.id] : old.filter((id) => id !== day.id),
                    )
                  }
                />
                {candidateDayLabel(day.date)}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setConfirmation('targets')}
          >
            対象日の変更を確認
          </button>
        </fieldset>
      )}
      <fieldset disabled={!ready || pending} className="space-y-4">
        <legend className="mb-3 font-semibold">時間候補を設定</legend>
        {confirmed && (
          <p className="text-base-content/65 text-sm">時間候補は確定済みの日付に設定します。</p>
        )}
        <label className="block space-y-2">
          <span>日付</span>
          <select
            className="select w-full"
            value={dayId}
            onChange={(e) => {
              setDayId(e.target.value);
              setRetire([]);
            }}
          >
            {data.days
              .filter((d) => !confirmed || d.confirmed)
              .map((day) => (
                <option key={day.id} value={day.id}>
                  {candidateDayLabel(day.date)}
                </option>
              ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="space-y-2">
            <span className="block">開始</span>
            <input
              data-testid="date-first-slot-start"
              className="input w-32"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="18:00"
            />
          </label>
          <label className="space-y-2">
            <span className="block">終了</span>
            <input
              data-testid="date-first-slot-end"
              className="input w-32"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="翌2:00"
            />
          </label>
        </div>
        <p className="text-base-content/65 text-sm">
          翌朝は「翌2:00」のように指定できます（翌6:00まで）。
        </p>
        <label className="block space-y-2">
          <span>候補の区切り</span>
          <select
            className="select w-full"
            value={unit}
            onChange={(e) => setUnit(Number(e.target.value))}
          >
            <option value={60}>1時間ごと</option>
            <option value={30}>30分ごと</option>
            <option value={15}>15分ごと</option>
            <option value={0}>範囲全体を1候補にする</option>
          </select>
        </label>
        {data.slots.some((s) => s.dayId === dayId) && (
          <div className="space-y-2">
            <p className="text-sm">外す候補（回答は保持します）</p>
            {data.slots
              .filter((s) => s.dayId === dayId)
              .map((slot) => (
                <label key={slot.id} className="flex items-center gap-3">
                  <input
                    className="checkbox checkbox-sm"
                    type="checkbox"
                    checked={retire.includes(slot.id)}
                    onChange={(e) =>
                      setRetire((old) =>
                        e.target.checked ? [...old, slot.id] : old.filter((id) => id !== slot.id),
                      )
                    }
                  />
                  <span>
                    {formatDayMinute(slot.start)}〜{formatDayMinute(slot.end)}
                    {slot.finalized ? '（確定済み）' : ''}
                  </span>
                </label>
              ))}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            data-testid="date-first-configure-review"
            className="btn btn-primary"
            disabled={ranges.length === 0}
            onClick={() => {
              setRetireOnly(false);
              setConfirmation('slots');
            }}
          >
            時間候補の追加・変更を確認
          </button>
          {retire.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRetireOnly(true);
                setConfirmation('slots');
              }}
            >
              選んだ候補を外す
            </button>
          )}
        </div>
      </fieldset>
      <ConfirmationModal
        isOpen={confirmation !== null}
        title={
          confirmation === 'days'
            ? '候補日を追加'
            : confirmation === 'targets'
              ? '時間調整の対象を変更'
              : '時間候補を変更'
        }
        confirmLabel="この内容で保存"
        isConfirming={pending}
        onCancel={() => setConfirmation(null)}
        onConfirm={save}
      >
        <div className="mt-4 space-y-3">
          {confirmation === 'days' ? (
            days.map((day) => <p key={day}>{candidateDayLabel(day)}</p>)
          ) : confirmation === 'targets' ? (
            <>
              <p>対象外の日の時間回答は保持し、集計から外します。</p>
              {targets.length ? (
                targets.map((id) => (
                  <p key={id}>{candidateDayLabel(data.days.find((d) => d.id === id)!.date)}</p>
                ))
              ) : (
                <p>対象日をすべて外します。</p>
              )}
            </>
          ) : (
            <>
              <p>{day ? candidateDayLabel(day.date) : ''}</p>
              {!confirmed && !day?.target && previewRanges.length > 0 && (
                <p>この日を時間調整の対象に加えます。</p>
              )}
              {previewRanges.length > 0 && (
                <p className="break-words">追加・復帰：{dayIntervalText(previewRanges)}</p>
              )}
              {removed.length > 0 && (
                <p>候補から外す：{dayIntervalText(removed.map((s) => [s.start, s.end]))}</p>
              )}
              {unfinalized.length > 0 && (
                <p className="text-warning">
                  日時確定も解除：{dayIntervalText(unfinalized.map((s) => [s.start, s.end]))}
                  。日付の確定は維持します。
                </p>
              )}
            </>
          )}
        </div>
      </ConfirmationModal>
    </div>
  );
}

/** 希望する日付・日時の集合を一括確認し、同じrevisionのまま原子的に確定する。 */
export function DateFirstFinalization({ data }: { data: DateFirstEvent }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const router = useRouter();
  const [days, setDays] = useState(data.days.filter((d) => d.confirmed).map((d) => d.id)),
    [times, setTimes] = useState(data.slots.filter((s) => s.finalized).map((s) => s.id));
  const [confirm, setConfirm] = useState(false),
    [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const removed = data.slots.filter((s) => s.finalized && !times.includes(s.id));
  return (
    <div className="space-y-6" data-testid="date-first-finalization">
      <h2 className="page-title">日付・日時を確定</h2>
      {error && (
        <p className="text-error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={!ready || pending} className="space-y-5">
        {data.days.map((day) => (
          <section key={day.id} className="space-y-3">
            <label className="flex items-center gap-3 font-medium">
              <input
                data-testid={`finalize-day-${day.id}`}
                className="checkbox"
                type="checkbox"
                checked={days.includes(day.id)}
                onChange={(e) => {
                  setDays((old) =>
                    e.target.checked ? [...old, day.id] : old.filter((id) => id !== day.id),
                  );
                  if (!e.target.checked)
                    setTimes((old) =>
                      old.filter((id) => data.slots.find((s) => s.id === id)?.dayId !== day.id),
                    );
                }}
              />
              {candidateDayLabel(day.date)}を確定
            </label>
            <div className="ml-9 space-y-3">
              {data.slots
                .filter((s) => s.dayId === day.id)
                .map((slot) => (
                  <label key={slot.id} className="flex items-center gap-3">
                    <input
                      data-testid={`finalize-time-${slot.id}`}
                      className="checkbox checkbox-sm"
                      type="checkbox"
                      checked={times.includes(slot.id)}
                      onChange={(e) => {
                        setTimes((old) =>
                          e.target.checked ? [...old, slot.id] : old.filter((id) => id !== slot.id),
                        );
                        if (e.target.checked)
                          setDays((old) => (old.includes(day.id) ? old : [...old, day.id]));
                      }}
                    />
                    {formatDayMinute(slot.start)}〜{formatDayMinute(slot.end)}（○{slot.yes}・×
                    {slot.no}・未回答{slot.unanswered}）
                  </label>
                ))}
            </div>
          </section>
        ))}
        <div className="flex gap-3">
          <a className="btn btn-ghost" href={`/event/${data.event.token}`}>
            戻る
          </a>
          <button
            className="btn btn-primary"
            type="button"
            data-testid="date-first-finalize-review"
            onClick={() => setConfirm(true)}
          >
            確定内容を確認
          </button>
        </div>
      </fieldset>
      <ConfirmationModal
        isOpen={confirm}
        title="確定内容を保存"
        confirmLabel="この内容で確定"
        isConfirming={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          startTransition(async () => {
            try {
              const result = await saveDateFirst({
                operation: 'finalize',
                token: data.event.token,
                revision: data.event.revision,
                dayIds: days,
                timeIds: times,
                acknowledgedIds: removed.map((s) => s.id),
              });
              if (!result.success) {
                setError(result.message);
                setConfirm(false);
                return;
              }
              router.push(`/event/${data.event.token}`);
            } catch {
              setError('結果を確認できませんでした。選択内容は保持しています。');
              setConfirm(false);
            }
          })
        }
      >
        <div className="mt-4 space-y-3">
          {days.length === 0 ? (
            <p>すべての日付・日時の確定を解除します。</p>
          ) : (
            data.days
              .filter((d) => days.includes(d.id))
              .map((day) => {
                const slots = data.slots.filter((s) => s.dayId === day.id && times.includes(s.id));
                return (
                  <p key={day.id}>
                    {candidateDayLabel(day.date)}：
                    {slots.length
                      ? dayIntervalText(slots.map((s) => [s.start, s.end]))
                      : '時間未定'}
                  </p>
                );
              })
          )}
          {data.days.some((d) => d.confirmed && !days.includes(d.id)) && (
            <p>
              日付の確定を解除：
              {data.days
                .filter((d) => d.confirmed && !days.includes(d.id))
                .map((d) => candidateDayLabel(d.date))
                .join('、')}
            </p>
          )}
          {removed.length > 0 && (
            <p className="text-warning">
              日時の確定を解除：
              {removed
                .map(
                  (s) =>
                    `${candidateDayLabel(data.days.find((d) => d.id === s.dayId)!.date)} ${formatDayMinute(s.start)}〜${formatDayMinute(s.end)}`,
                )
                .join('、')}
            </p>
          )}
        </div>
      </ConfirmationModal>
    </div>
  );
}
