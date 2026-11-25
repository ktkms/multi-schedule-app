import { renderHomeOgImage } from '../../_og/brand-image';

export const dynamic = 'force-static';

export function GET() {
  return renderHomeOgImage(
    ['みんなの予定が、', 'すぐ決まる。'],
    '候補を作って、リンクを送るだけ。',
  );
}
