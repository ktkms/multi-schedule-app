import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import siteConfig from '@/lib/site-config';
import { LayerMark, LogoBadge, OG_IMAGE_SIZE, palette, Shell } from './design';

async function getLocalLogoUrl() {
  const logo = await readFile(join(process.cwd(), 'public', siteConfig.ogImage));
  return 'data:image/png;base64,' + logo.toString('base64');
}

/** デプロイ時にトップページの共有画像を生成する。 */
export async function renderHomeOgImage(headline: string[], description: string) {
  const logoUrl = await getLocalLogoUrl();
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
            {headline.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
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
        </div>
        <LayerMark logoUrl={logoUrl} scale={0.86} offsetX={18} offsetY={28} />
      </div>
    </Shell>,
    OG_IMAGE_SIZE,
  );
}

/** ページ固有の案内を含まない共通の共有画像を生成する。 */
export async function renderBrandOgImage() {
  const logoUrl = await getLocalLogoUrl();

  return new ImageResponse(
    <Shell showDomain={false}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          ...OG_IMAGE_SIZE,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 26,
        }}
      >
        <LogoBadge logoUrl={logoUrl} size={152} />
        <span style={{ color: palette.primary, fontSize: 92, fontWeight: 900 }}>
          {siteConfig.name.full}
        </span>
      </div>
    </Shell>,
    OG_IMAGE_SIZE,
  );
}
