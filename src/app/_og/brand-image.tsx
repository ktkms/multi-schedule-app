import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import type { ReactNode } from 'react';
import siteConfig from '@/lib/site-config';
import { LayerMark, OG_IMAGE_SIZE, palette, Shell } from './design';

/** デプロイ時に共有画像を生成する。ロゴはビルドに含まれるファイルを使う。 */
export async function renderBrandOgImage(headline?: ReactNode, description?: string) {
  const logo = await readFile(join(process.cwd(), 'public', siteConfig.ogImage));
  const logoUrl = 'data:image/png;base64,' + logo.toString('base64');
  return new ImageResponse(
    <Shell>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          gap: 48,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', width: 760 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 34,
            }}
          >
            <span
              style={{
                color: palette.primary,
                fontSize: 116,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              {siteConfig.name.full}
            </span>
          </div>
          {headline && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                color: palette.ink,
                fontSize: 74,
                fontWeight: 900,
                lineHeight: 1.07,
                margin: 0,
              }}
            >
              {headline}
            </div>
          )}
          {description && (
            <p
              style={{
                color: palette.muted,
                fontSize: 31,
                fontWeight: 700,
                lineHeight: 1.4,
                margin: '26px 0 0',
              }}
            >
              {description}
            </p>
          )}
        </div>
        <LayerMark logoUrl={logoUrl} scale={0.86} offsetX={18} offsetY={28} />
      </div>
    </Shell>,
    OG_IMAGE_SIZE,
  );
}
