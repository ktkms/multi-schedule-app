import { test, expect, Page } from '@playwright/test';

declare global {
  interface Window {
    __vibrateCalls: Array<number | number[]>;
  }
}

async function gotoWithRetry(page: Page, url: string, maxRetry = 10, interval = 2000) {
  let lastErr;
  for (let i = 0; i < maxRetry; i++) {
    try {
      if (!url) {
        throw new Error('URLが指定されていません');
      }
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  throw lastErr;
}

async function proceedAsGuest(page: Page) {
  await page.getByRole('button', { name: '次へ' }).click();
}

let eventPublicUrl = '';

test.describe.serial('回答入力のドラッグと触覚 E2E', () => {
  test.describe.configure({ timeout: 60_000 });

  test('イベント作成', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '触覚検証は chromium で実行する');

    await gotoWithRetry(page, '/create?mode=time');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('イベントタイトル').fill('E2Eドラッグ触覚イベント');
    await page.getByTestId('event-description-input').fill('ドラッグ入力と触覚確認用');
    await page.getByTestId('create-next').click();
    await page.getByTestId('input-mode-auto').click();
    await page.getByRole('button', { name: /次へ/ }).click();

    const dateInputs = await page.locator('input[type="date"]').all();
    if (dateInputs.length >= 2) {
      await dateInputs[0].fill('2099-01-31');
      await dateInputs[1].fill('2099-02-01');
    }

    const timeInputs = await page.locator('input[type="time"]').all();
    if (timeInputs.length >= 2) {
      await timeInputs[0].fill('10:00');
      await timeInputs[1].fill('11:00');
    }

    await page.getByRole('button', { name: /次へ/ }).click();
    const termsCheckbox = page.getByLabel('利用規約');
    if (await termsCheckbox.isVisible()) {
      await termsCheckbox.check();
    }
    await page.getByRole('button', { name: /イベントを作成/ }).click();
    await page.waitForURL(/\/event\//, { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    const publicUrl = new URL(page.url());
    publicUrl.searchParams.delete('admin');
    eventPublicUrl = publicUrl.toString();
  });

  test('ヒートマップのドラッグで最初の選択意図と触覚を維持する', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '触覚検証は chromium で実行する');

    await page.addInitScript(() => {
      window.__vibrateCalls = [];
      Object.defineProperty(window.navigator, 'vibrate', {
        configurable: true,
        value: (pattern: number | number[]) => {
          window.__vibrateCalls.push(pattern);
          return true;
        },
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });

    await gotoWithRetry(page, eventPublicUrl);
    await expect(page.getByRole('link', { name: /新しく回答する/ })).toBeVisible();
    await page.getByRole('link', { name: /新しく回答する/ }).click();
    await page.waitForURL(/\/input/);

    await page.getByLabel('お名前').fill(`E2E触覚確認_${Date.now()}`);
    await proceedAsGuest(page);
    await page.getByRole('button', { name: '次へ' }).click();

    const cells = page.getByTestId('availability-step-heatmap').locator('[data-selection-key]');
    expect(await cells.count()).toBeGreaterThanOrEqual(2);

    const firstCell = cells.nth(0);
    const secondCell = cells.nth(1);

    await secondCell.click();
    await expect(secondCell).toContainText('○');
    await page.evaluate(() => {
      window.__vibrateCalls = [];
    });
    await page.waitForTimeout(150);

    const firstBox = await firstCell.boundingBox();
    const secondBox = await secondCell.boundingBox();
    if (!firstBox || !secondBox) {
      throw new Error('ドラッグ対象セルの座標が取得できません');
    }

    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, {
      steps: 8,
    });
    await page.mouse.up();

    await expect(firstCell).toContainText('○');
    await expect(secondCell).toContainText('○');

    const vibrateCalls = await page.evaluate(() => window.__vibrateCalls);
    expect(vibrateCalls.length).toBeGreaterThanOrEqual(2);
    expect(vibrateCalls).toEqual(expect.arrayContaining([[20], [28]]));
  });
});
