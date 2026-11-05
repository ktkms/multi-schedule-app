'use client';

import { useState, useTransition } from 'react';
import { getDateFirstAnswer, saveDateFirst } from '@/lib/date-first-actions';
import {
  dateFirstSyncPreviewSchema,
  type DateFirstAnswer,
  type DateFirstEvent,
  type DateFirstSyncPreview,
  formatDayMinute,
} from '@/lib/date-first-schema';
import { candidateDayLabel, dayIntervalText } from '@/lib/date-first-ui';
import { getDateFirstSyncChanges } from '@/lib/date-first-sync-diff';
import ConfirmationModal from '@/components/common/confirmation-modal';

const mark = (status: string | boolean | null | undefined) =>
  status === 'yes' || status === true
    ? '○'
    : status === 'maybe'
      ? '△'
      : status === 'no' || status === false
        ? '×'
        : '未回答';

/** 本人の紐付けを明示確認し、予定からの反映を公開共同編集とは別の認証境界で行う。 */
export default function DateFirstAccount({
  data,
  myParticipantId,
}: {
  data: DateFirstEvent;
  myParticipantId: string | null;
}) {
  const [preview, setPreview] = useState<DateFirstSyncPreview | null>(null),
    [answer, setAnswer] = useState<DateFirstAnswer | null>(null),
    [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const { days: dayChanges, times: timeChanges } = getDateFirstSyncChanges(answer, preview);
  return (
    <section className="space-y-4" aria-label="アカウント予定の反映">
      {error && (
        <p className="text-error" role="alert">
          {error}
        </p>
      )}
      {myParticipantId && (
        <p className="break-words text-sm">
          自分の回答：{data.participants.find((p) => p.id === myParticipantId)?.name}
        </p>
      )}
      {myParticipantId && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError('');
              try {
                const [result, current] = await Promise.all([
                  saveDateFirst({ operation: 'previewSync', token: data.event.token }),
                  getDateFirstAnswer(data.event.token, myParticipantId),
                ]);
                if (!result.success) {
                  setError(result.message);
                  return;
                }
                setAnswer(current);
                setPreview(dateFirstSyncPreviewSchema.parse(result.value));
              } catch {
                setError('予定との差分を取得できませんでした。もう一度お試しください。');
              }
            })
          }
        >
          変更内容を確認して反映
        </button>
      )}
      <ConfirmationModal
        isOpen={preview !== null}
        title="予定から回答へ反映"
        confirmLabel={dayChanges.length + timeChanges.length > 0 ? 'この差分を反映' : '変更なし'}
        isConfirming={pending}
        onCancel={() => setPreview(null)}
        onConfirm={() => {
          if (!preview) return;
          if (dayChanges.length + timeChanges.length === 0) {
            setPreview(null);
            return;
          }
          startTransition(async () => {
            try {
              const result = await saveDateFirst({
                operation: 'applySync',
                token: data.event.token,
                fingerprint: preview.fingerprint,
                acknowledgedIds: preview.cleared_comments,
              });
              if (!result.success) {
                setError(result.message);
                setPreview(null);
                return;
              }
              window.location.reload();
            } catch {
              setError('結果を確認できませんでした。保存結果を再読み込みして確認してください。');
              setPreview(null);
            }
          });
        }}
      >
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            手動で変更した回答・時間や、手動で未回答に戻した状態は保持します。
          </p>
          {data.days.some((day) => day.confirmed) && (
            <p className="text-sm">
              確定済みの日付があります。確定内容を維持して回答だけを更新します。
            </p>
          )}
          {dayChanges.map((change) => (
            <div key={change.id}>
              <p>
                {candidateDayLabel(data.days.find((d) => d.id === change.id)!.date)}：
                {mark(answer?.days.find((d) => d.id === change.id)?.status)} → {mark(change.status)}
              </p>
              {change.intervals.length > 0 && (
                <p className="text-sm">{dayIntervalText(change.intervals)}</p>
              )}
            </div>
          ))}
          {timeChanges.map((change) => {
            const slot = data.slots.find((s) => s.id === change.id);
            return slot ? (
              <p key={change.id}>
                {candidateDayLabel(data.days.find((d) => d.id === slot.dayId)!.date)}{' '}
                {formatDayMinute(slot.start)}〜{formatDayMinute(slot.end)}：
                {mark(answer?.times.find((t) => t.id === change.id)?.availability)} →{' '}
                {mark(change.availability)}
              </p>
            ) : null;
          })}
          {preview?.cleared_comments.map((id) => (
            <div key={id} className="text-warning">
              <p>
                {candidateDayLabel(data.days.find((d) => d.id === id)!.date)}
                は未回答になり、以下のコメントが削除されます。
              </p>
              <p className="whitespace-pre-wrap break-words">
                {answer?.days.find((d) => d.id === id)?.comment}
              </p>
            </div>
          ))}
          {dayChanges.length + timeChanges.length === 0 && <p>反映する変更はありません。</p>}
        </div>
      </ConfirmationModal>
    </section>
  );
}
