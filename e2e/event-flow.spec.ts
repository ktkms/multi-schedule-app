import { test, expect, Page } from '@playwright/test';

const captureUiuxScreenshots = process.env.CAPTURE_UIUX_SCREENSHOTS === 'true';

async function captureUiuxVariants(page: Page, baseName: string) {
  if (!captureUiuxScreenshots) return;
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const capture = async (device: 'desktop' | 'mobile', theme: 'light' | 'dark') => {
    await page.evaluate((nextTheme) => {
      document.documentElement.setAttribute('data-theme', nextTheme);
      document.documentElement.style.colorScheme = nextTheme;
    }, theme);
    if (baseName === 'terms-checkbox') {
      await page.getByLabel('利用規約').scrollIntoViewIfNeeded();
    } else {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
    }
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `docs/screenshots/uiux-refresh/after-${baseName}-${device}-${theme}.png`,
      fullPage: false,
    });
  };

  await capture('desktop', 'light');
  await capture('desktop', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('mobile', 'light');
  await capture('mobile', 'dark');
  await page.setViewportSize(originalViewport);
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';
  });
}

// サーバー起動遅延＋JSレンダリング待ち対策
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
      await new Promise((res) => setTimeout(res, interval));
    }
  }
  throw lastErr;
}

async function waitForEventDetail(page: Page) {
  const expectedUrl = eventPublicUrl || eventAdminUrl;
  if (!expectedUrl) {
    throw new Error('イベントURLが初期化されていません');
  }
  const expectedPrefix = eventPublicUrl || expectedUrl;
  await page.waitForURL(
    (url) => {
      const current = url.toString();
      if (current.includes('/input/complete')) return true;
      if (current === expectedUrl) return true;
      return current.startsWith(expectedPrefix) && !current.includes('/input');
    },
    { timeout: 15000 },
  );
  if (page.url().includes('/input/complete')) {
    const returnLink = page.getByRole('link', {
      name: /イベント結果を見る|イベント結果ページへ戻る/,
    });
    await expect(returnLink).toBeVisible({ timeout: 10_000 });
    await returnLink.click();
    await page.waitForURL(
      (url) => {
        const current = url.toString();
        if (current === expectedUrl) return true;
        return current.startsWith(expectedPrefix) && !current.includes('/input');
      },
      { timeout: 15000 },
    );
  }
}

async function dumpPageHtml(page: Page, label: string) {
  if (page.isClosed()) {
    console.log(`${label} (ページが既にクローズされています)`);
    return;
  }
  const html = await page.content();
  console.log(label, html);
}

async function proceedAsGuest(page: Page) {
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.getByRole('dialog', { name: 'ログイン方法を選択してください' })).toHaveCount(0);
}

let eventAdminUrl: string;
let eventPublicUrl: string;
let participantName: string;

// Playwrightのテストでwindow.navigator.clipboardをモックするための型定義
declare global {
  interface Window {
    /** Playwright の addInitScript で設定するカスタムプロパティ */
    _copiedText: string;
  }
}

