'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Circle, MessageSquare, Triangle, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { getDateFirstAnswer, saveDateFirst } from '@/lib/date-first-actions';
import {
  type DateFirstAnswer,
  type DateFirstEvent,
  type DateFirstSyncPreview,
  formatDayMinute,
} from '@/lib/date-first-schema';
import {
  candidateDayLabel,
  coversDayInterval,
  dayIntervalText,
  type DayInterval,
} from '@/lib/date-first-ui';
import ConfirmationModal from '@/components/common/confirmation-modal';
import TermsCheckbox from '@/components/terms/terms-checkbox';
import DateFirstTimeGrid from './time-grid';

type Status = 'yes' | 'maybe' | 'no' | null;
type DraftDay = {
  status: Status;
  comment: string;
  intervals: DayInterval[];
  statusDirty: boolean;
  commentDirty: boolean;
  intervalsDirty: boolean;
};
const symbol = (value: Status) =>
  value === 'yes' ? '○' : value === 'maybe' ? '△' : value === 'no' ? '×' : '未回答';
const sameIntervals = (a: DayInterval[], b: DayInterval[]) =>
  a.length === b.length && a.every(([lo, hi], i) => lo === b[i][0] && hi === b[i][1]);
const initialDays = (
  data: DateFirstEvent,
  answer: DateFirstAnswer | null,
): Record<string, DraftDay> =>
  Object.fromEntries(
    data.days.map((day) => {
      const saved = answer?.days.find((row) => row.id === day.id);
      return [
        day.id,
        {
          status: saved?.status ?? null,
          comment: saved?.comment ?? '',
          intervals: saved?.intervals ?? [],
          statusDirty: false,
          commentDirty: false,
          intervalsDirty: false,
        },
      ];
    }),
  );

