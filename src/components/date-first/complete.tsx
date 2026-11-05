'use client';

import Link from 'next/link';
import { useState } from 'react';
import EventAnswerLinkEditor from '@/components/event-client/event-answer-link-editor';
import type { DateFirstEvent } from '@/lib/date-first-schema';
import DateFirstAnswerSchedule from './answer-schedule';

/** 回答の保存完了と、任意の予定保存・他イベントへの反映を分ける。 */
export default function DateFirstComplete({
  data,
  participantId,
  linkedParticipantId,
  signedIn,
  kind,
}: {
  data: DateFirstEvent;
  participantId: string;
  linkedParticipantId: string | null;
  signedIn: boolean;
  kind: 'days' | 'times';
}) {
  const root = `/event/${data.event.token}`;
  const [linkedId, setLinkedId] = useState(linkedParticipantId);
  return (
    <div className="app-page-narrow max-w-2xl space-y-6 py-8" data-testid="answer-complete-page">
      <header className="space-y-2">
        <h1 className="page-title">回答が完了しました</h1>
        <p className="text-sm">
          {data.participants.find((p) => p.id === participantId)?.name}さんの
          {kind === 'days' ? '日付' : '時間'}の回答を保存しました。
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <Link className="btn btn-primary" href={`${root}?saved_participant=${participantId}`}>
          イベント結果を見る
        </Link>
        {kind === 'days' && data.slots.length > 0 && (
          <Link
            className="btn btn-outline"
            href={`${root}/input?participant_id=${participantId}&kind=times`}
          >
            続けて時間を回答する
          </Link>
        )}
      </div>
      {signedIn && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-heading">予定の保存・反映</h2>
          <EventAnswerLinkEditor
            eventId={data.event.id}
            eventPublicToken={data.event.token}
            participants={data.participants}
            linkedParticipantId={linkedId}
            onLinkedParticipantIdChange={setLinkedId}
          />
        </div>
      )}
      {signedIn && linkedId === participantId ? (
        <section className="space-y-3" aria-label="回答後の予定管理">
          {kind === 'times' && (
            <DateFirstAnswerSchedule data={data} participantId={participantId} />
          )}
          <Link
            className="link inline-flex min-h-11 items-center text-sm"
            href={`${root}/input/sync-review`}
          >
            自分の予定を他のイベントにも反映する
          </Link>
        </section>
      ) : (
        <p className="text-base-content/65 text-sm">
          {signedIn
            ? '予定へ保存するには「回答紐づきを編集」で、この回答を自分の回答に設定してください。'
            : '回答はログインせずに保存されています。'}{' '}
          {!signedIn && (
            <Link
              className="link"
              href={`/auth/signin?callbackUrl=${encodeURIComponent(`${root}/input/complete?participant_id=${participantId}&kind=${kind}`)}`}
            >
              ログインして予定を管理する
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
