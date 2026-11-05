import { redirect } from 'next/navigation';
import { getEvent, touchEventLastAccessedIfStale } from '@/lib/actions';
import { getAuthSession } from '@/lib/auth';
import { readDateFirstUserPreviews } from '@/lib/date-first-sync';
import { readDateFirstEvent } from '@/lib/date-first-service';
import SyncReviewPage from '@/components/sync/sync-review-page';

type SyncReviewRouteProps = {
  params: Promise<{ public_id: string }>;
  searchParams: Promise<{ sync_warning?: string }>;
};

export default async function SyncReviewRoutePage({ params, searchParams }: SyncReviewRouteProps) {
  const { public_id: publicId } = await params;
  const { sync_warning: syncWarning } = await searchParams;
  const session = await getAuthSession();

  if (!session?.user?.id) {
    redirect(`/event/${publicId}`);
  }

  try {
    const event = await getEvent(publicId);
    await touchEventLastAccessedIfStale(publicId);
    const previews = await readDateFirstUserPreviews(session.user.id);
    const dateFirstTargets = (
      await Promise.all(
        previews
          .filter((p) => p.eventId !== event.id)
          .map(async (preview) => {
            const data = await readDateFirstEvent(preview.publicToken);
            if (!data) return null;
            const participantId = preview.participantId;
            return participantId ? { data, participantId } : null;
          }),
      )
    ).filter((item): item is NonNullable<typeof item> => item !== null);
    return (
      <SyncReviewPage
        dateFirstTargets={dateFirstTargets}
        publicToken={publicId}
        currentEventId={event.id}
        syncWarning={syncWarning === 'partial' ? 'partial' : null}
      />
    );
  } catch (error) {
    console.error('同期確認ページの初期化エラー:', error);
    redirect(`/event/${publicId}`);
  }
}