// 直列でE2Eフローを分割
test('手動選択した候補だけでイベントを作成する', async ({ page }) => {
  await page.goto('/create');
  await page.getByLabel('イベントタイトル').fill('E2E手動選択');
  await page.getByTestId('create-next').click();
  await page.getByTestId('input-mode-manual').click();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2099-02-02');
  await dates.nth(1).fill('2099-02-02');
  const times = page.locator('input[type="time"]');
  await times.nth(0).fill('10:00');
  await times.nth(1).fill('12:00');
  await page.getByRole('button', { name: 'カレンダーへ' }).click();
  const slots = page.getByTestId('slot-cell');
  await slots.first().click();
  await expect(slots.first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByLabel('利用規約').check();
  await page.getByRole('button', { name: /イベントを作成/ }).click();
  await page.waitForURL(/\/event\//);
  const eventUrl = new URL(page.url());
  eventUrl.search = '';
  await page.goto(`${eventUrl}/input`);
  await page.getByLabel('お名前').fill('候補確認');
  await proceedAsGuest(page);
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.locator('button[data-selection-key]')).toHaveCount(1);
});

test.describe.serial('イベントE2Eフロー', () => {
  test.describe.configure({ timeout: 60_000 });

  test('イベント作成', async ({ page }) => {
    await gotoWithRetry(page, '/create');
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('イベントタイトル')).toBeVisible();
    await captureUiuxVariants(page, 'create');
    await page.getByLabel('イベントタイトル').fill('E2Eテストイベント');
    await page.getByTestId('event-description-input').fill('E2E自動テスト用イベント');
    await page.getByTestId('create-next').click();
    await page.getByTestId('input-mode-auto').click();
    await page.getByRole('button', { name: /次へ/ }).click();
    const dateInputs = await page.locator('input[type="date"]').all();
    if (dateInputs.length >= 2) {
      await dateInputs[0].fill('2099-01-01');
      await dateInputs[1].fill('2099-01-06');
    }
    const timeInputs = await page.locator('input[type="time"]').all();
    if (timeInputs.length >= 2) {
      await timeInputs[0].fill('10:00');
      await timeInputs[1].fill('15:00');
    }
    await page.getByRole('button', { name: /次へ/ }).click();
    const termsCheckbox = page.getByLabel('利用規約');
    if (await termsCheckbox.isVisible()) {
      await termsCheckbox.check();
    }
    await captureUiuxVariants(page, 'terms-checkbox');
    await page.getByRole('button', { name: /イベントを作成/ }).click();
    try {
      await page.waitForURL(/\/event\//, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
    } catch (e) {
      await dumpPageHtml(page, 'DEBUG: イベント作成後の画面HTML');
      throw e;
    }
    eventAdminUrl = page.url();
    expect(eventAdminUrl).toMatch(/\/event\//);
    const adminUrl = new URL(eventAdminUrl);
    adminUrl.searchParams.delete('admin');
    eventPublicUrl = adminUrl.toString();
    expect(eventPublicUrl).toMatch(/\/event\//);
    await expect(page.getByRole('heading', { name: 'E2Eテストイベント' })).toBeVisible();
    await captureUiuxVariants(page, 'event-detail');
  });

  test('参加者がheatmapで回答', async ({ context }) => {
    const participantPage = await context.newPage();
    await gotoWithRetry(participantPage, eventPublicUrl || eventAdminUrl);
    await participantPage.waitForLoadState('networkidle');
    await expect(participantPage.getByRole('link', { name: /新しく回答する/ })).toBeVisible();
    await participantPage.getByRole('link', { name: /新しく回答する/ }).click();
    await participantPage.waitForURL(/\/input/);
    await expect(participantPage.getByLabel('お名前')).toBeVisible();
    await captureUiuxVariants(participantPage, 'answer');
    participantName = `E2E参加者${Date.now()}`;
    await participantPage.getByLabel('お名前').fill(participantName);
    await proceedAsGuest(participantPage);
    await participantPage.getByRole('button', { name: '次へ' }).click();
    const dateCells = participantPage.locator('button[data-selection-key]');
    await dateCells.first().click();
    if ((await dateCells.count()) >= 2) {
      await dateCells.nth(1).click();
    }
    await expect(dateCells.first()).toHaveText('○');
    if ((await dateCells.count()) >= 2) {
      await expect(dateCells.nth(1)).toHaveText('○');
    }
    await participantPage.getByRole('button', { name: '確認へ進む' }).click();
    await participantPage.getByLabel('コメント・メモ').fill('E2Eコメント');
    const participantTerms = participantPage.getByLabel(/利用規約/);
    if (await participantTerms.isVisible()) {
      await participantTerms.check();
    }
    let failedSave = false;
    await participantPage.route('**/event/**/input', async (route) => {
      const request = route.request();
      if (
        !failedSave &&
        request.method() === 'POST' &&
        request.headers()['next-action'] &&
        (request.postData() ?? '').includes('E2Eコメント')
      ) {
        failedSave = true;
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await participantPage.getByRole('button', { name: /回答を送信/ }).click();
    await expect(participantPage.getByRole('alert')).toBeVisible();
    expect(failedSave).toBe(true);
    await expect(participantPage.getByLabel('コメント・メモ')).toHaveValue('E2Eコメント');
    await participantPage.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(dateCells.first()).toHaveText('○');
    await expect(dateCells.nth(1)).toHaveText('○');
    await participantPage.getByRole('button', { name: '確認へ進む' }).click();
    await expect(participantPage.getByText(`お名前: ${participantName}`)).toBeVisible();
    await participantPage.getByLabel(/利用規約/).check();
    await participantPage.getByRole('button', { name: /回答を送信/ }).click();
    await participantPage.waitForURL(/\/input\/complete\?participant_id=/);
    const savedId = new URL(participantPage.url()).searchParams.get('participant_id');
    expect(savedId).toBeTruthy();

    // 回答送信後の画面遷移を待機し、"回答状況の確認・集計に戻る" ボタンがあればクリック
    await waitForEventDetail(participantPage);
    const backToSummaryBtn = participantPage.getByRole('button', {
      name: /回答状況の確認・集計に戻る/,
    });
    if (await backToSummaryBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await backToSummaryBtn.click();
    }

    // 完了ページから戻った際のルーターキャッシュを更新して最新の回答を確認する
    await participantPage.reload({ waitUntil: 'networkidle' });

    // 参加者の表示選択に新規回答者が反映されるまで待機
    try {
      await expect(
        participantPage.getByRole('button', { name: new RegExp(participantName) }),
      ).toBeVisible({
        timeout: 15000,
      });
      await captureUiuxVariants(participantPage, 'summary');
    } catch (e) {
      await dumpPageHtml(participantPage, 'DEBUG: 参加者表示失敗 page.content()');
      throw e;
    }
    await expect(
      participantPage.getByRole('button', { name: new RegExp(participantName) }),
    ).toHaveCount(1);
    await participantPage.goto(`${eventPublicUrl}/input?participant_id=${savedId}`);
    await expect(dateCells.first()).toHaveText('○');
    await expect(dateCells.nth(1)).toHaveText('○');
    await participantPage.getByRole('button', { name: '確認へ進む' }).click();
    await expect(participantPage.getByLabel('コメント・メモ')).toHaveValue('E2Eコメント');
    await participantPage.close();
  });

  test('週表示で別参加者が回答', async ({ page }) => {
    await gotoWithRetry(page, eventAdminUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // 安定化
    await expect(page.getByRole('heading', { name: 'E2Eテストイベント' })).toBeVisible({
      timeout: 10000,
    });
    // 参加者が1人以上いることを検証
    await page.waitForLoadState('networkidle');
    try {
      await expect(page.getByRole('button', { name: new RegExp(participantName) })).toBeVisible({
        timeout: 10000,
      });
    } catch (e) {
      await dumpPageHtml(page, 'DEBUG: 3件目参加者表示失敗 page.content()');
      throw e;
    }
    await page.reload();
    await page.getByRole('link', { name: '新しく回答する' }).click();
    await page.waitForURL(/\/input$/);
    await page.getByLabel('お名前').fill('週表示参加者');
    await proceedAsGuest(page);
    await page.locator('td[data-day="月"][data-time-slot]').first().click();
    await page.getByRole('button', { name: '次へ' }).click();
    const weeklySelectedKeys = await page
      .locator('button[data-selection-key]')
      .evaluateAll((cells) =>
        cells
          .filter((cell) => cell.textContent === '○')
          .map((cell) => cell.getAttribute('data-selection-key')),
      );
    expect(weeklySelectedKeys.length).toBeGreaterThan(0);
    await page.getByRole('button', { name: '確認へ進む' }).click();
    const terms2 = page.getByLabel(/利用規約/);
    if (await terms2.isVisible()) {
      await terms2.check();
    }
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /回答を送信/ }).click();
    await page.waitForURL(/\/input\/complete\?participant_id=/);
    const weeklySavedId = new URL(page.url()).searchParams.get('participant_id');
    expect(weeklySavedId).toBeTruthy();

    // 回答送信後の画面遷移を待機し、"回答状況の確認・集計に戻る" ボタンがあればクリック
    await waitForEventDetail(page);
    const backToSummaryBtn = page.getByRole('button', {
      name: /回答状況の確認・集計に戻る/,
    });
    if (await backToSummaryBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await backToSummaryBtn.click();
    }

    // 新しく追加した参加者が表示選択バッジへ反映されるまで待機
    await expect(page.getByRole('button', { name: /週表示参加者/ })).toBeVisible({
      timeout: 20000,
    });
    await page.reload();
    await expect(page.getByRole('button', { name: /週表示参加者/ })).toHaveCount(1);
    await page.goto(`${eventPublicUrl}/input?participant_id=${weeklySavedId}`);
    const persistedKeys = await page
      .locator('button[data-selection-key]')
      .evaluateAll((cells) =>
        cells
          .filter((cell) => cell.textContent === '○')
          .map((cell) => cell.getAttribute('data-selection-key')),
      );
    expect(persistedKeys).toEqual(weeklySelectedKeys);
  });

  test('既存回答の編集', async ({ page }) => {
    await gotoWithRetry(page, eventAdminUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // 安定化
    const editAnswerButton = page.getByRole('button', { name: /既存の回答を編集/ });
    const editAnswerMenu = page.getByRole('menu', { name: '編集する回答を選択' });

    await editAnswerButton.click();
    await expect(editAnswerButton).toHaveAttribute('aria-expanded', 'true');
    await expect(editAnswerMenu).toBeVisible();
    await editAnswerButton.press('ArrowDown');
    await expect(editAnswerMenu.getByRole('menuitem').first()).toBeFocused();

    // モバイルでもメニュー全体がビューポート内に収まることを確認する。
    const desktopViewport = page.viewportSize() ?? { width: 1280, height: 720 };
    await editAnswerButton.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await editAnswerButton.click();
    await expect(editAnswerMenu).toBeVisible();
    const mobileMenuBox = await editAnswerMenu.boundingBox();
    expect(mobileMenuBox).not.toBeNull();
    expect(mobileMenuBox!.x).toBeGreaterThanOrEqual(0);
    expect(mobileMenuBox!.x + mobileMenuBox!.width).toBeLessThanOrEqual(390);

    // Escapeで閉じ、トリガーへフォーカスが戻ることを確認する。
    await page.keyboard.press('Escape');
    await expect(editAnswerButton).toHaveAttribute('aria-expanded', 'false');
    await expect(editAnswerButton).toBeFocused();

    await page.setViewportSize(desktopViewport);
    await editAnswerButton.click();

    const originalParticipantName = await page
      .getByRole('menuitem', { name: '週表示参加者' })
      .textContent();
    const participantNamePrefix = originalParticipantName?.split(' ')[0] || '週表示参加者';
    await page.getByRole('menuitem', { name: new RegExp(`^${participantNamePrefix}`) }).click();
    await page.waitForURL(/\/input\?participant_id=/);
    const editUrl = page.url();
    const editedCell = page.locator('button[data-selection-key]').first();
    const originalStatus = await editedCell.textContent();
    await editedCell.click();
    const changedStatus = await editedCell.textContent();
    expect(changedStatus).not.toBe(originalStatus);
    await page.getByRole('button', { name: '確認へ進む' }).click();
    await page.getByLabel('コメント・メモ').fill('編集後のコメント');
    await expect(page.locator('#participant_name_confirm')).toHaveCount(0);
    const editTermsCheckbox = page.getByLabel(/利用規約/);
    if (await editTermsCheckbox.isVisible()) {
      await editTermsCheckbox.check();
    }
    await page.getByRole('button', { name: '回答を更新する' }).click();

    // 回答更新後の画面遷移を待機し、"回答状況の確認・集計に戻る" ボタンがあればクリック
    await waitForEventDetail(page);
    const backToSummaryBtn = page.getByRole('button', {
      name: /回答状況の確認・集計に戻る/,
    });
    if (await backToSummaryBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await backToSummaryBtn.click();
    }

    await page.reload();
    await expect(page.getByRole('button', { name: new RegExp(participantNamePrefix) })).toHaveCount(
      1,
    );
    await page.goto(editUrl);
    await expect(editedCell).toHaveText(changedStatus!);
    await page.getByRole('button', { name: '確認へ進む' }).click();
    await expect(page.getByLabel('コメント・メモ')).toHaveValue('編集後のコメント');
    await page.goto(eventPublicUrl);
    // 編集後も参加者が表示選択バッジに残ることを確認
    await expect(page.getByRole('button', { name: new RegExp(participantNamePrefix) })).toBeVisible(
      {
        timeout: 10000,
      },
    );
  });

  test('主催者確定・カレンダー連携', async ({ context }) => {
    const adminPage = await context.newPage();
    await gotoWithRetry(adminPage, eventAdminUrl);
    await adminPage.waitForLoadState('networkidle');

    await expect(adminPage.getByRole('heading', { name: 'みんなの回答状況' })).toBeVisible({
      timeout: 10000,
    });

    const openFinalizeLink = adminPage.getByRole('link', {
      name: /日程を確定する|確定内容を変更する/,
    });
    await expect(openFinalizeLink).toBeVisible();
    await openFinalizeLink.click();
    await adminPage.waitForURL(/\/finalize$/);

    const selectableCell = adminPage
      .locator('button[data-selection-key][aria-pressed="false"]')
      .first();
    await expect(selectableCell).toBeVisible();
    await captureUiuxVariants(adminPage, 'finalize');
    await selectableCell.click();

    await expect(adminPage.getByText(/選択中\s*1件/).first()).toBeVisible({
      timeout: 3000,
    });

    const confirmSelectionButton = adminPage.getByRole('button', {
      name: /内容を確認する/,
    });
    await expect(confirmSelectionButton).toBeVisible();
    await confirmSelectionButton.click();

    await expect(adminPage.getByText(/今回確定する日程/)).toBeVisible();
    const saveDraftButton = adminPage.getByRole('button', {
      name: /この内容で保存する/,
    });
    await expect(saveDraftButton).toBeVisible();
    await saveDraftButton.click();

    const cancelConfirmButton = adminPage.getByRole('button', { name: /^キャンセル$/ });
    await expect(cancelConfirmButton).toBeFocused();
    await cancelConfirmButton.press('Shift+Tab');
    await expect(adminPage.getByRole('button', { name: /^保存する$/ })).toBeFocused();
    await adminPage.getByRole('button', { name: /^保存する$/ }).press('Escape');
    await expect(saveDraftButton).toBeFocused();
    await saveDraftButton.click();

    const saveConfirmButton = adminPage.getByRole('button', { name: /^保存する$/ });
    await expect(saveConfirmButton).toBeVisible();
    await saveConfirmButton.click();

    await adminPage.waitForURL(/\/event\/[^/]+\?finalize_status=saved$/);

    const icsLink = adminPage.getByRole('link', { name: /カレンダーに追加/ });

    await expect(icsLink).toBeVisible({ timeout: 10000 });
    const icsHref = await icsLink.getAttribute('href');
    expect(icsHref).toMatch(/\/api\/calendar\/ics\//);
    const googleCalLink = adminPage.getByRole('link', {
      name: /Googleカレンダー/,
    });
    await expect(googleCalLink).toBeVisible();
    const googleHref = await googleCalLink.getAttribute('href');
    expect(googleHref).toMatch(/\/api\/calendar\/.*\?googleCalendar=true/);
    // 2) request フィクスチャを使って GET、リダイレクトを追わない
    const apiResponse = await adminPage.request.get(googleHref!, {
      maxRedirects: 0,
    });
    expect(apiResponse.status()).toBe(307);
    const redirectUrl = apiResponse.headers()['location'];
    expect(redirectUrl).toMatch(/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
    await adminPage.close();
  });

  test('主催者が確定解除（全日程の確定をキャンセル）できる', async ({ context }) => {
    const adminPage = await context.newPage();
    await gotoWithRetry(adminPage, eventAdminUrl);
    await adminPage.waitForLoadState('networkidle');
    await expect(adminPage.getByRole('heading', { name: 'みんなの回答状況' })).toBeVisible({
      timeout: 10000,
    });
    const openFinalizeLink = adminPage.getByRole('link', {
      name: /確定内容を変更する|日程を確定する/,
    });
    await expect(openFinalizeLink).toBeVisible();
    await openFinalizeLink.click();
    await adminPage.waitForURL(/\/finalize$/);

    // 直前のテストで1件確定しているため、その候補をクリックして選択解除
    const selectedCell = adminPage.locator('[data-selection-key][aria-pressed="true"]').first();
    await expect(selectedCell).toBeVisible();
    await selectedCell.click({ force: true });
    // 「選択中 0件」表示を確認
    await expect(adminPage.getByText(/選択中\s*0件/).first()).toBeVisible({
      timeout: 3000,
    });

    const confirmSelectionButton = adminPage.getByRole('button', {
      name: /内容を確認する/,
    });
    await expect(confirmSelectionButton).toBeVisible();
    await confirmSelectionButton.click();

    const clearDraftButton = adminPage.getByRole('button', {
      name: /この内容で解除する/,
    });
    await expect(clearDraftButton).toBeVisible();
    await clearDraftButton.click();

    const clearConfirmButton = adminPage.getByRole('button', { name: /^解除する$/ });
    await expect(clearConfirmButton).toBeVisible();
    await clearConfirmButton.click();

    await adminPage.waitForURL(/\/event\/[^/]+\?finalize_status=cleared$/);
    await expect(adminPage.getByText('確定済みの日程')).not.toBeVisible({
      timeout: 10000,
    });
    await adminPage.close();
  });

  test('イベント共有ボタンのURLが公開URLと一致する', async ({ page }) => {
    // ページ読み込み前に確実に走らせる
    await page.addInitScript(() => {
      // navigator.share を無効化
      Object.defineProperty(navigator, 'share', {
        value: undefined,
        configurable: true,
      });

      // clipboard.writeText をモックして window._copiedText に書き込む
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: (text: string) => {
            window._copiedText = text;
            return Promise.resolve();
          },
        },
        configurable: true,
      });

      // テスト用変数も初期化
      window._copiedText = '';
    });

    // イベント詳細ページへ遷移
    await gotoWithRetry(page, eventAdminUrl);
    await page.waitForLoadState('networkidle');

    // 共有ボタンをクリック
    const shareBtn = page.getByRole('button', {
      name: /イベントを共有|イベントURLを共有/,
    });
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();

    // クリップボードにコピーされた内容を取得
    const copied = await page.evaluate(() => window._copiedText);
    expect(copied).toBe(eventPublicUrl);
  });

  // クイック自動延長UIのE2Eテスト
  // 仕様: 日程追加セクションで延長日を選択し、クイック自動延長ボタン→モーダルで追加→完了→重複エラーも検証
  test('クイック自動延長で日程追加・重複バリデーション', async ({ page }) => {
    await gotoWithRetry(page, eventAdminUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // 日程追加セクションを展開
    const addSection = page.getByText('日程を追加する', { exact: false });
    await addSection.click();
    // details要素を強制的にopenにする
    await page
      .locator('details')
      .first()
      .evaluate((el) => {
        el.setAttribute('open', '');
      });
    // input#extendToDateがvisibleになるまで明示的に待機
    await page.waitForSelector('input#extendToDate', {
      state: 'visible',
      timeout: 5000,
    });
    const dateInput = page.getByLabel('延長したい最終日');

    // input#extendToDateのmin属性値を取得し、+1日した日付を延長日とする
    const minDate = await dateInput.getAttribute('min');
    if (!minDate) throw new Error('min属性が取得できません');
    const minDateObj = new Date(minDate);
    // まず+1日の日付を入力
    minDateObj.setDate(minDateObj.getDate() + 1);
    const yyyy = minDateObj.getFullYear();
    const mm = String(minDateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(minDateObj.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    await dateInput.fill(dateStr);
    // quickBtnがenabledになるまで待機
    const quickBtn = page.getByTestId('quick-extend-submit');
    await expect(quickBtn).toBeEnabled({ timeout: 5000 });

    // クイック自動延長ボタン押下
    await quickBtn.click();

    // モーダルで「追加する」ボタン押下
    await page.getByRole('button', { name: /^追加する$/ }).click();

    // 完了ダイアログの表示
    await expect(page.getByText('日程を追加しました').first()).toBeVisible({
      timeout: 10000,
    });

    // 同じ日程で再度追加し重複バリデーション
    await page.locator('input[type="date"]').first().fill(dateStr);
    // ボタンが無効化されていることを確認（UI上の重複チェックが機能していることを検証）
    await expect(quickBtn).toBeDisabled({ timeout: 5000 });
  });

  test('詳細日程追加フォーム-正常系・重複バリデーション', async ({ page }) => {
    await gotoWithRetry(page, eventAdminUrl);
    await page.waitForLoadState('networkidle');

    // 日程追加セクションを展開
    const addSection2 = page.getByText('日程を追加する', { exact: false });
    await expect(addSection2).toBeVisible();
    await addSection2.click();

    // 日付文字列を生成
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 14); // 他シナリオと競合しにくい日付
    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    // 日程追加セクションを展開
    const addSection = page.getByText('詳細な日程追加', { exact: false });
    await expect(addSection).toBeVisible();
    await addSection.click();
    // input[type="date"]がvisibleかつ有効になるまで待機
    await page.waitForSelector('input[type="date"]:not([disabled])', {
      state: 'visible',
      timeout: 5000,
    });
    // 柔軟な日程追加（詳細な日程追加）が閉じている場合は開く
    const detailsSummary = page.locator('summary', {
      hasText: '詳細な日程追加',
    });
    const details = detailsSummary.locator('..'); // 親のdetails要素
    if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await detailsSummary.click({ force: true });
    }
    // details内のvisibleなinputのみを取得しfill
    const visibleStartInput = details.locator('input[aria-label="開始日"]:visible');
    const visibleEndInput = details.locator('input[aria-label="終了日"]:visible');
    await visibleStartInput.fill(dateStr);
    await visibleEndInput.fill(dateStr);
    // aria-labelはUI上のラベルと一致させており、柔軟な文言変更にも追従できるようにしている
    const visibleStartTimeInput = details.locator('input[aria-label="各日の開始時刻"]:visible');
    const visibleEndTimeInput = details.locator('input[aria-label="各日の終了時刻"]:visible');
    await visibleStartTimeInput.fill('09:00');
    await visibleEndTimeInput.fill('10:00');
    await expect(details.getByText('生成された日程概要')).toBeVisible({ timeout: 5000 });
    // 追加ボタン押下（詳細追加セクション内のボタンに限定）
    const addDateButton = details.locator('button', { hasText: '日程を追加' });
    await expect(addDateButton).toBeVisible({ timeout: 5000 });
    await expect(addDateButton).toBeEnabled({ timeout: 5000 });
    await addDateButton.click({ force: true });
    // 確認モーダルのOKボタン押下
    const confirmAddButton = page.getByRole('button', { name: /^追加する$/ });
    await expect(confirmAddButton).toBeVisible({ timeout: 5000 });
    await confirmAddButton.click({ force: true });
    const successAlert = page.getByTestId('event-date-add-success');
    await expect(successAlert).toBeVisible({ timeout: 10000 });
    await expect(successAlert).toBeHidden({ timeout: 10000 });

    // 同じ日程を再度追加し、重複エラーを検証
    const autoModeButton = page.getByTestId('event-date-add-mode-auto');
    await expect(autoModeButton).toBeVisible({ timeout: 5000 });
    if (await autoModeButton.isEnabled()) {
      await autoModeButton.click({ force: true });
    }
    const detailsSummaryAfterRefresh = page.locator('summary', {
      hasText: '詳細な日程追加',
    });
    await expect(detailsSummaryAfterRefresh).toBeVisible({ timeout: 5000 });
    const detailsAfterRefresh = detailsSummaryAfterRefresh.locator('..');
    if (!(await detailsAfterRefresh.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await detailsSummaryAfterRefresh.click({ force: true });
    }
    await detailsAfterRefresh.locator('input[aria-label="開始日"]:visible').fill(dateStr);
    await detailsAfterRefresh.locator('input[aria-label="終了日"]:visible').fill(dateStr);
    await detailsAfterRefresh.locator('input[aria-label="各日の開始時刻"]:visible').fill('09:00');
    await detailsAfterRefresh.locator('input[aria-label="各日の終了時刻"]:visible').fill('10:00');
    const addDateButtonAfterRefresh = detailsAfterRefresh.locator('button', {
      hasText: '日程を追加',
    });
    await expect(addDateButtonAfterRefresh).toBeVisible({ timeout: 5000 });
    await expect(addDateButtonAfterRefresh).toBeEnabled({ timeout: 5000 });
    await addDateButtonAfterRefresh.click({ force: true });
    await expect(confirmAddButton).toBeVisible({ timeout: 5000 });
    await confirmAddButton.click({ force: true });
    const duplicateAlert = page.getByTestId('event-date-add-error');
    await expect(duplicateAlert).toBeVisible({ timeout: 5000 });
    await expect(duplicateAlert).toContainText(/重複/);
  });
});
