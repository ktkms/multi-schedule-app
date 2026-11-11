'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { saveDateFirst } from '@/lib/date-first-actions';
import { dateFirstCommandSchema } from '@/lib/date-first-schema';
import {
  candidateDayLabel,
  dayIntervalText,
  mergeDayIntervals,
  type DayInterval,
} from '@/lib/date-first-ui';
import { addEventToHistory } from '@/lib/utils';
import { recordEventHistory } from '@/lib/event-history-actions';
import WizardProgress from '@/components/common/wizard-progress';
import TermsCheckbox from '@/components/terms/terms-checkbox';
import DateFirstDatePicker from './date-picker';

const steps = [{ label: 'イベント情報' }, { label: '候補日を選ぶ' }, { label: '内容を確認' }];
const presets: { label: string; range: DayInterval }[] = [
  { label: '朝', range: [360, 720] },
  { label: '昼', range: [720, 1080] },
  { label: '夜', range: [1080, 1440] },
  { label: '全日', range: [0, 1440] },
];

/** 日付だけの作成を明示し、旧日時先行型とは別の保存境界へ送る。 */
export default function DateFirstCreate() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const router = useRouter();
  const [step, setStep] = useState(1),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState('');
  const [days, setDays] = useState<string[]>([]),
    [ranges, setRanges] = useState<DayInterval[]>([]);
  const [reviewMonth, setReviewMonth] = useState('');
  const [selectedPresets, setSelectedPresets] = useState<string[]>([]);
  const [start, setStart] = useState('10:00'),
    [end, setEnd] = useState('22:00');
  const [accepted, setAccepted] = useState(false),
    [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const request = useRef<string | null>(null);
  const months = [...new Set(days.map((day) => day.slice(0, 7)))].sort();
  const month = months.includes(reviewMonth) ? reviewMonth : months[0];
  const monthIndex = months.indexOf(month);
  const firstDay = month ? new Date(`${month}-01T00:00:00Z`) : null;
  const lastDay = firstDay ? new Date(firstDay) : null;
  lastDay?.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  const daysInMonth = lastDay?.getUTCDate() ?? 0;
  const build = () => ({
    operation: 'create' as const,
    requestId: request.current ?? '00000000-0000-4000-8000-000000000000',
    title,
    description,
    days,
    baseRanges: ranges,
  });
  const next = () => {
    setError('');
    if (
      step === 1 &&
      (!title.trim() ||
        Array.from(title.trim()).length > 200 ||
        Array.from(description).length > 5000)
    ) {
      setError('イベント名は200文字以内、説明は5000文字以内で入力してください。');
      return;
    }
    if (step === 2 && ranges.length === 0) {
      setError('時間帯を選択してください。');
      return;
    }
    if (step === 2 && !dateFirstCommandSchema.safeParse(build()).success) {
      setError('候補日を1日以上選び、入力内容を確認してください。');
      return;
    }
    setStep(step + 1);
  };
  return (
    <form
      className="space-y-6"
      data-testid="date-first-create"
      onSubmit={(e) => {
        e.preventDefault();
        if (step < 3) {
          next();
          return;
        }
        if (!accepted) return;
        request.current ??= crypto.randomUUID();
        startTransition(async () => {
          setError('');
          try {
            const result = await saveDateFirst(build());
            if (!result.success) {
              setError(result.message);
              return;
            }
            const saved = z.object({ id: z.uuid(), token: z.string() }).parse(result.value);
            const historyItem = {
              id: saved.token,
              title: title.trim(),
              isCreatedByMe: true,
              createdAt: new Date().toISOString(),
            };
            addEventToHistory(historyItem);
            // 作成自体の成功を、任意の履歴同期の失敗へ置き換えない。
            await recordEventHistory(historyItem).catch(() => undefined);
            router.push(`/event/${saved.token}`);
          } catch {
            setError('保存結果を取得できませんでした。同じ内容で再試行してください。');
          }
        });
      }}
    >
      <WizardProgress currentStep={step} steps={steps} />
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <fieldset disabled={!ready || pending} className="space-y-5">
        {step === 1 && (
          <>
            <label className="block space-y-2">
              <span>イベント名</span>
              <input
                data-testid="date-first-title"
                className="input w-full"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </label>
            <label className="block space-y-2">
              <span>説明（任意）</span>
              <textarea
                className="textarea w-full"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </label>
          </>
        )}
        {step === 2 && (
          <>
            <DateFirstDatePicker value={days} onChange={setDays} />
            <section aria-labelledby="date-first-base-time-heading">
              <h3 id="date-first-base-time-heading" className="font-medium">
                時間帯（必須）
              </h3>
              <p className="text-base-content/65 mt-1 text-sm">
                空いている必要のある時間帯です。予定する大まかな時間を選択してください。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {presets.map((p) => {
                  const selected = selectedPresets.includes(p.label);
                  return (
                    <button
                      key={p.label}
                      type="button"
                      className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-outline'}`}
                      aria-pressed={selected}
                      onClick={() => {
                        const next = selected
                          ? selectedPresets.filter((label) => label !== p.label)
                          : p.label === '全日'
                            ? ['全日']
                            : [...selectedPresets.filter((label) => label !== '全日'), p.label];
                        const nextRanges = mergeDayIntervals(
                          presets
                            .filter((preset) => next.includes(preset.label))
                            .map((preset) => preset.range),
                        );
                        const full =
                          nextRanges.length === 1 &&
                          nextRanges[0][0] === 0 &&
                          nextRanges[0][1] === 1440;
                        setSelectedPresets(full ? ['全日'] : next);
                        setRanges(nextRanges);
                        if (nextRanges.length <= 1) {
                          const [lo, hi] = nextRanges[0] ?? [600, 1320];
                          setStart(
                            `${String(Math.floor(lo / 60)).padStart(2, '0')}:${String(lo % 60).padStart(2, '0')}`,
                          );
                          setEnd(
                            `${String(Math.floor(hi / 60)).padStart(2, '0')}:${String(hi % 60).padStart(2, '0')}`,
                          );
                        }
                        setError('');
                      }}
                    >
                      {p.label === '全日' ? '終日' : p.label}（{p.range[0] / 60}〜{p.range[1] / 60}
                      時）
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-sm">選択した時間帯：{dayIntervalText(ranges) || '未選択'}</p>
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
                  時刻を指定
                </summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {[
                    { label: '開始', value: start, setValue: setStart },
                    { label: '終了', value: end, setValue: setEnd },
                  ].map(({ label, value, setValue }) => {
                    const [hour, minute] = value.split(':');
                    return (
                      <fieldset key={label} className="min-w-0 space-y-2">
                        <legend className="mb-2 text-sm">{label}時刻</legend>
                        <div className="flex items-center gap-2">
                          <select
                            className="select min-w-0 flex-1"
                            aria-label={`${label}の時`}
                            value={hour}
                            onChange={(event) => setValue(`${event.target.value}:${minute}`)}
                          >
                            {Array.from({ length: 27 }, (_, i) => (
                              <option key={i} value={String(i).padStart(2, '0')}>
                                {i}時
                              </option>
                            ))}
                          </select>
                          <select
                            className="select min-w-0 flex-1"
                            aria-label={`${label}の分`}
                            value={minute}
                            onChange={(event) => setValue(`${hour}:${event.target.value}`)}
                          >
                            {Array.from({ length: 60 }, (_, i) => (
                              <option key={i} value={String(i).padStart(2, '0')}>
                                {String(i).padStart(2, '0')}分
                              </option>
                            ))}
                          </select>
                        </div>
                      </fieldset>
                    );
                  })}
                  <button
                    type="button"
                    className="btn btn-outline justify-self-start sm:col-span-2"
                    onClick={() => {
                      const [startHour, startMinute] = start.split(':').map(Number);
                      const [endHour, endMinute] = end.split(':').map(Number);
                      const lo = startHour * 60 + startMinute;
                      const hi = endHour * 60 + endMinute;
                      if (lo >= hi || hi > 1560)
                        setError('開始時刻より後、26:00までの終了時刻を選んでください。');
                      else {
                        setRanges([[lo, hi]]);
                        setSelectedPresets(
                          presets
                            .filter((preset) => preset.range[0] === lo && preset.range[1] === hi)
                            .map((preset) => preset.label),
                        );
                        setError('');
                      }
                    }}
                  >
                    この時間帯を使う
                  </button>
                </div>
                <p className="text-base-content/65 mt-2 text-sm">24時以降は翌日の時刻です。</p>
              </details>
            </section>
          </>
        )}
        {step === 3 && (
          <>
            <dl className="space-y-4">
              <div>
                <dt className="text-base-content/65 text-sm">イベント名</dt>
                <dd className="mt-1 break-words font-medium">{title.trim()}</dd>
              </div>
              {description && (
                <div>
                  <dt className="text-base-content/65 text-sm">説明</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">{description}</dd>
                </div>
              )}
              <div>
                <dt className="text-base-content/65 text-sm">候補日（{days.length}日）</dt>
                <dd className="mt-2" data-testid="date-first-create-days">
                  {firstDay && (
                    <div className="max-w-sm">
                      {months.length > 1 ? (
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost btn-square"
                            aria-label="前の候補月"
                            disabled={monthIndex === 0}
                            onClick={() => setReviewMonth(months[monthIndex - 1])}
                          >
                            <ChevronLeft size={20} aria-hidden="true" />
                          </button>
                          <label className="sr-only" htmlFor="review-month">
                            確認する月
                          </label>
                          <select
                            id="review-month"
                            className="select w-auto"
                            value={month}
                            onChange={(event) => setReviewMonth(event.target.value)}
                          >
                            {months.map((item) => (
                              <option key={item} value={item}>
                                {item.slice(0, 4)}年{Number(item.slice(5))}月（
                                {days.filter((day) => day.startsWith(item)).length}日）
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-ghost btn-square"
                            aria-label="次の候補月"
                            disabled={monthIndex === months.length - 1}
                            onClick={() => setReviewMonth(months[monthIndex + 1])}
                          >
                            <ChevronRight size={20} aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <p className="py-2 text-center text-sm font-medium">
                          {month.slice(0, 4)}年{Number(month.slice(5))}月
                        </p>
                      )}
                      <div
                        className="mt-1 grid grid-cols-7 gap-y-1 text-center text-sm"
                        role="img"
                        aria-label={`候補日：${days
                          .filter((day) => day.startsWith(month))
                          .map(candidateDayLabel)
                          .join('、')}`}
                      >
                        {['日', '月', '火', '水', '木', '金', '土'].map((weekday) => (
                          <span key={weekday} className="text-base-content/65 py-1">
                            {weekday}
                          </span>
                        ))}
                        {Array.from({ length: firstDay.getUTCDay() }, (_, index) => (
                          <span key={`blank-${index}`} />
                        ))}
                        {Array.from({ length: daysInMonth }, (_, index) => {
                          const day = `${month}-${String(index + 1).padStart(2, '0')}`;
                          const selected = days.includes(day);
                          return (
                            <span key={day} className="flex justify-center">
                              <span
                                className={`flex size-8 items-center justify-center rounded ${selected ? 'bg-primary text-primary-content font-semibold' : 'text-base-content/35'}`}
                              >
                                {index + 1}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-base-content/65 text-sm">時間帯</dt>
                <dd className="mt-1">{dayIntervalText(ranges)}</dd>
              </div>
            </dl>
            <TermsCheckbox isChecked={accepted} onChange={setAccepted} />
          </>
        )}
        <div className="flex items-center gap-3">
          {step > 1 && (
            <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
              戻る
            </button>
          )}
          <button
            data-testid="date-first-create-next"
            type="submit"
            className="btn btn-primary ml-auto"
            disabled={step === 3 && !accepted}
          >
            {pending ? '作成中…' : step === 3 ? 'イベントを作成' : '次へ'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
