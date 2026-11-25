import { redirect } from 'next/navigation';
import {
  getEvent,
  getMyLinkedParticipantIdForEvent,
  touchEventLastAccessedIfStale,
} from '@/lib/actions';
import { readDateFirstEvent } from '@/lib/date-first-service';
import DateFirstComplete from '@/components/date-first/complete';
import { getAuthSession } from '@/lib/auth';
import AnswerCompletePage from '@/components/sync/answer-complete-page';

type AnswerCompleteRouteProps = {
  params: Promise<{ public_id: string }>;
  searchParams: Promise<{ participant_id?: string; sync_warning?: string; kind?: string }>;
};

export default async function AnswerCompleteRoutePage({
  params,
  searchParams,
}: AnswerCompleteRouteProps) {
  const { public_id: publicId } = await params;
  const {
    participant_id: participantId = null,
    sync_warning: syncWarning,
    kind,
  } = await searchParams;
  const session = await getAuthSession();

  try {
    const event = await getEvent(publicId);
    await touchEventLastAccessedIfStale(publicId);
    if (event.scheduling_mode === 'date_first') {
      const data = await readDateFirstEvent(publicId);
      if (!data || !participantId || !data.participants.some((p) => p.id === participantId))
        redirect(`/event/${publicId}`);
      const linked = session?.user?.id ? await getMyLinkedParticipantIdForEvent(event.id) : null;
      return (
        <DateFirstComplete
          data={data}
          participantId={participantId}
          linkedParticipantId={linked}
          signedIn={Boolean(session?.user?.id)}
          kind={kind === 'times' ? 'times' : 'days'}
        />
      );
    }

    return (
      <AnswerCompletePage
        eventId={event.id}
        publicToken={publicId}
        participantId={participantId}
        isAuthenticated={Boolean(session?.user?.id)}
        syncWarning={syncWarning === 'partial' ? 'partial' : null}
      />
    );
  } catch (error) {
    console.error('回答完了ページの初期化エラー:', error);
    redirect(`/event/${publicId}`);
  }
}
