import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { dateFirstCommandSchema } from '../src/lib/date-first-schema';

test.skip(process.env.ENABLE_DATE_FIRST_SCHEDULING !== 'true', '隔離環境だけで実行する');

test('Server ActionのJSON・multipart本文で767/768/769KiBを検証する', async ({ page }) => {
  test.setTimeout(120000);
  const url = new URL(process.env.SUPABASE_DB_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/daysynth_date_first_review'
  )
    throw new Error('専用の隔離DBだけで実行してください');
  const db = new Client({ connectionString: url.href });
  await db.connect();
  try {
    const event = (
      await db.query('SELECT date_first.create_event($1,$2::jsonb) AS value', [
        randomUUID(),
        JSON.stringify({ title: '本文境界の検証', days: ['2096-11-07'] }),
      ])
    ).rows[0].value;
    const day = (
      await db.query('SELECT id FROM event_candidate_days WHERE event_id=$1', [event.id])
    ).rows[0].id;
    await page.goto(`/event/${event.token}/input`);
    await page.getByTestId('date-first-answer-name').fill('境界確認');
    await page.getByTestId(`day-${day}-yes`).click();
    await page.getByLabel(/利用規約/).check();
    await page.getByTestId('date-first-answer-review').click();
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && Boolean(r.headers()['next-action'])),
      page.getByRole('dialog').getByRole('button', { name: 'この内容で保存', exact: true }).click(),
    ]);
    await expect(page.getByTestId('answer-complete-page')).toBeVisible();
    const participant = (
      await db.query('SELECT id FROM participants WHERE event_id=$1', [event.id])
    ).rows[0].id;
    for (const encoding of ['json', 'multipart']) {
      for (const kib of [767, 768, 769]) {
        const changes = Array.from({ length: 90 }, (_, i) => ({
          id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
          status: 'maybe',
          intervals: Array.from({ length: 800 }, () => [0, 1800]),
          comment: '',
        }));
        const command = {
          operation: 'saveDays',
          token: event.token,
          participantId: participant,
          revision: '1',
          changes,
        };
        let remaining = kib * 1024 - Buffer.byteLength(JSON.stringify(command));
        for (const change of changes) {
          const count = Math.min(2000, remaining);
          change.comment = 'a'.repeat(count);
          remaining -= count;
        }
        expect(remaining).toBe(0);
        expect(Buffer.byteLength(JSON.stringify(dateFirstCommandSchema.parse(command)))).toBe(
          kib * 1024,
        );
        const headers = {
          'next-action': request.headers()['next-action'],
          Origin: new URL(page.url()).origin,
        };
        const body = JSON.stringify([command]);
        const response = await page.request.post(
          request.url(),
          encoding === 'json'
            ? { headers: { ...headers, 'Content-Type': 'text/plain;charset=UTF-8' }, data: body }
            : { headers, multipart: { '0': body } },
        );
        expect(response.status()).toBe(200);
        // 上限内ではDBの対象照合まで進み、上限超過ではその前に拒否する。
        expect(await response.text()).toContain(
          kib <= 768 ? 'invalid_event_scope' : 'limit_exceeded',
        );
      }
    }
    expect(
      (await db.query('SELECT day_answers_revision FROM participants WHERE id=$1', [participant]))
        .rows[0].day_answers_revision,
    ).toBe('1');
  } finally {
    await db.end();
  }
});
