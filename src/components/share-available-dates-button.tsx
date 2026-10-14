'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import { Share2 } from 'lucide-react';
import ShareEventButton from './share-event-button';
import ConfirmationModal from './common/confirmation-modal';
import { buildAvailableDatesMessage, findAvailableDateRanges } from '@/lib/share-utils';
import siteConfig from '@/lib/site-config';
import type { EventDate, Participant, Availability } from './event-client/event-details-section';

interface Props {
  eventTitle: string;
  publicToken: string;
  eventDates: EventDate[];
  participants: Participant[];
  availabilities: Availability[];
}

export default function ShareAvailableDatesButton({
  eventTitle,
  publicToken,
  eventDates,
  participants,
  availabilities,
}: Props) {
  const id = useId();
  const [minCountInput, setMinCountInput] = useState(String(participants.length));
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [requiredIds, setRequiredIds] = useState<string[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const minCount = Number(minCountInput);
  const validCount = Number.isInteger(minCount) && minCount >= 1 && minCount <= participants.length;
  const requiredParticipants = participants.filter(({ id }) => requiredIds.includes(id));
  const result = useMemo(() => {
    const options = {
      durationMinutes,
      requiredParticipantIds: participants
        .filter(({ id }) => requiredIds.includes(id))
        .map(({ id }) => id),
    };
    return {
      message: buildAvailableDatesMessage(eventDates, availabilities, minCount, options),
      hasCandidates:
        findAvailableDateRanges(eventDates, availabilities, minCount, options).length > 0,
    };
  }, [eventDates, availabilities, minCount, durationMinutes, participants, requiredIds]);
  const requiredLabel = requiredParticipants.length
    ? `\n必須参加者: ${requiredParticipants.map(({ name }) => name).join('、')}`
    : '';
  const shareText = `${eventTitle}${requiredLabel}\n${result.message}`;
  const countError = (
    <p id={`${id}-error`} role="alert" className="text-error text-sm">
      参加人数は1〜{participants.length}の整数で指定してください。
    </p>
  );

  useEffect(() => {
    setShareUrl(`${window.location.origin}/event/${publicToken}`);
  }, [publicToken]);

  return (
    <div data-testid="available-dates-share">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`${id}-count`}
          type="number"
          min={1}
          max={participants.length}
          step={1}
          value={minCountInput}
          className="input input-sm input-bordered min-h-10 w-14"
          aria-label="最低参加人数"
          data-testid="share-min-count"
          aria-invalid={!validCount}
          aria-describedby={!validCount ? `${id}-error` : undefined}
          onChange={(event) => setMinCountInput(event.target.value)}
        />
        <label htmlFor={`${id}-count`} className="text-base-content/60 text-sm">
          人以上の予定を共有
        </label>
        <button
          type="button"
          className="btn btn-outline btn-sm min-h-10 gap-2"
          data-testid="share-preview-open"
          disabled={!validCount || !shareUrl}
          aria-haspopup="dialog"
          onClick={() => setIsPreviewOpen(true)}
        >
          <Share2 aria-hidden="true" className="h-4 w-4" />
          共通日程を共有
        </button>
      </div>
      {!validCount && !isPreviewOpen && <div className="mt-2">{countError}</div>}
      <ConfirmationModal
        isOpen={isPreviewOpen}
        title="共有内容を確認"
        cancelLabel="閉じる"
        onCancel={() => setIsPreviewOpen(false)}
        confirmAction={
          <ShareEventButton
            url={shareUrl}
            title={`${eventTitle}｜${siteConfig.share.availableDatesTitle}`}
            text={shareText}
            label="共有する"
            ariaLabel="共有する"
            className="min-h-11"
            variant="primary"
            includeTextInClipboard
            contentType="available_dates"
            disabled={!validCount || !result.hasCandidates || !shareUrl}
          />
        }
      >
        <div className="space-y-4" data-testid="share-preview">
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm">条件を絞る</summary>
            <div className="space-y-3 pb-3">
              <div className="flex flex-wrap gap-3">
                <div>
                  <label htmlFor={`${id}-modal-count`} className="mb-1 block text-sm">
                    参加人数
                  </label>
                  <input
                    id={`${id}-modal-count`}
                    type="number"
                    min={1}
                    max={participants.length}
                    step={1}
                    value={minCountInput}
                    className="input input-bordered min-h-11 w-20"
                    data-testid="share-modal-count"
                    aria-invalid={!validCount}
                    aria-describedby={!validCount ? `${id}-error` : undefined}
                    onChange={(event) => setMinCountInput(event.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-duration`} className="mb-1 block text-sm">
                    連続時間
                  </label>
                  <select
                    id={`${id}-duration`}
                    className="select select-bordered min-h-11"
                    value={durationMinutes}
                    data-testid="share-duration"
                    onChange={(event) => setDurationMinutes(Number(event.target.value))}
                  >
                    <option value={0}>指定なし</option>
                    {[30, 60, 90, 120, 180, 240].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes}分以上
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <fieldset className="flex flex-wrap gap-x-4">
                <legend className="text-sm">必須参加者（任意）</legend>
                {participants.map(({ id: participantId, name }) => (
                  <label
                    key={participantId}
                    className="flex min-h-11 cursor-pointer items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={requiredIds.includes(participantId)}
                      data-testid={`share-required-${participantId}`}
                      onChange={(event) =>
                        setRequiredIds((previous) =>
                          event.target.checked
                            ? [...previous, participantId]
                            : previous.filter((value) => value !== participantId),
                        )
                      }
                    />
                    <span className="text-sm">{name}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          </details>
          {!validCount ? (
            countError
          ) : (
            <>
              <div
                role="document"
                aria-label="共有する本文"
                tabIndex={0}
                className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed"
                data-testid="share-preview-text"
              >{`${shareText}\n${shareUrl}`}</div>
              {!result.hasCandidates && (
                <p role="status" className="text-sm">
                  条件に合う日程がありません。条件を変更してください。
                </p>
              )}
            </>
          )}
        </div>
      </ConfirmationModal>
    </div>
  );
}
