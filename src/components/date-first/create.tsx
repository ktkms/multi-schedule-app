'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { saveDateFirst } from '@/lib/date-first-actions';
import { dateFirstCommandSchema } from '@/lib/date-first-schema';
import {
  candidateDayLabel,
  dayIntervalText,
  mergeDayIntervals,
  parseDayMinute,
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
    [ranges, setRanges] = useState<DayInterval[]>([[600, 1320]]);
  const [selectedPresets, setSelectedPresets] = useState<string[]>([]);
  const [start, setStart] = useState('10:00'),
    [end, setEnd] = useState('22:00');
  const [accepted, setAccepted] = useState(false),
    [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const request = useRef<string | null>(null);
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
      setError('タイトルは200文字以内、説明は5000文字以内で入力してください。');
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
            <details>
              <summary className="cursor-pointer py-2">△回答の基本表示時間（任意）</summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {presets.map((p) => {
                  const selected = selectedPresets.includes(p.label);
                  return (
                    <button
                      key={p.label}
                      type="button"
                      className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-ghost'}`}
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
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-sm">
                {dayIntervalText(ranges) || '標準の10:00〜22:00を表示'}
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label>
                  開始
                  <input
                    aria-label="基本表示の開始"
                    className="input block w-28"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label>
                  終了
                  <input
                    aria-label="基本表示の終了"
                    className="input block w-28"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    const lo = parseDayMinute(start),
                      hi = parseDayMinute(end);
                    if (lo === null || hi === null || lo >= hi)
                      setError('例：18:00〜翌2:00。翌6:00まで指定できます。');
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
                  範囲を置き換える
                </button>
              </div>
            </details>
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
                <dt className="text-base-content/65 text-sm">候補日</dt>
                <dd className="mt-1 flex flex-wrap gap-3">
                  {days.map((day) => (
                    <span key={day}>
                      {day}（{candidateDayLabel(day)}）
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
            <TermsCheckbox isChecked={accepted} onChange={setAccepted} />
          </>
        )}
        <div className="flex gap-3">
          {step > 1 && (
            <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
              戻る
            </button>
          )}
          <button
            data-testid="date-first-create-next"
            type="submit"
            className="btn btn-primary"
            disabled={step === 3 && !accepted}
          >
            {pending ? '作成中…' : step === 3 ? 'イベントを作成' : '次へ'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
