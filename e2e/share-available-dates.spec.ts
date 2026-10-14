import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Database } from '../src/lib/database.types';

loadEnvConfig(process.cwd());

const screenshotDir = process.env.SHARE_SCREENSHOT_DIR;
let eventId: string;
let publicToken: string;
const participantIds = [randomUUID(), randomUUID(), randomUUID()];

function localDatabase() {
  const url = process.env.SUPABASE_URL;
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('共有E2Eのデータ作成はローカルSupabaseでのみ実行できます');
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('ローカルSupabaseの認証設定がありません');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

async function capture(page: Page, name: string) {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, { recursive: true });
  const section = page.getByTestId('available-dates-share').filter({ visible: true });
  await section.scrollIntoViewIfNeeded();
  await section.evaluate((element) =>
    window.scrollTo({
      top: window.scrollY + element.getBoundingClientRect().top - 80,
      behavior: 'instant',
    }),
  );
  await section.screenshot({ path: path.join(screenshotDir, `${name}.png`) });
}

test.describe('共通日程の共有', () => {
  test.beforeAll(async () => {
    const db = localDatabase();
    eventId = randomUUID();
    publicToken = randomUUID().replaceAll('-', '').slice(0, 12);
    const created = await db.from('events').insert({
      id: eventId,
      public_token: publicToken,
      admin_token: randomUUID(),
      title: 'バンド練習の候補',
    });
    if (created.error) throw created.error;
    const dateIds = [randomUUID(), randomUUID()];
    const dates = await db.from('event_dates').insert(
      dateIds.map((id, i) => ({
        id,
        event_id: eventId,
        start_time: `2099-10-20T${10 + i}:00:00`,
        end_time: `2099-10-20T${11 + i}:00:00`,
      })),
    );
    if (dates.error) throw dates.error;
    const participants = await db.from('participants').insert(
      participantIds.map((id, i) => ({
        id,
        event_id: eventId,
        name: ['たけ', 'ゆう', 'はる'][i],
      })),
    );
    if (participants.error) throw participants.error;
    const answers = await db.from('availabilities').insert(
      [
        [0, 1],
        [1, 2],
      ].flatMap((ids, i) =>
        ids.map((id) => ({
          event_id: eventId,
          event_date_id: dateIds[i],
          participant_id: participantIds[id],
          availability: true,
        })),
      ),
    );
    if (answers.error) throw answers.error;
  });

  test.afterAll(async () => {
    if (!eventId) return;
    const deleted = await localDatabase().from('events').delete().eq('id', eventId);
    if (deleted.error) throw deleted.error;
  });

  test('条件・プレビュー・共有本文・空状態・不正入力を確認する', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: ShareData) => {
          (window as Window & { sharePayload?: ShareData }).sharePayload = data;
        },
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            window._copiedText = text;
          },
        },
      });
    });
    await page.goto(`/event/${publicToken}`);
    const share = page.getByTestId('available-dates-share').filter({ visible: true });
    await expect(share).toBeVisible();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await capture(page, 'desktop-light-conditions');
    await share.getByTestId('share-min-count').fill('2');
    await share.getByTestId('share-preview-open').click();
    const preview = share.getByTestId('share-preview-text');
    await expect(preview).toHaveValue(/10:00-11:00, 11:00-12:00/);
    await capture(page, 'desktop-light-preview');
    await share.getByRole('button', { name: '共通日程の本文をコピー' }).click();
    expect(await page.evaluate(() => window._copiedText)).toBe(await preview.inputValue());
    await share.getByRole('button', { name: '共通日程を共有' }).click();
    const payload = await page.evaluate(
      () => (window as Window & { sharePayload?: ShareData }).sharePayload,
    );
    expect(`${payload?.text}\n${payload?.url}`).toBe(await preview.inputValue());
    await expect(page.getByText('本文とURLをコピーしました')).not.toBeVisible({ timeout: 6000 });
    await expect(page.getByText('リンクを共有しました')).not.toBeVisible({ timeout: 6000 });
    await share.getByTestId('share-duration').selectOption('120');
    await expect(share.getByRole('status')).toHaveText(
      '条件に合う日程がありません。条件を変更してください。',
    );
    await expect(share.getByRole('button', { name: '共通日程を共有' })).toBeDisabled();
    await capture(page, 'desktop-light-empty');
    await share.getByTestId('share-min-count').fill('1');
    await share.locator('summary').click();
    await share.getByTestId(`share-required-${participantIds[1]}`).check();
    await expect(preview).toHaveValue(/必須参加者: ゆう/);
    await expect(preview).toHaveValue(/10:00-12:00/);
    await capture(page, 'desktop-light-required');
    await share.getByTestId(`share-required-${participantIds[0]}`).check();
    await expect(share.getByRole('status')).toBeVisible();
    await capture(page, 'desktop-light-required-empty');
    await share.getByTestId(`share-required-${participantIds[0]}`).uncheck();
    await share.getByTestId('share-min-count').fill('0');
    await expect(share.getByRole('alert')).toBeVisible();
    await expect(preview).not.toBeVisible();
    await capture(page, 'desktop-light-invalid');
    await share.getByTestId('share-min-count').fill('1');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(preview).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await capture(page, 'mobile-light-preview');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await capture(page, 'mobile-dark-preview');
    await share.getByRole('button', { name: 'プレビューを閉じる' }).click();
    await expect(share.getByTestId('share-preview-open')).toBeVisible();
    await capture(page, 'mobile-dark-conditions');
  });
});
