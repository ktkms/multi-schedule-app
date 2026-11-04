'use client';

import { useState, useTransition } from 'react';
import { getDateFirstAnswer, saveDateFirst } from '@/lib/date-first-actions';
import {
  dateFirstAnswerSchedulePlanSchema,
  type DateFirstAnswer,
  type DateFirstAnswerSchedulePlan,
  type DateFirstEvent,
  formatDayMinute,
} from '@/lib/date-first-schema';
import { candidateDayLabel } from '@/lib/date-first-ui';
import ConfirmationModal from '@/components/common/confirmation-modal';

/** 本人の保存済み時間回答だけを、対象選択と差分確認の後に予定へ保存する。 */
export default function DateFirstAnswerSchedule({
  data,
  participantId,
}: {
  data: DateFirstEvent;
  participantId: string;
}) {
  const [answer, setAnswer] = useState<DateFirstAnswer | null>(null),
    [selection, setSelection] = useState<string[]>([]),
    [selecting, setSelecting] = useState(false);
  const [plan, setPlan] = useState<DateFirstAnswerSchedulePlan | null>(null),
    [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const describe = (value: { start_time: string; end_time: string; availability: boolean }) =>
    `${candidateDayLabel(value.start_time.slice(0, 10))} ${value.start_time.slice(11, 16)}〜${value.start_time.slice(0, 10) !== value.end_time.slice(0, 10) ? candidateDayLabel(value.end_time.slice(0, 10)) + ' ' : ''}${value.end_time.slice(11, 16)}：${value.availability ? '○' : '×'}`;
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError('');
            try {
              const current = await getDateFirstAnswer(data.event.token, participantId);
              setAnswer(current);
              setSelection(
                current?.times.filter((t) => t.availability !== null).map((t) => t.id) ?? [],
              );
              setSelecting(true);
            } catch {
              setError('保存済み回答を取得できませんでした。');
            }
          })
        }
      >
        時間の回答を自分の予定へ保存
      </button>
      <ConfirmationModal
        isOpen={selecting}
        title="予定へ保存する時間回答"
        confirmLabel="予定との差分を確認"
        isConfirming={pending}
        onCancel={() => setSelecting(false)}
        onConfirm={() => {
          if (selection.length === 0) {
            setError('保存する○・×の時間回答を選んでください。');
            setSelecting(false);
            return;
          }
          startTransition(async () => {
            try {
              const result = await saveDateFirst({
                operation: 'previewAnswerSchedule',
                token: data.event.token,
                slotIds: selection,
              });
              if (!result.success) {
                setError(result.message);
                setSelecting(false);
                return;
              }
              setPlan(dateFirstAnswerSchedulePlanSchema.parse(result.value));
              setSelecting(false);
            } catch {
              setError('予定との差分を取得できませんでした。');
              setSelecting(false);
            }
          });
        }}
      >
        <div className="mt-4 space-y-3">
          <p className="text-sm">日付記号と未回答は保存しません。</p>
          {answer?.times
            .filter((t) => t.availability !== null)
            .map((row) => {
              const slot = data.slots.find((s) => s.id === row.id);
              if (!slot) return null;
              return (
                <label className="flex items-center gap-3" key={row.id}>
                  <input
                    className="checkbox checkbox-sm"
                    type="checkbox"
                    checked={selection.includes(row.id)}
                    onChange={(e) =>
                      setSelection((old) =>
                        e.target.checked ? [...old, row.id] : old.filter((id) => id !== row.id),
                      )
                    }
                  />
                  {candidateDayLabel(data.days.find((d) => d.id === slot.dayId)!.date)}{' '}
                  {formatDayMinute(slot.start)}〜{formatDayMinute(slot.end)}：
                  {row.availability ? '○' : '×'}
                </label>
              );
            })}
          {!answer?.times.some((t) => t.availability !== null) && (
            <p>保存できる時間回答はありません。</p>
          )}
        </div>
      </ConfirmationModal>
      <ConfirmationModal
        isOpen={plan !== null}
        title="回答を予定へ保存"
        confirmLabel="この内容で予定を更新"
        isConfirming={pending}
        onCancel={() => setPlan(null)}
        onConfirm={() => {
          if (!plan) return;
          startTransition(async () => {
            try {
              const result = await saveDateFirst({
                operation: 'applyAnswerSchedule',
                token: data.event.token,
                slotIds: selection,
                fingerprint: plan.expected_revision,
              });
              if (!result.success) {
                setError(result.message);
                setPlan(null);
                return;
              }
              window.location.reload();
            } catch {
              setError('保存結果を取得できませんでした。再読み込みして確認してください。');
              setPlan(null);
            }
          });
        }}
      >
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            重なる登録済み予定を更新し、選択外の時間は保持します。他イベントの回答は更新しません。
          </p>
          {plan && plan.overwritten.length > 0 && (
            <div>
              <p className="font-medium">更新前の予定</p>
              <ul className="mt-2 space-y-2">
                {plan.overwritten.map((row) => (
                  <li key={row.id}>{describe(row)}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="font-medium">保存する回答</p>
            <ul className="mt-2 space-y-2">
              {plan?.changes.map((row, i) => (
                <li key={i}>{describe(row)}</li>
              ))}
            </ul>
          </div>
          {plan?.unanswered_ids.length ? (
            <p>未回答{plan.unanswered_ids.length}件は保存しません。</p>
          ) : null}
        </div>
      </ConfirmationModal>
    </div>
  );
}
