// src/app/event/[public_id]/page.tsx
import { getEvent, getEventDates, getParticipantById } from '@/lib/actions';
import { notFound } from 'next/navigation';
import AvailabilityForm from '@/components/availability-form';
import siteConfig from '@/lib/site-config';
import { Metadata } from 'next';
import Link from 'next/link';
import { deferEventLastAccessedTouch } from '@/lib/event-page-lifecycle';
import { EventNotFoundError } from '@/lib/errors';
import { getUserScheduleContext } from '@/lib/schedule-actions';
import { getAuthSession } from '@/lib/auth';
import { readDateFirstEvent, readDateFirstAnswer } from '@/lib/date-first-service';
import DateFirstAnswerEditor from '@/components/date-first/answer';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ public_id: string }>;
}): Promise<Metadata> {
  const { public_id } = await params;
  let event;
  try {
    event = await getEvent(public_id);
  } catch (err) {
    if (err instanceof EventNotFoundError) {
      return {
        title: `イベントが見つかりません | ${siteConfig.name.full}`,
        description: `お探しのイベントは存在しないか、削除された可能性があります。`,
      };
    }
    console.error('メタデータ取得エラー:', err);
    return {
      title: `イベント取得エラー | ${siteConfig.name.full}`,
      description: `イベント情報の取得中に問題が発生しました。時間をおいて再度お試しください。`,
    };
  }
  const eventTitle = event.title;
  return {
    title: `イベント詳細 | ${siteConfig.name.full}`,
    description: `「${eventTitle}」の日程調整ページです。`,
    robots: { index: false, follow: true },
    openGraph: {
      title: `イベント詳細 | ${siteConfig.name.full}`,
      description: `「${eventTitle}」の日程調整ページです。`,
      url: `${siteConfig.url}/event/${public_id}`,
      images: [{ url: siteConfig.ogImage, width: 1200, height: 630 }],
    },
  };
}

type EventPageProps = {
  params: Promise<{ public_id: string }>;
  searchParams: Promise<{ participant_id?: string; kind?: string }>;
};

export default async function EventPage({ params, searchParams }: EventPageProps) {
  const { public_id } = await params;
  const { participant_id: participantId, kind } = await searchParams;

  let event;
  try {
    event = await getEvent(public_id);
    deferEventLastAccessedTouch(public_id);
  } catch (err) {
    if (err instanceof EventNotFoundError) {
      notFound();
    }
    console.error('イベント取得エラー:', err);
    throw err;
  }

  if (event.scheduling_mode === 'date_first') {
    const [data, answer] = await Promise.all([
      readDateFirstEvent(public_id),
      participantId ? readDateFirstAnswer(public_id, participantId) : Promise.resolve(null),
    ]);
    if (!data || (participantId && !answer)) notFound();
    return (
      <div className="app-page-narrow">
        <DateFirstAnswerEditor
          data={data}
          initialAnswer={answer}
          kind={kind === 'times' ? 'times' : 'days'}
        />
      </div>
    );
  }
  const sessionPromise = getAuthSession();
  const eventDatesPromise = getEventDates(event.id);
  const participantPromise = participantId
    ? getParticipantById(participantId, event.id)
    : Promise.resolve(null);
  const scheduleContextPromise = Promise.all([eventDatesPromise, sessionPromise]).then(
    ([eventDates, session]) =>
      getUserScheduleContext(event.id, eventDates, session?.user?.id ?? null),
  );

  // フォーム表示に必要な情報が揃うまで待機し、不要なスケルトンを避ける
  const [eventDates, participantResult, scheduleContext, session] = await Promise.all([
    eventDatesPromise,
    participantPromise,
    scheduleContextPromise,
    sessionPromise,
  ]);

  const existingParticipant = participantResult?.participant || null;
  const existingAvailabilities = participantResult?.availabilityMap || null;
  const isEditMode = Boolean(existingParticipant);
  const pageTitle = isEditMode ? '回答を編集する' : '新しく回答する';

  return (
    <div className="app-page-narrow availability-input-page">
      <header className="page-header">
        <p className="page-eyebrow">RESPOND</p>
        <h1 className="page-title">{pageTitle}</h1>
        {isEditMode ? (
          <p className="page-description">
            {event.title} — 「{existingParticipant?.name}」さんの回答を編集しています。
          </p>
        ) : (
          <p className="page-description">
            {event.title} — お名前と参加できる候補日を入力してください。
          </p>
        )}
      </header>

      <div className="availability-input-surface surface overflow-visible p-3 sm:p-6">
        <AvailabilityForm
          eventId={event.id}
          publicToken={public_id}
          eventDates={eventDates}
          initialParticipant={existingParticipant}
          initialAvailabilities={existingAvailabilities || undefined}
          mode={isEditMode ? 'edit' : 'new'}
          isAuthenticated={scheduleContext.isAuthenticated}
          userId={session?.user?.id ?? null}
          hasSyncTargetEvents={scheduleContext.hasSyncTargetEvents}
          lockedDateIds={scheduleContext.lockedDateIds}
          autoFillAvailabilities={scheduleContext.autoFillAvailabilities}
          dailyAutoFillDateIds={scheduleContext.dailyAutoFillDateIds}
          overrideDateIds={scheduleContext.overrideDateIds}
          coveredDateIds={scheduleContext.coveredDateIds}
          uncoveredDateKeys={scheduleContext.uncoveredDateKeys}
          uncoveredDayCount={scheduleContext.uncoveredDayCount}
          requireWeeklyStep={scheduleContext.requireWeeklyStep}
          hasAccountSeedData={scheduleContext.hasAccountSeedData}
        />
      </div>

      <div className="border-base-300 mt-6 border-t pt-5">
        <Link
          href={`/event/${public_id}`}
          className="text-primary hover:text-primary/80 inline-flex min-h-11 items-center text-sm font-medium"
        >
          <span aria-hidden="true" className="mr-2">
            ←
          </span>
          回答状況の確認・集計に戻る
        </Link>
      </div>
    </div>
  );
}
