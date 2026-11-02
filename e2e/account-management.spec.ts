import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

type RuntimeConfig = {
  dbUrl: string;
  baseUrl: string;
  devLoginId: string;
  devLoginPassword: string;
};

type SeededEvent = {
  id: string;
  publicToken: string;
  title: string;
  dateIds: string[];
};

const loadRuntimeConfig = (): RuntimeConfig => {
  const envFromProcess = {
    dbUrl: process.env.SUPABASE_DB_URL ?? '',
    baseUrl: process.env.E2E_BASE_URL ?? '',
    devLoginId: process.env.E2E_DEV_LOGIN_ID ?? process.env.DEV_LOGIN_ID ?? '',
    devLoginPassword: process.env.E2E_DEV_LOGIN_PASSWORD ?? process.env.DEV_LOGIN_PASSWORD ?? '',
  };

  if (
    envFromProcess.dbUrl &&
    envFromProcess.baseUrl &&
    envFromProcess.devLoginId &&
    envFromProcess.devLoginPassword
  ) {
    return envFromProcess;
  }

  const map: Record<string, string> = {};
  const lines = readFileSync('.env.local', 'utf-8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx < 0) return;
    const key = trimmed.slice(0, idx).trim();
    const rawValue = trimmed.slice(idx + 1).trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    map[key] = value;
  });

  return {
    dbUrl: envFromProcess.dbUrl || map.SUPABASE_DB_URL || '',
    baseUrl: envFromProcess.baseUrl || 'http://localhost:3201',
    devLoginId: envFromProcess.devLoginId || map.E2E_DEV_LOGIN_ID || map.DEV_LOGIN_ID || 'e2e-dev',
    devLoginPassword:
      envFromProcess.devLoginPassword ||
      map.E2E_DEV_LOGIN_PASSWORD ||
      map.DEV_LOGIN_PASSWORD ||
      'e2e-devpass',
  };
};

const runtime = loadRuntimeConfig();
if (process.env.E2E_REQUIRE_AUTH === 'true' && !runtime.dbUrl) {
  throw new Error('必須の認証E2EにはSUPABASE_DB_URLが必要です');
}
const isDevLoginEnabled =
  process.env.ENABLE_DEV_LOGIN === 'true' && process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true';

if (process.env.E2E_REQUIRE_AUTH === 'true' && !isDevLoginEnabled) {
  throw new Error('必須の認証E2Eにはサーバー側・画面側の開発用ログインが必要です');
}

