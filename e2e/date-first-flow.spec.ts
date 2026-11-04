import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.skip(
  process.env.ENABLE_DATE_FIRST_SCHEDULING !== 'true',
  '日付先行型を有効にした隔離環境で実行する',
);

test('日付回答から詳細時間・確定・解除・カレンダーまで同じイベントで調整する', async ({ page }) => {
  test.setTimeout(120000);
  const editor = page.locator('[data-testid="date-first-answer"]:visible');
  const finalization = page.locator('[data-testid="date-first-finalization"]:visible');
  const results = page.locator('[data-testid="date-first-event"]:visible');
  await page.goto('/create?mode=date');
  await page.getByTestId('date-first-title').fill(`日付先行E2E ${randomUUID().slice(0, 8)}`);
  await page.getByTestId('date-first-create-next').click();
  await page.getByLabel('表示月').fill('2099-11');
  await page.getByTestId('candidate-date-2099-11-07').click();
  await page.getByTestId('candidate-date-2099-11-08').click();
  await page.getByTestId('date-first-create-next').click();
  await page.getByLabel(/利用規約/).check();
  await page.getByTestId('date-first-create-next').click();
  await expect(page).toHaveURL(/\/event\/[a-f0-9]{32}$/);
  const eventUrl = page.url();
  const rows = results.locator('[data-testid^="day-results-"]');
  await expect(rows).toHaveCount(2);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await rows.first().evaluate((row) => {
      const label = row.children[0];
      const counts = row.children[1].getBoundingClientRect();
      return Array.from(label.children).every(
        (part) => part.getBoundingClientRect().right <= counts.left,
      );
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  const first = (await rows.nth(0).getAttribute('data-testid'))!.replace('day-results-', '');
  const second = (await rows.nth(1).getAttribute('data-testid'))!.replace('day-results-', '');
  await page.getByRole('link', { name: '日付を回答', exact: true }).click();
  await editor.getByTestId('date-first-answer-name').fill('同じ名前');
  await editor.getByTestId(`day-${first}-maybe`).click();
  await expect(editor.getByTestId('date-first-answer-name')).toHaveValue('同じ名前');
  const day = editor.getByTestId(`day-answer-${first}`);
  for (let i = 0; i < 4; i++)
    await day.getByRole('button', { name: '表示を1時間遅く延ばす' }).click();
  for (const label of ['22:00〜23:00', '23:00〜24:00', '24:00〜翌1:00', '翌1:00〜翌2:00'])
    await day.getByRole('button', { name: label, exact: true }).click();
  await day.getByRole('button', { name: /のコメント/ }).click();
  await day.getByRole('textbox', { name: /のコメント/ }).fill('翌朝まで参加できます');
  await editor.getByTestId(`day-${second}-no`).click();
  await editor.getByLabel(/利用規約/).check();
  await editor.getByTestId('date-first-answer-review').click();
  const modal = page.getByRole('dialog', { name: '回答を保存する' });
  await expect(modal).toContainText('22:00〜翌2:00');
  await modal.getByRole('button', { name: 'この内容で保存', exact: true }).click();
  await expect(results).toBeVisible();
  await results.getByTestId(`day-results-${first}`).click();
  await expect(page.getByText('22:00〜翌2:00', { exact: true })).toBeVisible();
  await expect(page.getByText('翌朝まで参加できます', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: '同じ名前さんのコメント' }).click();
  await expect(page.getByText('翌朝まで参加できます', { exact: true })).toBeVisible();
  await results.getByTestId(`day-results-${second}`).click();
  await expect(page.getByText('翌朝まで参加できます', { exact: true })).toBeVisible();
  await results.getByTestId(`day-results-${first}`).click();
  await results.getByTestId(`day-results-${first}`).click();
  await expect(page.getByText('翌朝まで参加できます', { exact: true })).not.toBeVisible();

  // 同じ名前でも、明示した新規登録を既存回答へ統合しない。
  await page.getByRole('link', { name: '日付を回答', exact: true }).click();
  await editor.getByTestId('date-first-answer-name').fill('同じ名前');
  await editor.getByTestId(`day-${first}-no`).click();
  await editor.getByTestId(`day-${second}-no`).click();
  await editor.getByLabel(/利用規約/).check();
  await editor.getByTestId('date-first-answer-review').click();
  await page
    .getByRole('dialog', { name: '回答を保存する' })
    .getByRole('button', { name: 'この内容で保存', exact: true })
    .click();
  await expect(page.getByText('参加者2人・回答を編集', { exact: true })).toBeVisible();

  await page.getByText('候補日・時間を追加、変更', { exact: true }).click();
  const config = results.getByTestId('date-first-configuration');
  await config.getByTestId('date-first-slot-start').fill('22:00');
  await config.getByTestId('date-first-slot-end').fill('翌2:00');
  await config.getByTestId('date-first-configure-review').click();
  await page
    .getByRole('dialog', { name: '時間候補を変更' })
    .getByRole('button', { name: 'この内容で保存', exact: true })
    .click();
  await expect(page.getByRole('link', { name: '時間を回答', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '日付・日時を確定、変更', exact: true }).click();
  await finalization.getByTestId(`finalize-day-${first}`).check();
  await finalization.getByTestId('date-first-finalize-review').click();
  await page
    .getByRole('dialog', { name: '確定内容を保存' })
    .getByRole('button', { name: 'この内容で確定', exact: true })
    .click();
  await expect(page.getByRole('region', { name: '確定内容' })).toContainText('時間未定');
  const icsUrl = (await page
    .getByRole('link', { name: 'ICSをダウンロード' })
    .getAttribute('href'))!;
  const dateOnly = await page.request.get(icsUrl);
  expect(dateOnly.status()).toBe(200);
  const dateOnlyText = await dateOnly.text();
  expect(dateOnlyText).toContain('DTSTART;VALUE=DATE:20991107');
  expect(dateOnlyText).toContain('TRANSP:TRANSPARENT');
  const dayUid = dateOnlyText.split('\r\n').find((line) => line.startsWith('UID:'));
  // Googleへの保存は行わず、リダイレクトの生成パラメータを検証する。
  await page.getByText('Googleカレンダーに追加', { exact: true }).click();
  const google = (await page.getByRole('link', { name: /時間未定$/ }).getAttribute('href'))!;
  const redirect = await page.request.get(google, { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(new URL(redirect.headers().location).searchParams.get('dates')).toBe('20991107/20991108');

  await page.getByText('参加者2人・回答を編集', { exact: true }).click();
  await page.getByRole('link', { name: '時間を編集', exact: true }).nth(0).click();
  await page.getByRole('button', { name: '△の時間から提案を確認' }).click();
  await expect(
    page.getByRole('dialog', { name: '△時間からの提案' }).getByRole('listitem'),
  ).toHaveCount(4);
  await page.getByRole('button', { name: '提案を入力に採用' }).click();
  await editor.getByLabel(/利用規約/).check();
  await editor.getByTestId('date-first-answer-review').click();
  await page
    .getByRole('dialog', { name: '回答を保存する' })
    .getByRole('button', { name: 'この内容で保存', exact: true })
    .click();
  await expect(results).toBeVisible();
  await page.getByRole('link', { name: '日付・日時を確定、変更', exact: true }).click();
  const timeChecks = finalization.locator('[data-testid^="finalize-time-"]');
  await expect(timeChecks).toHaveCount(4);
  for (const checkbox of await timeChecks.all()) await checkbox.check();
  await finalization.getByTestId('date-first-finalize-review').click();
  await page
    .getByRole('dialog', { name: '確定内容を保存' })
    .getByRole('button', { name: 'この内容で確定', exact: true })
    .click();
  await expect(page.getByRole('region', { name: '確定内容' })).not.toContainText('時間未定');
  const timed = await page.request.get(icsUrl),
    timedText = await timed.text();
  expect(timedText).not.toContain('VALUE=DATE');
  expect(timedText).toContain('DTSTART:20991107T130000Z');
  expect(timedText).toContain('DTEND:20991107T170000Z');
  expect(timedText.split('BEGIN:VEVENT')).toHaveLength(5);
  expect(timedText).not.toContain(dayUid!);

  // 日時だけの解除では日付を維持し、時刻未定のUIDも再確定前と同じになる。
  await page.getByRole('link', { name: '日付・日時を確定、変更', exact: true }).click();
  await expect(timeChecks).toHaveCount(4);
  for (const checkbox of await timeChecks.all()) await checkbox.uncheck();
  await expect(finalization.getByTestId(`finalize-day-${first}`)).toBeChecked();
  await finalization.getByTestId('date-first-finalize-review').click();
  await expect(page.getByRole('dialog', { name: '確定内容を保存' })).toContainText(
    '日時の確定を解除',
  );
  await page
    .getByRole('dialog', { name: '確定内容を保存' })
    .getByRole('button', { name: 'この内容で確定', exact: true })
    .click();
  await expect(page.getByRole('region', { name: '確定内容' })).toContainText('時間未定');
  expect(await (await page.request.get(icsUrl)).text()).toContain(dayUid!);
  await page.getByRole('link', { name: '日付・日時を確定、変更', exact: true }).click();
  await finalization.getByTestId(`finalize-day-${first}`).uncheck();
  await finalization.getByTestId('date-first-finalize-review').click();
  await page
    .getByRole('dialog', { name: '確定内容を保存' })
    .getByRole('button', { name: 'この内容で確定', exact: true })
    .click();
  await expect(page.getByRole('region', { name: '確定内容' })).toHaveCount(0);
  expect((await page.request.get(icsUrl)).status()).toBe(404);
  await expect(page).toHaveURL(new RegExp(eventUrl.split('?')[0]));
});
