import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

test.skip(
  process.env.ENABLE_DATE_FIRST_SCHEDULING !== 'true' || process.env.E2E_REQUIRE_AUTH !== 'true',
  '日付先行型と開発ログインを有効にした隔離環境で実行する',
);

test('本人リンク・予定反映の削除確認・正式時間回答の予定保存 @auth-required', async ({ page }) => {
  test.setTimeout(120000);
  const url = new URL(process.env.SUPABASE_DB_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/daysynth_date_first_review'
  )
    throw new Error('専用の隔離DBだけで実行してください');
  const db = new Client({ connectionString: url.href });
  await db.connect();
  let eventId: string | undefined;
  const confirmReload = async (name: string) => {
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('dialog').getByRole('button', { name, exact: true }).click(),
    ]);
  };
  try {
    const event = (
      await db.query('SELECT date_first.create_event($1,$2::jsonb) AS value', [
        randomUUID(),
        JSON.stringify({ title: '本人予定の画面検証', days: ['2098-12-07', '2098-12-08'] }),
      ])
    ).rows[0].value;
    eventId = event.id;
    const days = (
      await db.query('SELECT id FROM event_candidate_days WHERE event_id=$1 ORDER BY local_date', [
        event.id,
      ])
    ).rows;
    await db.query('SELECT date_first.add_slots($1,0,$2,$3::jsonb)', [
      event.token,
      days[0].id,
      '[[600,630],[630,660]]',
    ]);
    const participant = (
      await db.query('SELECT date_first.web_answer($1,$2,$3,$4::jsonb,$5) AS value', [
        event.token,
        randomUUID(),
        'days',
        '[]',
        '自分の回答',
      ])
    ).rows[0].value.id;
    const slots = (
      await db.query('SELECT id FROM event_dates WHERE event_id=$1 ORDER BY start_time', [event.id])
    ).rows;
    await db.query('SELECT date_first.save_answers($1,$2,0,$3,$4::jsonb)', [
      event.token,
      participant,
      'times',
      JSON.stringify([{ id: slots[0].id, availability: false }]),
    ]);
    await page.goto('/auth/signin?callbackUrl=%2Faccount');
    await page.getByLabel('開発ID').fill(process.env.E2E_DEV_LOGIN_ID!);
    await page.getByLabel('開発パスワード').fill(process.env.E2E_DEV_LOGIN_PASSWORD!);
    await page.getByRole('button', { name: '開発用ログインで進む' }).click();
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();
    const user = (
      await db.query('SELECT id FROM authjs.users WHERE email=$1', [
        `${process.env.E2E_DEV_LOGIN_ID}@local.dev`,
      ])
    ).rows[0].id;
    await db.query(
      "INSERT INTO user_schedule_blocks(user_id,start_time,end_time,availability,source,event_id) VALUES($1,'2098-12-08 10:00Z','2098-12-08 11:00Z',true,'manual',$2) ON CONFLICT(user_id,start_time,end_time) DO UPDATE SET availability=true,source='manual',event_id=excluded.event_id",
      [user, event.id],
    );
    await page.goto(`/event/${event.token}/input`);
    const prompt = page.getByRole('dialog', { name: '予定を取り込みますか？' });
    const candidate = page.locator(`[data-testid="day-${days[1].id}-maybe"]:visible`);
    await expect(prompt).toBeVisible();
    await expect(candidate).toHaveAttribute('aria-pressed', 'false');
    await prompt.getByRole('button', { name: '取り込まずに続ける' }).click();
    await expect(prompt).toHaveCount(0);
    await expect(candidate).toHaveAttribute('aria-pressed', 'false');
    await page.goto(`/event/${event.token}`);
    await page.getByTestId('event-answer-link-open').click();
    await page.getByTestId('event-answer-link-select').selectOption(participant);
    await page.getByTestId('event-answer-link-link').click();
    await expect(page.getByRole('dialog')).toContainText('回答をアカウントに紐づけました');
    await page.getByTestId('event-answer-link-close').click();
    await page.goto(`/event/${event.token}/input/schedule-review`);
    await expect(page.getByRole('heading', { name: '予定から回答への変更を確認' })).toBeVisible();
    await page.getByRole('button', { name: '変更内容を確認して反映' }).click();
    await expect(page.getByRole('dialog', { name: '予定から回答へ反映' })).toContainText(
      '未回答 → △',
    );
    await confirmReload('この差分を反映');
    const readDay = async () =>
      (
        await db.query(
          'SELECT status,source,comment FROM event_day_responses WHERE participant_id=$1 AND candidate_day_id=$2',
          [participant, days[1].id],
        )
      ).rows;
    expect(await readDay()).toMatchObject([{ status: 'maybe', source: 'account' }]);
    await page.goto(`/event/${event.token}/input?participant_id=${participant}&kind=days`);
    await expect(page.getByRole('dialog', { name: '予定を取り込みますか？' })).toHaveCount(0);
    const day = page.locator(`[data-testid="day-answer-${days[1].id}"]:visible`);
    await expect(day.getByTestId(`day-${days[1].id}-maybe`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await day.getByRole('button', { name: /のコメント/ }).click();
    await day.getByRole('textbox').fill('自動回答のコメント');
    await page.getByLabel(/利用規約/).check();
    await page.getByTestId('date-first-answer-review').click();
    await page
      .getByRole('dialog', { name: '未回答の日があります' })
      .getByRole('button', { name: 'このまま確認' })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'この内容で保存', exact: true })
      .click();
    await expect(page).toHaveURL(/\/input\/complete\?participant_id=[a-f0-9-]+&kind=days$/);
    await page.getByRole('link', { name: 'イベント結果を見る', exact: true }).click();
    await expect(page.getByTestId('date-first-event')).toBeVisible();
    expect(await readDay()).toMatchObject([
      { status: 'maybe', source: 'account', comment: '自動回答のコメント' },
    ]);
    await db.query(
      "UPDATE user_schedule_blocks SET availability=false WHERE user_id=$1 AND start_time='2098-12-08 10:00Z'",
      [user],
    );
    await page.goto(`/event/${event.token}/input/schedule-review`);
    await expect(page.getByRole('heading', { name: '予定から回答への変更を確認' })).toBeVisible();
    await page.getByRole('button', { name: '変更内容を確認して反映' }).click();
    await expect(page.getByRole('dialog', { name: '予定から回答へ反映' })).toContainText(
      '自動回答のコメント',
    );
    await page.getByRole('dialog').getByRole('button', { name: 'キャンセル', exact: true }).click();
    expect(await readDay()).toHaveLength(1);
    await page.getByRole('button', { name: '変更内容を確認して反映' }).click();
    await expect(page.getByRole('dialog', { name: '予定から回答へ反映' })).toContainText(
      '自動回答のコメント',
    );
    await confirmReload('この差分を反映');
    expect(await readDay()).toHaveLength(0);
    await page.goto(
      `/event/${event.token}/input/complete?participant_id=${participant}&kind=times`,
    );
    await page.getByRole('button', { name: '時間の回答を自分の予定へ保存' }).click();
    await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(1);
    await page.getByRole('dialog').getByRole('button', { name: '予定との差分を確認' }).click();
    await expect(page.getByRole('dialog')).toContainText('10:00〜10:30');
    await confirmReload('この内容で予定を更新');
    expect(
      (
        await db.query(
          "SELECT availability,end_time-start_time AS duration FROM user_schedule_blocks WHERE user_id=$1 AND event_id=$2 AND source='event'",
          [user, event.id],
        )
      ).rows,
    ).toMatchObject([{ availability: false, duration: { minutes: 30 } }]);
  } finally {
    if (eventId) {
      await db.query('DELETE FROM user_schedule_blocks WHERE event_id=$1', [eventId]);
      await db.query('DELETE FROM events WHERE id=$1', [eventId]);
    }
    await db.end();
  }
});
