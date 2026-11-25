import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/auth';
import { getMyLinkedParticipantIdForEvent } from '@/lib/actions';
import { readDateFirstEvent } from '@/lib/date-first-service';
import DateFirstAccount from '@/components/date-first/account';

/** 予定管理から、保存済み本人回答への差分とコメント削除を確認する。 */
export default async function ScheduleReviewPage({
  params,
}: {
  params: Promise<{ public_id: string }>;
}) {
  const { public_id: token } = await params;
  if (!(await getAuthSession())?.user?.id)
    redirect(
      `/auth/signin?callbackUrl=${encodeURIComponent(`/event/${token}/input/schedule-review`)}`,
    );
  const data = await readDateFirstEvent(token);
  if (!data) notFound();
  const participantId = await getMyLinkedParticipantIdForEvent(data.event.id);
  return (
    <div className="app-page-narrow space-y-6">
      <header className="page-header space-y-2">
        <h1 className="page-title">予定から回答への変更を確認</h1>
        <p className="page-description">{data.event.title}</p>
      </header>
      {participantId ? (
        <DateFirstAccount data={data} myParticipantId={participantId} />
      ) : (
        <p>イベントページで自分の回答を紐付けてください。</p>
      )}
      <Link className="btn btn-outline" href={`/event/${token}`}>
        イベント結果ページへ戻る
      </Link>
    </div>
  );
}