const randomToken = (length: number): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const loginAsDevUser = async (page: Page): Promise<void> => {
  await page.goto('/account', { waitUntil: 'domcontentloaded' });
  if (
    await page
      .getByRole('button', { name: 'ログアウト' })
      .isVisible()
      .catch(() => false)
  ) {
    return;
  }

  await page.goto(`/auth/signin?callbackUrl=${encodeURIComponent('/account')}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: '開発用ログイン' })).toBeVisible();
  await page.getByLabel('開発ID').fill(runtime.devLoginId);
  await page.getByLabel('開発パスワード').fill(runtime.devLoginPassword);
  await page.getByRole('button', { name: '開発用ログインで進む' }).click({ force: true });
  await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();
};

const dismissAccountTourIfVisible = async (page: Page): Promise<void> => {
  const tourDialog = page.getByTestId('account-tour-dialog');
  await page.waitForTimeout(150);
  if (!(await tourDialog.isVisible().catch(() => false))) return;
  const skipButton = page.getByTestId('account-tour-skip');
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click({ force: true });
  }
  await expect(tourDialog).toBeHidden();
};

test.describe('アカウント連携管理E2E @auth-required', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !runtime.dbUrl || !runtime.devLoginId || !runtime.devLoginPassword,
    'E2Eに必要な環境変数（SUPABASE_DB_URL / DEV_LOGIN_ID / DEV_LOGIN_PASSWORD）が不足しています',
  );
  test.skip(!isDevLoginEnabled, '開発用ログインが無効のためスキップします');

  let db: Client;
  let userId = '';
  let schemaSkipReason: string | null = null;
  const createdEventIds: string[] = [];
  const createdTokens: string[] = [];
  const createdScheduleBlockIds: string[] = [];

  const createSeedEvent = async (
    titlePrefix: string,
    slots: Array<{ start: string; end: string }>,
  ) => {
    const title = `${titlePrefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const publicToken = randomToken(12);
    const eventInsert = await db.query<{ id: string }>(
      'insert into public.events(public_token,title) values($1,$2) returning id',
      [publicToken, title],
    );
    const eventId = eventInsert.rows[0].id;
    createdEventIds.push(eventId);
    createdTokens.push(publicToken);

    const dateIds: string[] = [];
    for (const slot of slots) {
      const inserted = await db.query<{ id: string }>(
        'insert into public.event_dates(event_id,start_time,end_time) values($1,$2,$3) returning id',
        [eventId, slot.start, slot.end],
      );
      dateIds.push(inserted.rows[0].id);
    }

    return { id: eventId, publicToken, title, dateIds } satisfies SeededEvent;
  };

  const createParticipant = async (eventId: string, name: string) => {
    const inserted = await db.query<{ id: string }>(
      'insert into public.participants(event_id,name,response_token) values($1,$2,$3) returning id',
      [eventId, name, randomUUID()],
    );
    return inserted.rows[0].id;
  };

  test.beforeAll(async () => {
    db = new Client({ connectionString: runtime.dbUrl });
    await db.connect();
    const schemaCheck = await db.query<{ users_table: string | null; blocks_table: string | null }>(
      "select to_regclass('authjs.users') as users_table, to_regclass('public.user_schedule_blocks') as blocks_table",
    );
    const schemaRow = schemaCheck.rows[0];
    if (!schemaRow?.users_table || !schemaRow?.blocks_table) {
      schemaSkipReason =
        'E2E前提テーブルが不足しています（authjs.users / public.user_schedule_blocks）。マイグレーション適用後に再実行してください。';
      if (process.env.E2E_REQUIRE_AUTH === 'true') throw new Error(schemaSkipReason);
      return;
    }

    const email = `${runtime.devLoginId}@local.dev`;
    const existing = await db.query<{ id: string }>('select id from authjs.users where email=$1', [
      email,
    ]);

    if (existing.rowCount && existing.rows[0]) {
      userId = existing.rows[0].id;
      return;
    }

    const inserted = await db.query<{ id: string }>(
      'insert into authjs.users(name,email,"emailVerified") values($1,$2,now()) returning id',
      ['開発ユーザー', email],
    );
    userId = inserted.rows[0].id;
  });

  test.beforeEach(async () => {
    test.skip(Boolean(schemaSkipReason), schemaSkipReason ?? '');
  });

  test.afterAll(async () => {
    if (!db) return;
    if (schemaSkipReason) {
      await db.end();
      return;
    }
    if (createdEventIds.length > 0) {
      await db.query('delete from public.user_schedule_blocks where id = any($1::uuid[])', [
        createdScheduleBlockIds,
      ]);
      await db.query(
        'delete from public.user_event_links where user_id=$1 and event_id = any($2::uuid[])',
        [userId, createdEventIds],
      );
      await db.query('delete from public.availabilities where event_id = any($1::uuid[])', [
        createdEventIds,
      ]);
      await db.query('delete from public.participants where event_id = any($1::uuid[])', [
        createdEventIds,
      ]);
      await db.query('delete from public.event_dates where event_id = any($1::uuid[])', [
        createdEventIds,
      ]);
      await db.query('delete from public.events where id = any($1::uuid[])', [createdEventIds]);
    }
    if (createdTokens.length > 0) {
      await db.query(
        'delete from public.event_access_histories where user_id=$1 and event_public_token = any($2::text[])',
        [userId, createdTokens],
      );
    }
    await db.query(
      "delete from public.user_schedule_blocks where user_id=$1 and source='manual' and start_time >= '2099-01-01'::timestamptz and end_time < '2100-01-01'::timestamptz",
      [userId],
    );
    await db.end();
  });

  test('ログイン直後の /account で未ログイン文言がフラッシュしない', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'DBシード併用ケースはchromiumで安定実行');

    await loginAsDevUser(page);
    await page.goto('/account', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).not.toContainText('ログインすると予定設定を管理できます。');
    await page.waitForTimeout(700);
    await expect(page.locator('body')).not.toContainText('ログインすると予定設定を管理できます。');
  });

  test('/account ツアーは初回表示後に抑止され、手動で再表示できる', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'DBシード併用ケースはchromiumで安定実行');

    await loginAsDevUser(page);
    await page.goto('/account', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      localStorage.removeItem('account_page_tour_state_v1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const tourDialog = page.getByRole('dialog', { name: 'アカウントページの使い方' });
    await expect(tourDialog).toBeVisible();
    await page.getByTestId('account-tour-skip').click();
    await expect(tourDialog).toBeHidden();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(tourDialog).toBeHidden();

    await page.getByTestId('account-tour-open').first().click();
    await expect(tourDialog).toBeVisible();
    await page.getByTestId('account-tour-next').click();
    await expect(tourDialog.getByText('予定の設定')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('account-tour-skip').click();
    await expect(tourDialog).toBeHidden();

    await page.getByTestId('account-tour-open').first().click();
    await expect(tourDialog).toBeVisible();
    await page.getByTestId('account-tour-next').click();
    await expect(tourDialog.getByText('予定の設定')).toBeVisible();
  });

  test('/account では未ログイン回答の紐づけセクションを表示しない', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'DBシード併用ケースはchromiumで安定実行');

    await loginAsDevUser(page);
    await page.goto('/account', { waitUntil: 'domcontentloaded' });
    await dismissAccountTourIfVisible(page);
    await expect(page.getByTestId('account-answer-linker')).toHaveCount(0);
    await expect(page.getByText('未ログイン回答の紐づけ')).toHaveCount(0);
  });

  test('イベント入力画面では既存回答紐づけ導線を表示しない', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'DBシード併用ケースはchromiumで安定実行');

    const event = await createSeedEvent('E2E_入力紐づけ', [
      { start: '2099-03-02T03:00:00Z', end: '2099-03-02T04:00:00Z' },
    ]);

    await loginAsDevUser(page);
    await page.goto(`/event/${event.publicToken}/input`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('availability-link-existing-answer')).toHaveCount(0);
  });

  test('予定一括管理の更新と反映プレビュー導線を確認できる', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'DBシード併用ケースはchromiumで安定実行');

    const syncEvent = await createSeedEvent('E2E_反映対象', [
      { start: '2099-04-06T03:00:00Z', end: '2099-04-06T04:00:00Z' },
    ]);
    const syncParticipantId = await createParticipant(syncEvent.id, `E2E_同期_${Date.now()}`);
    await db.query(
      'insert into public.availabilities(event_id,participant_id,event_date_id,availability) values($1,$2,$3,false)',
      [syncEvent.id, syncParticipantId, syncEvent.dateIds[0]],
    );
    await db.query(
      `insert into public.user_event_links(user_id,event_id,participant_id,auto_sync,created_at,updated_at)
       values($1,$2,$3,true,now(),now())
       on conflict(user_id,event_id) do update set participant_id=excluded.participant_id,updated_at=now()`,
      [userId, syncEvent.id, syncParticipantId],
    );

    await db.query(
      `insert into public.user_schedule_blocks(user_id,start_time,end_time,availability,source,event_id,updated_at)
       values($1,'2099-04-06T03:00:00Z','2099-04-06T04:00:00Z',true,'manual',null,now())
       on conflict(user_id,start_time,end_time)
       do update set
         availability=excluded.availability,
         source=excluded.source,
         event_id=excluded.event_id,
         updated_at=excluded.updated_at`,
      [userId],
    );

    await loginAsDevUser(page);
    await page.goto('/account', { waitUntil: 'domcontentloaded' });
    await dismissAccountTourIfVisible(page);
    const scheduleSettings = page.getByTestId('account-schedule-settings').first();

    await scheduleSettings.getByTestId('dated-edit').click();
    const datedCells = scheduleSettings.locator('button[aria-label^="20"]');
    if ((await datedCells.count()) > 0) {
      await datedCells.first().click();
    }
    await scheduleSettings.getByTestId('dated-save').click();
    await expect(scheduleSettings).toContainText(/予定一括管理を更新しました|変更はありません/);

    await scheduleSettings.getByTestId('sync-check-button').click();
    const syncSection = scheduleSettings.getByTestId('schedule-sync-section');
    await expect(syncSection).toContainText(
      /変更対象のイベントはありません|変更のあるイベントを下で確認できます|この変更を適用/,
    );
  });

  test('予定表と反映確認は狭い画面でもセルからはみ出さず中央に配置される', async ({
    page,
  }, testInfo) => {
    // UTCでは日曜、日本時間では月曜になる時刻でも、画面と同じ日付を使う。
    await page.clock.setFixedTime(new Date('2026-10-11T18:00:00Z'));
    const today = await page.evaluate(() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    const currentBlock = await db.query<{ id: string }>(
      `insert into public.user_schedule_blocks(user_id,start_time,end_time,availability,source)
      values($1,$2,$3,true,'manual') on conflict(user_id,start_time,end_time) do nothing returning id`,
      [userId, `${today}T10:00:00Z`, `${today}T11:00:00Z`],
    );
    createdScheduleBlockIds.push(...currentBlock.rows.map((row) => row.id));
    const slots = Array.from({ length: 7 }, (_, index) => {
      const start = new Date('2099-10-05T10:00:00Z');
      start.setUTCDate(start.getUTCDate() + index);
      return { start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString() };
    });
    const target = await createSeedEvent('E2E_幅確認', slots);
    const anchor = await createSeedEvent('E2E_確認元', [slots[0]]);
    const participantId = await createParticipant(target.id, '幅確認');
    await db.query(
      'insert into public.user_event_links(user_id,event_id,participant_id) values($1,$2,$3)',
      [userId, target.id, participantId],
    );
    for (const slot of slots) {
      await db.query(
        `insert into public.user_schedule_blocks(user_id,start_time,end_time,availability,source)
        values($1,$2,$3,true,'manual') on conflict(user_id,start_time,end_time) do update set availability=true`,
        [userId, slot.start, slot.end],
      );
    }
    await loginAsDevUser(page);
    await dismissAccountTourIfVisible(page);
    const verifyTable = async (testId: string) => {
      const table = page.getByTestId(testId).first();
      await expect(table.locator('tbody button').first()).toBeAttached();
      const measurements = await table.evaluate((element) => {
        const region = element.parentElement!;
        const cells = [...element.querySelectorAll('tbody button')].map((button) => {
          const cell = button.parentElement!.getBoundingClientRect();
          const bounds = button.getBoundingClientRect();
          return {
            centered: Math.abs(bounds.left + bounds.width / 2 - cell.left - cell.width / 2) < 1,
            contained: bounds.left >= cell.left && bounds.right <= cell.right,
          };
        });
        return {
          cells,
          scrollable: region.scrollWidth > region.clientWidth,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(measurements.cells.every((cell) => cell.centered && cell.contained)).toBe(true);
      expect(measurements.pageOverflow).toBe(false);
      if (page.viewportSize()!.width <= 375) expect(measurements.scrollable).toBe(true);
      await table.locator('tbody button').last().scrollIntoViewIfNeeded();
      await expect(table.locator('tbody button').last()).toBeInViewport();
    };
    for (const width of [320, 375, 640, 800]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/account', { waitUntil: 'domcontentloaded' });
      await dismissAccountTourIfVisible(page);
      await verifyTable('dated-schedule-table');
      if (width === 320 || width === 640)
        await page.screenshot({ path: testInfo.outputPath(`dated-${width}.png`) });
      await page.getByTestId('sync-check-button').click();
      await verifyTable('sync-schedule-table');
      if (width === 320 || width === 640)
        await page.screenshot({ path: testInfo.outputPath(`account-${width}.png`) });
      await page.goto(`/event/${anchor.publicToken}/input/sync-review`, {
        waitUntil: 'domcontentloaded',
      });
      await verifyTable('sync-schedule-table');
    }
    // 後続の同期フローへ、このテストの反映候補を持ち越さない。
    await db.query('delete from public.user_event_links where user_id=$1 and event_id=$2', [
      userId,
      target.id,
    ]);
  });

  test('予定一括管理が新規回答と回答イベント反映に適用される', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'DBシード併用ケースはchromiumで安定実行');

    const syncEvent = await createSeedEvent('E2E_反映対象_実適用', [
      { start: '2099-05-03T03:00:00Z', end: '2099-05-03T04:00:00Z' },
    ]);
    const syncParticipantId = await createParticipant(syncEvent.id, `E2E_反映先_${Date.now()}`);
    await db.query(
      'insert into public.availabilities(event_id,participant_id,event_date_id,availability) values($1,$2,$3,false)',
      [syncEvent.id, syncParticipantId, syncEvent.dateIds[0]],
    );
    await db.query(
      `insert into public.user_event_links(user_id,event_id,participant_id,auto_sync,created_at,updated_at)
       values($1,$2,$3,true,now(),now())
       on conflict(user_id,event_id) do update set participant_id=excluded.participant_id,updated_at=now()`,
      [userId, syncEvent.id, syncParticipantId],
    );

    const answerEvent = await createSeedEvent('E2E_新規回答_自動反映', [
      { start: '2099-05-10T03:00:00Z', end: '2099-05-10T04:00:00Z' },
    ]);

    await db.query(
      `insert into public.user_schedule_blocks(user_id,start_time,end_time,availability,source,event_id,updated_at)
       values
       ($1,'2099-05-03T03:00:00Z','2099-05-03T04:00:00Z',true,'manual',null,now()),
       ($1,'2099-05-10T03:00:00Z','2099-05-10T04:00:00Z',true,'manual',null,now())
       on conflict(user_id,start_time,end_time)
       do update set availability=excluded.availability,source='manual',event_id=null,updated_at=now()`,
      [userId],
    );

    await loginAsDevUser(page);
    await page.goto(`/event/${answerEvent.publicToken}/input`, { waitUntil: 'domcontentloaded' });

    const answerName = `E2E_自動反映回答_${Date.now()}`;
    await page.getByLabel('お名前').fill(answerName);
    await page.getByRole('button', { name: '次へ' }).click();
    const weeklyNextButton = page.getByRole('button', { name: '次へ' });
    if (await weeklyNextButton.isVisible().catch(() => false)) {
      await weeklyNextButton.click();
    }
    await page.getByRole('button', { name: '確認へ進む' }).click();
    await page.getByLabel('利用規約を読み、同意します').check();
    await page.getByRole('button', { name: '回答を送信' }).click();
    await page.waitForURL(new RegExp(`/event/${answerEvent.publicToken}/input/complete`), {
      timeout: 10000,
    });

    // 回答送信だけでは既存のマイ予定を変更しない。
    await expect
      .poll(async () => {
        const row = await db.query<{ source: string; event_id: string | null }>(
          `select source,event_id from public.user_schedule_blocks
           where user_id=$1 and start_time='2099-05-10T03:00:00Z' and end_time='2099-05-10T04:00:00Z'`,
          [userId],
        );
        return row.rows[0] ?? null;
      })
      .toEqual({ source: 'manual', event_id: null });

    const saveScheduleButton = page.getByRole('button', { name: '保存する' });
    await expect(saveScheduleButton).toBeVisible();
    await saveScheduleButton.click();

    // 明示的な保存操作後にだけ、回答内容をマイ予定へ反映する。
    await expect
      .poll(async () => {
        const row = await db.query<{ source: string; event_id: string | null }>(
          `select source,event_id from public.user_schedule_blocks
           where user_id=$1 and start_time='2099-05-10T03:00:00Z' and end_time='2099-05-10T04:00:00Z'`,
          [userId],
        );
        return row.rows[0] ?? null;
      })
      .toEqual({ source: 'event', event_id: answerEvent.id });

    const skipSyncLink = page.getByRole('link', { name: '反映しない' });
    if (await skipSyncLink.isVisible({ timeout: 10000 }).catch(() => false)) {
      await skipSyncLink.click();
    } else if (
      await page
        .getByRole('link', { name: 'イベント結果を見る' })
        .isVisible({ timeout: 1500 })
        .catch(() => false)
    ) {
      await page.getByRole('link', { name: 'イベント結果を見る' }).click();
    }
    await page.waitForURL(new RegExp(`/event/${answerEvent.publicToken}`), { timeout: 10000 });

    await expect
      .poll(
        async () => {
          const participant = await db.query<{ id: string }>(
            'select id from public.participants where event_id=$1 and name=$2 order by created_at desc limit 1',
            [answerEvent.id, answerName],
          );
          return participant.rows[0]?.id ?? null;
        },
        { timeout: 10000 },
      )
      .not.toBeNull();
    const answeredParticipant = await db.query<{ id: string }>(
      'select id from public.participants where event_id=$1 and name=$2 order by created_at desc limit 1',
      [answerEvent.id, answerName],
    );
    const answeredParticipantId = answeredParticipant.rows[0]?.id;
    expect(answeredParticipantId).toBeTruthy();

    await expect
      .poll(
        async () => {
          const row = await db.query<{ availability: boolean }>(
            'select availability from public.availabilities where event_id=$1 and participant_id=$2 and event_date_id=$3',
            [answerEvent.id, answeredParticipantId, answerEvent.dateIds[0]],
          );
          return row.rows[0]?.availability ?? null;
        },
        { timeout: 10000 },
      )
      .toBe(true);

    await page.goto('/account', { waitUntil: 'domcontentloaded' });
    await dismissAccountTourIfVisible(page);
    const scheduleSettings = page.getByTestId('account-schedule-settings').first();
    await scheduleSettings.getByTestId('sync-check-button').click();

    const syncCard = scheduleSettings
      .getByTestId('schedule-sync-section')
      .locator('div')
      .filter({ hasText: syncEvent.title })
      .first();
    await expect(syncCard).toBeVisible();
    await expect(syncCard).toContainText('変更 1件');

    await scheduleSettings.getByTestId(`sync-apply-${syncEvent.id}`).click();
    await expect
      .poll(
        async () => {
          const row = await db.query<{ availability: boolean }>(
            'select availability from public.availabilities where event_id=$1 and participant_id=$2 and event_date_id=$3',
            [syncEvent.id, syncParticipantId, syncEvent.dateIds[0]],
          );
          return row.rows[0]?.availability ?? null;
        },
        { timeout: 10000 },
      )
      .toBe(true);

    await page.goto(`/event/${answerEvent.publicToken}/input/sync-review`, {
      waitUntil: 'domcontentloaded',
    });
    const answerEventUrlPattern = new RegExp(`/event/${answerEvent.publicToken}$`);
    await page.waitForURL(answerEventUrlPattern, { timeout: 3000 }).catch(async () => {
      const remainingSyncApplyButton = page.getByRole('button', { name: 'この変更を適用' }).first();
      await expect(remainingSyncApplyButton).toBeVisible({ timeout: 10000 });
      await remainingSyncApplyButton.click();
    });
    await page.waitForURL(answerEventUrlPattern, { timeout: 10000 });
  });
});
