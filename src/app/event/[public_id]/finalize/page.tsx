import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { deferEventLastAccessedTouch } from '@/lib/event-page-lifecycle';
import Breadcrumbs from '@/components/layout/Breadcrumbs';
import FinalizeEventPage from '@/components/event-client/finalize-event-page';
import { EventNotFoundError } from '@/lib/errors';
import siteConfig from '@/lib/site-config';
import { readDateFirstEvent } from '@/lib/date-first-service';
import { DateFirstFinalization } from '@/components/date-first/manage';
import {
  getAvailabilities,
  getEvent,
  getEventDates,
  getFinalizedDateIds,
  getParticipants,
} from '@/lib/actions';

type FinalizeRoutePageProps = {
  params: Promise<{ public_id: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ public_id: string }>;
}): Promise<Metadata> {
  const { public_id } = await params;

  try {
    const event = await getEvent(public_id);
    return {
      title: `日程の確定 | ${event.title} | ${siteConfig.name.full}`,
      description: `${event.title} の候補日程から、確定内容を選んで更新できます。`,
      robots: { index: false, follow: true },
    };
  } catch (error) {
    if (error instanceof EventNotFoundError) {
      return {
        title: `イベントが見つかりません | ${siteConfig.name.full}`,
        description: 'お探しのイベントは存在しないか、削除された可能性があります。',
      };
    }

    console.error('日程確定ページのメタデータ取得エラー:', error);
    return {
      title: `イベント取得エラー | ${siteConfig.name.full}`,
      description: 'イベント情報の取得中に問題が発生しました。時間をおいて再度お試しください。',
    };
  }
}

export default async function FinalizeRoutePage({ params }: FinalizeRoutePageProps) {
  const { public_id: publicId } = await params;

  let event;
  try {
    event = await getEvent(publicId);
    deferEventLastAccessedTouch(publicId);
  } catch (error) {
    if (error instanceof EventNotFoundError) {
      notFound();
    }
    console.error('日程確定ページの初期化エラー:', error);
    throw error;
  }

  if (event.scheduling_mode === 'date_first') {
    const data = await readDateFirstEvent(publicId);
    if (!data) notFound();
    return (
      <div className="app-page-narrow">
        <DateFirstFinalization data={data} />
      </div>
    );
  }
  const [eventDates, participants, availabilities, finalizedDateIds] = await Promise.all([
    getEventDates(event.id),
    getParticipants(event.id),
    getAvailabilities(event.id),
    event.is_finalized ? getFinalizedDateIds(event.id, event.final_date_id ?? null) : [],
  ]);

  return (
    <>
      <div className="bg-base-200 mb-4 py-3 sm:mb-6 sm:py-4">
        <div className="container mx-auto max-w-5xl px-2 sm:px-4">
          <Breadcrumbs
            items={[{ label: 'イベント詳細', href: `/event/${publicId}` }, { label: '日程の確定' }]}
          />
        </div>
      </div>

      <div className="container mx-auto max-w-5xl px-2 pb-16 sm:px-4">
        <FinalizeEventPage
          eventId={event.id}
          publicToken={publicId}
          eventTitle={event.title}
          eventDates={eventDates}
          participants={participants}
          availabilities={availabilities}
          finalizedDateIds={finalizedDateIds}
        />
      </div>
    </>
  );
}
