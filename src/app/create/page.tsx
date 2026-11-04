import EventForm from '@/components/event-form';
import Card from '@/components/layout/Card';
import siteConfig from '@/lib/site-config';
import { Metadata } from 'next';
import DateFirstCreate from '@/components/date-first/create';

export const metadata: Metadata = {
  title: `イベント作成 | ${siteConfig.name.full}`,
  description: `複数の候補日程を設定して、参加者の都合を簡単に調整できるイベントを作成します。${siteConfig.name.full}で最適な日程を見つけましょう。`,
  openGraph: {
    title: `イベント作成 | ${siteConfig.name.full}`,
    description: `複数の候補日程を設定して、参加者の都合を簡単に調整できるイベントを作成します。${siteConfig.name.full}で最適な日程を見つけましょう。`,
    url: `${siteConfig.url}/create`,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
      },
    ],
  },
};

export default async function CreateEventPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const enabled = process.env.ENABLE_DATE_FIRST_SCHEDULING === 'true';
  const dateFirst = enabled && mode === 'date';
  return (
    <div className="app-page-narrow">
      <header className="page-header fade-in">
        {!dateFirst && <p className="page-eyebrow">CREATE</p>}
        <h1 className="page-title">新しいイベントを作成</h1>
        <p className="page-description">イベントを作成後、参加者への共有リンクが発行されます。</p>
      </header>

      {enabled && (
        <nav aria-label="調整方式" className="mb-6 flex flex-wrap gap-3">
          <a
            href="/create?mode=date"
            className={`btn ${dateFirst ? 'btn-primary' : 'btn-ghost'}`}
            aria-current={dateFirst ? 'page' : undefined}
          >
            日付から決める
          </a>
          <a
            href="/create"
            className={`btn ${!dateFirst ? 'btn-primary' : 'btn-ghost'}`}
            aria-current={!dateFirst ? 'page' : undefined}
          >
            最初から時間も決める
          </a>
        </nav>
      )}
      {dateFirst ? (
        <DateFirstCreate />
      ) : (
        <Card className="fade-in" noPadding>
          <EventForm />
        </Card>
      )}
    </div>
  );
}
