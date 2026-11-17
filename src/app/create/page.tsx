import EventForm from '@/components/event-form';
import Card from '@/components/layout/Card';
import siteConfig from '@/lib/site-config';
import { Metadata } from 'next';
import DateFirstCreate from '@/components/date-first/create';
import Image from 'next/image';
import CreateModeReset from '@/components/create-mode-reset';

const schedulingModes = [
  {
    value: 'date',
    label: '日付を調整',
    description: '参加できる日を調整します。',
    image: '/images/daysynth-date-only.svg',
  },
  {
    value: 'time',
    label: '時間まで調整',
    description: '日付と時間を組み合わせた候補から、参加できる日時を調整。',
    image: '/images/daysynth-date-time.svg',
  },
] as const;

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
  const chooseMode = enabled && mode !== 'date' && mode !== 'time';
  return (
    <div className="app-page-narrow">
      <header className="page-header fade-in">
        {!enabled && <p className="page-eyebrow">CREATE</p>}
        <h1 className="page-title">新しいイベントを作成</h1>
        <p className="page-description">イベントを作成後、参加者への共有リンクが発行されます。</p>
      </header>

      {chooseMode && (
        <form action="/create" method="get" className="space-y-6" data-testid="create-mode-picker">
          <fieldset>
            <legend className="mb-3 font-semibold">調整方法を選ぶ</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {schedulingModes.map(({ value, label, description, image }) => (
                <label
                  key={value}
                  className="border-base-300 hover:border-primary/40 has-[:checked]:border-primary has-[:focus-visible]:outline-primary flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-[:focus-visible]:outline-2"
                >
                  <input
                    type="radio"
                    className="radio radio-primary radio-sm mt-0.5 shrink-0"
                    name="mode"
                    value={value}
                    required
                    aria-labelledby={`create-mode-${value}-label`}
                    aria-describedby={`create-mode-${value}-description`}
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span id={`create-mode-${value}-label`} className="block font-semibold">
                      {label}
                    </span>
                    <span
                      id={`create-mode-${value}-description`}
                      className="text-base-content/70 block text-sm"
                    >
                      {description}
                    </span>
                  </span>
                  <Image
                    src={image}
                    alt=""
                    width={96}
                    height={96}
                    className="size-16 shrink-0 sm:size-20"
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" data-testid="create-mode-next">
              次へ
            </button>
          </div>
        </form>
      )}
      {enabled && !chooseMode && <CreateModeReset />}
      {!chooseMode &&
        (dateFirst ? (
          <DateFirstCreate />
        ) : (
          <Card className="fade-in" noPadding>
            <EventForm />
          </Card>
        ))}
    </div>
  );
}
