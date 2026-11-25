import { renderBrandOgImage } from '../../_og/brand-image';

export const dynamic = 'force-static';

export function GET() {
  return renderBrandOgImage();
}