/** 日付・時間の変更項目だけを送信し、共同編集の競合でも未送信入力を保持する。 */
export default function DateFirstAnswerEditor({
  data,
  initialAnswer,
  kind,
  scheduleDraft,
}: {
  data: DateFirstEvent;
  initialAnswer: DateFirstAnswer | null;
  kind: 'days' | 'times';
  scheduleDraft?: Pick<DateFirstSyncPreview, 'days' | 'times'>;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [scheduleDismissed, setScheduleDismissed] = useState(false);
  useEffect(() => setReady(true), []);
  const [baseline, setBaseline] = useState(initialAnswer),
    [name, setName] = useState(initialAnswer?.name ?? '');
  const [days, setDays] = useState(() => initialDays(data, initialAnswer));
  const [times, setTimes] = useState<Record<string, boolean | null>>({});
  const [timeEditor, setTimeEditor] = useState<{
    dayIds: string[];
    intervals: DayInterval[] | null;
    edited: boolean;
  } | null>(null);
  const [comments, setComments] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState(data.days.find((d) => d.target)?.id ?? '');
  const [error, setError] = useState(''),
    [accepted, setAccepted] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [latest, setLatest] = useState<DateFirstAnswer | null>(null),
    [leaving, setLeaving] = useState<string | null>(null);
  const [showProposals, setShowProposals] = useState(false),
    [dragDays, setDragDays] = useState<Record<string, DraftDay> | null>(null);
  const dragging = dragDays !== null;
  const [pending, startTransition] = useTransition();
  const rowMotion = useRef(new Map<string, { height: number; animation: Animation | null }>());
  const request = useRef<string | null>(null),
    saved = useRef(false),
    commentFocus = useRef<string | null>(null),
    container = useRef<HTMLDivElement>(null);
  const gesture = useRef<null | {
    pointerId: number;
    id: string;
    status: Exclude<Status, null>;
    x: number;
    y: number;
    moved: boolean;
    dayIds: Set<string>;
    original: Record<string, DraftDay>;
    next: Record<string, DraftDay>;
  }>(null);
  useEffect(() => {
    const rows = rowMotion.current;
    return () => {
      for (const row of rows.values()) row.animation?.cancel();
    };
  }, []);
  useLayoutEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    for (const element of container.current?.querySelectorAll<HTMLElement>('[data-answer-day]') ??
      []) {
      const id = element.dataset.answerDay!;
      const previous = rowMotion.current.get(id);
      if (dragging && !reduced) {
        previous?.animation?.pause();
        continue;
      }
      const animated =
        previous?.animation?.playState === 'running' || previous?.animation?.playState === 'paused';
      const from = animated ? element.getBoundingClientRect().height : previous?.height;
      previous?.animation?.cancel();
      const height = element.getBoundingClientRect().height;
      const animation =
        !reduced &&
        from !== undefined &&
        Math.abs(from - height) > 1 &&
        typeof element.animate === 'function'
          ? element.animate(
              [
                { height: `${from}px`, clipPath: 'inset(0 -0.75rem)' },
                { height: `${height}px`, clipPath: 'inset(0 -0.75rem)' },
              ],
              { duration: 160, easing: 'ease-out' },
            )
          : null;
      rowMotion.current.set(id, { height, animation });
    }
  }, [days, comments, dragging]);
  const dayChanges = Object.entries(days)
    .filter(([, d]) => d.statusDirty || d.commentDirty || d.intervalsDirty)
    .map(([id, d]) => ({
      id,
      ...(d.statusDirty ? { status: d.status } : {}),
      ...(d.commentDirty && d.status !== null ? { comment: d.comment } : {}),
      ...(d.status === 'maybe' && d.intervalsDirty ? { intervals: d.intervals } : {}),
    }));
  const timeChanges = Object.entries(times).map(([id, availability]) => ({ id, availability }));
  const timeEditorDirty =
    timeEditor !== null &&
    timeEditor.intervals !== null &&
    timeEditor.dayIds.some((id) => !sameIntervals(days[id].intervals, timeEditor.intervals!));
  const dirty =
    dayChanges.length > 0 ||
    timeChanges.length > 0 ||
    name !== (baseline?.name ?? '') ||
    timeEditorDirty;
  const maybeDays = data.days.filter(
    (day) => (dragDays?.[day.id] ?? days[day.id]).status === 'maybe',
  );
  const commonIntervals = (dayIds: string[]) => {
    const first = days[dayIds[0]]?.intervals ?? [];
    return dayIds.every((id) => sameIntervals(days[id].intervals, first)) ? first : null;
  };
  const applyTimeEditor = () => {
    if (!timeEditor || timeEditor.intervals === null || timeEditor.dayIds.length === 0) return;
    const intervals = timeEditor.intervals;
    setDays((old) => {
      const next = { ...old };
      for (const id of timeEditor.dayIds) {
        if (next[id].status === 'maybe' && !sameIntervals(next[id].intervals, intervals))
          next[id] = { ...next[id], intervals, intervalsDirty: true };
      }
      return next;
    });
    setTimeEditor(null);
  };
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (!saved.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const click = (event: MouseEvent) => {
      if (
        saved.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.href === location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(url.href);
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = gesture.current;
      if (!active || event.pointerId !== active.pointerId) return;
      const target = document
        .elementFromPoint?.(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-day-status]');
      if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 6) active.moved = true;
      if (!target || !container.current?.contains(target)) return;
      const id = target.dataset.dayStatus;
      if (!id || !active.next[id]) return;
      if (id !== active.id) active.moved = true;
      if (!active.moved) return;
      active.dayIds.add(id);
      active.next = {
        ...active.next,
        [id]: { ...active.next[id], status: active.status, statusDirty: true },
      };
      setDays(active.next);
      event.preventDefault();
    };
    const finish = (cancelled: boolean, event?: PointerEvent) => {
      const active = gesture.current;
      if (!active || (event && event.pointerId !== active.pointerId)) return;
      let next = active.next;
      if (cancelled) next = active.original;
      else if (!active.moved && active.original[active.id].status === active.status)
        next = { ...next, [active.id]: { ...next[active.id], status: null, statusDirty: true } };
      setDays(next);
      if (!cancelled && active.moved && active.status === 'maybe' && active.dayIds.size > 1) {
        const dayIds = [...active.dayIds];
        const first = next[dayIds[0]].intervals;
        const intervals = dayIds.every((id) => sameIntervals(next[id].intervals, first))
          ? first
          : null;
        setTimeEditor({ dayIds, intervals, edited: false });
      }
      gesture.current = null;
      setDragDays(null);
    };
    const up = (event: PointerEvent) => finish(false, event),
      cancel = (event: PointerEvent) => finish(true, event),
      blur = () => finish(true);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const startGesture = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
    status: Exclude<Status, null>,
  ) => {
    if (event.button !== 0 || pending) return;
    event.preventDefault();
    event.currentTarget.focus();
    const next = { ...days, [id]: { ...days[id], status, statusDirty: true } };
    gesture.current = {
      pointerId: event.pointerId,
      id,
      status,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      dayIds: new Set([id]),
      original: days,
      next,
    };
    setDragDays(days);
    setDays(next);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const changeDay = (id: string, update: Partial<DraftDay>) =>
    setDays((old) => ({ ...old, [id]: { ...old[id], ...update } }));
  const timeValue = (id: string) =>
    Object.hasOwn(times, id)
      ? times[id]
      : (baseline?.times.find((t) => t.id === id)?.availability ?? null);
  const proposals = data.slots.filter(
    (slot) =>
      !baseline?.times.some((t) => t.id === slot.id) &&
      !Object.hasOwn(times, slot.id) &&
      days[slot.dayId]?.status === 'maybe' &&
      coversDayInterval(days[slot.dayId].intervals, slot.start, slot.end),
  );
  const dayCandidates =
    !scheduleDismissed && kind === 'days'
      ? (scheduleDraft?.days ?? []).filter((row) => {
          const current = days[row.id];
          return (
            current &&
            !current.statusDirty &&
            !current.intervalsDirty &&
            !current.commentDirty &&
            row.status !== null &&
            (current.status !== row.status || !sameIntervals(current.intervals, row.intervals))
          );
        })
      : [];
  const timeCandidates =
    !scheduleDismissed && kind === 'times'
      ? (scheduleDraft?.times ?? []).filter(
          (row) =>
            row.availability !== null &&
            !Object.hasOwn(times, row.id) &&
            timeValue(row.id) !== row.availability,
        )
      : [];
  const applySchedule = () => {
    setScheduleDismissed(true);
    if (dayCandidates.length) {
      setDays((old) => {
        const next = { ...old };
        for (const row of dayCandidates) {
          next[row.id] = {
            ...old[row.id],
            status: row.status,
            intervals: row.intervals,
            statusDirty: true,
            intervalsDirty: true,
          };
        }
        return next;
      });
    }
    if (timeCandidates.length) {
      setTimes((old) => ({
        ...Object.fromEntries(timeCandidates.map((row) => [row.id, row.availability])),
        ...old,
      }));
    }
  };
  const save = () =>
    startTransition(async () => {
      setError('');
      request.current ??= crypto.randomUUID();
      const target = baseline
        ? {
            participantId: baseline.id,
            revision: kind === 'days' ? baseline.dayRevision : baseline.timeRevision,
            ...(name.trim() !== baseline.name ? { name, expectedName: baseline.name } : {}),
          }
        : { requestId: request.current, name };
      try {
        const result = await saveDateFirst(
          kind === 'days'
            ? { operation: 'saveDays', token: data.event.token, ...target, changes: dayChanges }
            : { operation: 'saveTimes', token: data.event.token, ...target, changes: timeChanges },
        );
        if (!result.success) {
          setError(result.message);
          setConfirm(false);
          if (result.code === 'stale_revision' || result.code === 'stale_name') {
            if (baseline) setLatest(await getDateFirstAnswer(data.event.token, baseline.id));
          }
          return;
        }
        const value = z.object({ id: z.uuid() }).parse(result.value);
        saved.current = true;
        router.push(
          `/event/${data.event.token}/input/complete?participant_id=${value.id}&kind=${kind}`,
        );
      } catch {
        setError(
          '保存結果を確認できませんでした。入力を保持しています。同じ内容で再試行してください。',
        );
        setConfirm(false);
      }
    });
  return (
    <div className="space-y-6" data-testid="date-first-answer">
      <header className="space-y-2">
        <h2 className="page-title">{kind === 'days' ? '日付を回答' : '時間を回答'}</h2>
        {baseline && <p className="break-words">「{baseline.name}」さんの回答を編集</p>}
      </header>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setConfirm(true);
        }}
        className="space-y-6"
      >
        <fieldset disabled={!ready || pending} className="space-y-5">
          <label className="block space-y-2">
            <span>お名前</span>
            <input
              data-testid="date-first-answer-name"
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          {kind === 'days' ? (
            <div ref={container} className="max-w-xl space-y-4">
              {data.days.map((day) => {
                const draft = days[day.id];
                const displayStatus = (dragDays?.[day.id] ?? draft).status;
                return (
                  <section
                    key={day.id}
                    className="space-y-2"
                    data-answer-day={day.id}
                    data-testid={`day-answer-${day.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm font-medium sm:w-36 sm:flex-none">
                        {candidateDayLabel(day.date)}
                      </span>
                      <div className="flex gap-1">
                        {(['yes', 'maybe', 'no'] as const).map((status) => {
                          const Icon =
                            status === 'yes' ? Circle : status === 'maybe' ? Triangle : X;
                          return (
                            <button
                              key={status}
                              type="button"
                              data-day-status={day.id}
                              data-testid={`day-${day.id}-${status}`}
                              className={`btn min-h-11 w-10 shrink-0 touch-none px-0 sm:w-11 ${draft.status === status ? 'btn-primary' : 'btn-ghost'}`}
                              aria-label={`${candidateDayLabel(day.date)} ${symbol(status)}`}
                              aria-pressed={draft.status === status}
                              onPointerDown={(e) => startGesture(e, day.id, status)}
                              onClick={(e) => {
                                if (e.detail !== 0) return;
                                const next = draft.status === status ? null : status;
                                changeDay(day.id, { status: next, statusDirty: true });
                              }}
                            >
                              <Icon size={20} aria-hidden="true" />
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost min-h-11 w-10 shrink-0 px-0 sm:w-11"
                        aria-label={`${candidateDayLabel(day.date)}のコメント${draft.comment ? '（入力済み）' : ''}`}
                        aria-expanded={comments.has(day.id)}
                        disabled={displayStatus === null}
                        onClick={() => {
                          if (dragging || draft.status === null) return;
                          if (!comments.has(day.id)) commentFocus.current = day.id;
                          setComments((old) => {
                            const next = new Set(old);
                            if (next.has(day.id)) next.delete(day.id);
                            else next.add(day.id);
                            return next;
                          });
                        }}
                      >
                        <span className="relative inline-flex" aria-hidden="true">
                          <MessageSquare size={20} />
                          {draft.comment && (
                            <span className="bg-primary absolute -right-0.5 -top-0.5 size-1.5 rounded-full" />
                          )}
                        </span>
                      </button>
                    </div>
                    {displayStatus === 'maybe' && (
                      <DateFirstTimeGrid
                        id={day.id}
                        value={draft.intervals}
                        baseRanges={data.event.baseRanges}
                        readOnly={dragging}
                        onChange={(intervals) =>
                          changeDay(day.id, { intervals, intervalsDirty: true })
                        }
                      />
                    )}
                    {comments.has(day.id) && displayStatus !== null && (
                      <label className="block max-w-sm">
                        <span className="sr-only">{candidateDayLabel(day.date)}のコメント</span>
                        <textarea
                          ref={(element) => {
                            if (element && commentFocus.current === day.id) {
                              element.focus();
                              commentFocus.current = null;
                            }
                          }}
                          className="textarea h-11 w-full resize-none overflow-y-auto"
                          placeholder="例：19時以降なら参加可"
                          readOnly={dragging}
                          value={draft.comment}
                          onChange={(e) =>
                            changeDay(day.id, { comment: e.target.value, commentDirty: true })
                          }
                          rows={1}
                        />
                      </label>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block space-y-2">
                <span>回答する日付</span>
                <select
                  className="select w-full"
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value)}
                >
                  {data.days
                    .filter((d) => d.target)
                    .map((day) => (
                      <option key={day.id} value={day.id}>
                        {candidateDayLabel(day.date)}
                      </option>
                    ))}
                </select>
              </label>
              {selectedDay && (
                <p className="text-sm">
                  日付回答：{symbol(days[selectedDay]?.status ?? null)}
                  {days[selectedDay]?.status === 'maybe' && days[selectedDay].intervals.length > 0
                    ? `（${dayIntervalText(days[selectedDay].intervals)}）`
                    : ''}
                </p>
              )}
              {proposals.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowProposals(true)}
                >
                  △の時間から提案を確認
                </button>
              )}
              {data.slots
                .filter((s) => s.dayId === selectedDay)
                .map((slot) => (
                  <div key={slot.id} className="flex items-center justify-between gap-3">
                    <span className="tabular-nums">
                      {formatDayMinute(slot.start)}〜{formatDayMinute(slot.end)}
                    </span>
                    <div className="flex gap-2">
                      {[true, false].map((value) => (
                        <button
                          key={String(value)}
                          type="button"
                          data-testid={`time-${slot.id}-${value}`}
                          className={`btn min-h-11 w-11 shrink-0 px-0 ${timeValue(slot.id) === value ? 'btn-primary' : 'btn-ghost'}`}
                          aria-label={`${formatDayMinute(slot.start)}〜${formatDayMinute(slot.end)} ${value ? '○' : '×'}`}
                          aria-pressed={timeValue(slot.id) === value}
                          onClick={() =>
                            setTimes((old) => ({
                              ...old,
                              [slot.id]: timeValue(slot.id) === value ? null : value,
                            }))
                          }
                        >
                          {value ? (
                            <Circle size={20} aria-hidden="true" />
                          ) : (
                            <X size={20} aria-hidden="true" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              {data.slots.length === 0 && (
                <p>時間候補はまだありません。イベント画面で候補を設定してください。</p>
              )}
            </div>
          )}
          <TermsCheckbox isChecked={accepted} onChange={setAccepted} />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={dragging}
              onClick={() =>
                dirty
                  ? setLeaving(`/event/${data.event.token}`)
                  : router.push(`/event/${data.event.token}`)
              }
            >
              戻る
            </button>
            <button
              type="submit"
              data-testid="date-first-answer-review"
              className="btn btn-primary"
              disabled={
                !accepted ||
                dragging ||
                !name.trim() ||
                (kind === 'times' && data.slots.length === 0)
              }
            >
              {pending ? '保存中…' : '回答を確認'}
            </button>
          </div>
        </fieldset>
      </form>
      <ConfirmationModal
        isOpen={ready && dayCandidates.length + timeCandidates.length > 0}
        title="予定を取り込みますか？"
        description="候補期間に登録済みの予定があります。取り込んだ内容は保存前に確認・修正できます。"
        confirmLabel="取り込む"
        cancelLabel="取り込まずに続ける"
        onConfirm={applySchedule}
        onCancel={() => setScheduleDismissed(true)}
      />
      <ConfirmationModal
        isOpen={timeEditor !== null}
        title="△の日の参加可能時間"
        description="同じ時間を設定する日付を選んでください。"
        widthClassName="max-w-3xl motion-safe:duration-150 motion-reduce:transition-none"
        onCancel={() => setTimeEditor(null)}
        confirmAction={
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              !timeEditor || timeEditor.dayIds.length === 0 || timeEditor.intervals === null
            }
            onClick={applyTimeEditor}
          >
            選択した日へ設定
          </button>
        }
      >
        {timeEditor && (
          <div className="space-y-4" data-testid="date-first-maybe-times">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">対象の日付</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={timeEditor.dayIds.length === maybeDays.length}
                  onChange={(event) => {
                    const dayIds = event.target.checked ? maybeDays.map((day) => day.id) : [];
                    setTimeEditor({
                      ...timeEditor,
                      dayIds,
                      intervals: timeEditor.edited ? timeEditor.intervals : commonIntervals(dayIds),
                    });
                  }}
                />
                △の全日付
              </label>
              <div className="max-h-40 space-y-2 overflow-y-auto">
                {maybeDays.map((day) => (
                  <label key={day.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={timeEditor.dayIds.includes(day.id)}
                      onChange={(event) => {
                        const dayIds = event.target.checked
                          ? [...timeEditor.dayIds, day.id]
                          : timeEditor.dayIds.filter((id) => id !== day.id);
                        setTimeEditor({
                          ...timeEditor,
                          dayIds,
                          intervals: timeEditor.edited
                            ? timeEditor.intervals
                            : commonIntervals(dayIds),
                        });
                      }}
                    />
                    <span>
                      {candidateDayLabel(day.date)}
                      {days[day.id].intervals.length > 0 && (
                        <span className="text-base-content/65 ml-2">
                          {dayIntervalText(days[day.id].intervals)}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {timeEditor.intervals === null && (
              <p className="text-sm">日付ごとに時間が異なります。設定する時間を選んでください。</p>
            )}
            <DateFirstTimeGrid
              key={timeEditor.dayIds.join(',')}
              id="maybe-time-editor"
              value={timeEditor.intervals ?? []}
              baseRanges={data.event.baseRanges}
              disabled={timeEditor.dayIds.length === 0}
              onChange={(intervals) =>
                setTimeEditor((old) => old && { ...old, intervals, edited: true })
              }
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={timeEditor.dayIds.length === 0}
              onClick={() => setTimeEditor({ ...timeEditor, intervals: [], edited: true })}
            >
              時間を指定しない
            </button>
          </div>
        )}
      </ConfirmationModal>
      <ConfirmationModal
        isOpen={confirm}
        title="回答を保存する"
        confirmLabel="この内容で保存"
        cancelLabel="入力に戻る"
        widthClassName="max-w-xl"
        isConfirming={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={save}
      >
        <div className="space-y-4">
          <p className="break-words font-medium">{name.trim()}さん</p>
          <div className="max-h-[50dvh] space-y-4 overflow-y-auto pr-1">
            {kind === 'days' ? (
              dayChanges.length === 0 ? (
                <p>{baseline ? '日付の回答は変更しません。' : '日付はすべて未回答です。'}</p>
              ) : (
                <ul className="space-y-4">
                  {dayChanges.map((change) => {
                    const day = data.days.find((d) => d.id === change.id)!;
                    const draft = days[change.id];
                    const previous = baseline?.days.find((d) => d.id === change.id);
                    const Icon =
                      draft.status === 'yes' ? Circle : draft.status === 'maybe' ? Triangle : X;
                    const removed: string[] = [];
                    if (
                      previous?.comment &&
                      (draft.status === null || (draft.commentDirty && !draft.comment))
                    )
                      removed.push('コメント');
                    if (
                      previous?.intervals.length &&
                      (draft.status !== 'maybe' ||
                        (draft.intervalsDirty && draft.intervals.length === 0))
                    )
                      removed.push('時間指定');
                    return (
                      <li key={change.id} className="space-y-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <p className="font-medium">{candidateDayLabel(day.date)}</p>
                          <span
                            className="inline-flex min-h-6 items-center text-sm"
                            role="img"
                            aria-label={symbol(draft.status)}
                          >
                            {draft.status === null ? (
                              '未回答'
                            ) : (
                              <Icon size={18} aria-hidden="true" />
                            )}
                          </span>
                        </div>
                        {draft.status === 'maybe' && draft.intervals.length > 0 && (
                          <p className="text-sm tabular-nums">{dayIntervalText(draft.intervals)}</p>
                        )}
                        {draft.status !== null && draft.comment && (
                          <p className="text-base-content/75 whitespace-pre-wrap break-words text-sm">
                            {draft.comment}
                          </p>
                        )}
                        {removed.length > 0 && (
                          <p className="text-base-content/65 text-sm">{removed.join('・')}を削除</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )
            ) : timeChanges.length === 0 ? (
              <p>時間の回答は変更しません。</p>
            ) : (
              data.days.map((day) => {
                const slots = data.slots.filter(
                  (slot) => slot.dayId === day.id && Object.hasOwn(times, slot.id),
                );
                if (slots.length === 0) return null;
                return (
                  <section key={day.id} className="space-y-2">
                    <h4 className="font-medium">{candidateDayLabel(day.date)}</h4>
                    <ul className="space-y-1">
                      {slots.map((slot) => (
                        <li key={slot.id} className="flex items-center gap-3 text-sm">
                          <span className="min-w-36 tabular-nums">
                            {formatDayMinute(slot.start)}〜{formatDayMinute(slot.end)}
                          </span>
                          <span
                            className="inline-flex min-h-6 items-center"
                            role="img"
                            aria-label={
                              times[slot.id] === null ? '未回答' : times[slot.id] ? '○' : '×'
                            }
                          >
                            {times[slot.id] === null ? (
                              '未回答'
                            ) : times[slot.id] ? (
                              <Circle size={18} aria-hidden="true" />
                            ) : (
                              <X size={18} aria-hidden="true" />
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        </div>
      </ConfirmationModal>
      <ConfirmationModal
        isOpen={latest !== null}
        title="他の変更が保存されています"
        confirmLabel="最新内容を踏まえて編集を続ける"
        onCancel={() => setLatest(null)}
        onConfirm={() => {
          if (!latest) return;
          if (name === baseline?.name) setName(latest.name);
          setDays((old) =>
            Object.fromEntries(
              Object.entries(old).map(([id, draft]) => {
                const current = latest.days.find((d) => d.id === id);
                return [
                  id,
                  {
                    ...draft,
                    status: draft.statusDirty ? draft.status : (current?.status ?? null),
                    comment: draft.commentDirty ? draft.comment : (current?.comment ?? ''),
                    intervals: draft.intervalsDirty ? draft.intervals : (current?.intervals ?? []),
                  },
                ];
              }),
            ),
          );
          setBaseline(latest);
          setLatest(null);
          setError('入力は保持しています。差分を確認して、もう一度保存してください。');
        }}
      >
        {latest && (
          <div className="mt-4 space-y-3">
            <p>保存済みの名前：{latest.name}</p>
            <p>以下の最新回答を確認してください。入力中の変更は保持します。</p>
            {kind === 'days'
              ? dayChanges.map((change) => {
                  const current = latest.days.find((d) => d.id === change.id);
                  return (
                    <div key={change.id}>
                      <p>
                        {candidateDayLabel(data.days.find((d) => d.id === change.id)!.date)}
                        ：保存済み {symbol(current?.status ?? null)} → 入力中{' '}
                        {symbol(days[change.id].status)}
                      </p>
                      {current?.comment && (
                        <p className="whitespace-pre-wrap break-words">
                          保存済みコメント：{current.comment}
                        </p>
                      )}
                      {current?.intervals.length ? (
                        <p>{dayIntervalText(current.intervals)}</p>
                      ) : null}
                    </div>
                  );
                })
              : timeChanges.map((change) => {
                  const value = latest.times.find((t) => t.id === change.id)?.availability ?? null;
                  const slot = data.slots.find((s) => s.id === change.id)!;
                  return (
                    <p key={change.id}>
                      {formatDayMinute(slot.start)}〜{formatDayMinute(slot.end)}：保存済み{' '}
                      {value === null ? '未回答' : value ? '○' : '×'} → 入力中{' '}
                      {change.availability === null ? '未回答' : change.availability ? '○' : '×'}
                    </p>
                  );
                })}
          </div>
        )}
      </ConfirmationModal>
      <ConfirmationModal
        isOpen={showProposals}
        title="△の時間からの提案"
        description="参加可能な時間内に全体が収まる候補だけを○にします。保存済み回答は変更しません。"
        confirmLabel="提案を入力に採用"
        onCancel={() => setShowProposals(false)}
        onConfirm={() => {
          setTimes((old) => ({
            ...old,
            ...Object.fromEntries(proposals.map((slot) => [slot.id, true])),
          }));
          setShowProposals(false);
        }}
      >
        <ul className="mt-4 space-y-2">
          {proposals.map((slot) => (
            <li key={slot.id}>
              {candidateDayLabel(data.days.find((d) => d.id === slot.dayId)!.date)}{' '}
              {formatDayMinute(slot.start)}〜{formatDayMinute(slot.end)} ○
            </li>
          ))}
        </ul>
      </ConfirmationModal>
      <ConfirmationModal
        isOpen={leaving !== null}
        title="入力を破棄して移動しますか？"
        description="まだ保存していない変更があります。"
        confirmLabel="破棄して移動"
        onCancel={() => setLeaving(null)}
        onConfirm={() => {
          if (leaving) {
            saved.current = true;
            window.location.assign(leaving);
          }
        }}
      />
    </div>
  );
}
