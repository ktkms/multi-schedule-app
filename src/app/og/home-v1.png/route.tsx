import { renderBrandOgImage } from '../../_og/brand-image';

export const dynamic = 'force-static';

export function GET() {
  return renderBrandOgImage(
    <>
      <span>みんなの予定が、</span>
      <span>すぐ決まる。</span>
    </>,
    '候補を作って、リンクを送るだけ。',
  );
}
