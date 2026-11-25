import { renderBrandOgImage } from '../../_og/brand-image';

export const dynamic = 'force-static';

export function GET() {
  return renderBrandOgImage(
    ['みんなの予定が、', 'すぐ決まる。'],
    '候補を作って、リンクを送るだけ。',
  );
}
