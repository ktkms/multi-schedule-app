// デザインを更新した際は対応する画像URLの版も更新する。
const size = { width: 1200, height: 630 } as const;

export const HOME_OG_IMAGE = { url: '/og/home-v1.png', ...size };
export const BRAND_OG_IMAGE = { url: '/og/brand-v1.png', ...size };

/** 詳細ページと回答ページで同じイベント画像を参照する。 */
export function getEventOgImage(title: string) {
  return { url: '/api/og?type=event&title=' + encodeURIComponent(title), ...size };
}
