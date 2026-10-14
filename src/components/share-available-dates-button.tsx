'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import ShareEventButton from './share-event-button';
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
  const requiredParticipants = participants.filter((participant) =>
    requiredIds.includes(participant.id),
  );
  const requiredParticipantIds = requiredParticipants.map(({ id }) => id);
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
  const shareText = `${eventTitle}\n${siteConfig.share.availableDatesIntro}${requiredLabel}\n${result.message}`;

  useEffect(() => {
    setShareUrl(`${window.location.origin}/event/${publicToken}`);
  }, [publicToken]);

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-4"
      data-testid="available-dates-share"
    >
      <h3 id={`${id}-heading`} className="text-base font-medium">
        共通日程を共有
      </h3>
      <div className="flex flex-wrap gap-4">
        <div>
          <label htmlFor={`${id}-count`} className="mb-1 block text-sm">
            最低参加人数
          </label>
          <input
            id={`${id}-count`}
            type="number"
            min={1}
            max={participants.length}
            step={1}
            value={minCountInput}
            className="input input-bordered min-h-11 w-28"
            data-testid="share-min-count"
            aria-invalid={!validCount}
            aria-describedby={!validCount ? `${id}-error` : undefined}
            onChange={(event) => setMinCountInput(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-duration`} className="mb-1 block text-sm">
            必要な連続時間
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
      {!validCount && (
        <p id={`${id}-error`} role="alert" className="text-error text-sm">
          参加人数は1〜{participants.length}の整数で指定してください。
        </p>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm">
          必須参加者（任意）
          {requiredParticipantIds.length > 0 ? `: ${requiredParticipantIds.length}人` : ''}
        </summary>
        <fieldset className="flex flex-wrap gap-x-4">
          <legend className="sr-only">全時間に参加が必要な人</legend>
          {participants.map(({ id: participantId, name }) => (
            <label key={participantId} className="flex min-h-11 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={requiredParticipantIds.includes(participantId)}
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
      </details>
      <button
        type="button"
        className="btn btn-outline min-h-11"
        data-testid="share-preview-open"
        disabled={!isPreviewOpen && (!validCount || !shareUrl)}
        aria-expanded={isPreviewOpen}
        aria-controls={`${id}-preview-region`}
        onClick={() => setIsPreviewOpen((previous) => !previous)}
      >
        {isPreviewOpen ? 'プレビューを閉じる' : '共有内容を確認'}
      </button>
      {isPreviewOpen && (
        <div id={`${id}-preview-region`} className="space-y-3" data-testid="share-preview">
          {validCount ? (
            <>
              <label htmlFor={`${id}-preview`} className="block text-sm font-medium">
                共有する本文
              </label>
              <textarea
                id={`${id}-preview`}
                className="textarea textarea-bordered min-h-44 w-full"
                readOnly
                value={`${shareText}\n${shareUrl}`}
                data-testid="share-preview-text"
              />
              {!result.hasCandidates && (
                <p role="status" className="text-sm">
                  条件に合う日程がありません。条件を変更してください。
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <ShareEventButton
                  url={shareUrl}
                  title={`${eventTitle}｜${siteConfig.share.availableDatesTitle}`}
                  text={shareText}
                  label="共有する"
                  ariaLabel="共通日程を共有"
                  className="min-h-11"
                  includeTextInClipboard
                  contentType="available_dates"
                  disabled={!result.hasCandidates || !shareUrl}
                />
                <ShareEventButton
                  url={shareUrl}
                  text={shareText}
                  label="本文をコピー"
                  ariaLabel="共通日程の本文をコピー"
                  className="min-h-11"
                  includeTextInClipboard
                  contentType="available_dates"
                  preferClipboard
                  disabled={!result.hasCandidates || !shareUrl}
                />
              </div>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
