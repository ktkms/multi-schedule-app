import { test, expect } from '@playwright/test';

test.describe('OG画像API', () => {
  test('公開ページの共有画像が正しいサイズで配信される', async ({ request }) => {
    for (const [page, image] of [
      ['/', '/og/home-v1.png'],
      ['/create', '/og/brand-v1.png'],
      ['/privacy', '/og/brand-v1.png'],
      ['/terms', '/og/brand-v1.png'],
    ]) {
      const html = await request.get(page);
      expect(html.ok()).toBe(true);
      expect(await html.text()).toMatch(
        new RegExp('property="og:image" content="[^"]*' + image.replace('.', '\\.') + '"'),
      );

      const response = await request.get(image);
      expect(response.ok()).toBe(true);
      expect(response.headers()['content-type']).toBe('image/png');
      const png = await response.body();
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    }
  });

  test('旧トップ画像URLと既定値は静的画像へリダイレクトする', async ({ request }) => {
    for (const path of ['/api/og?type=home', '/api/og', '/api/og?type=unknown']) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toBe('/og/home-v1.png');
    }
  });

  test('イベント用OG画像が生成される（dateパラメータなし）', async ({ request }) => {
    const title = encodeURIComponent('テストイベント');
    const res = await request.get(`/api/og?type=event&title=${title}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/');
    const buf = await res.body();
    expect(buf.byteLength).toBeGreaterThan(1000);
  });
});
