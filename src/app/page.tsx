import { HOME_OG_IMAGE } from '@/lib/og-metadata';
import HeroSection from '@/components/landing/hero-section';
import LandingPage from '@/components/landing/landing-page';
import siteConfig from '@/lib/site-config';

export const metadata = {
  title: siteConfig.share.homeTitle,
  description: siteConfig.share.homeDescription,
  openGraph: {
    title: siteConfig.share.homeTitle,
    description: siteConfig.share.homeDescription,
    url: siteConfig.url,
    images: [HOME_OG_IMAGE],
  },
};

/**
 * ランディングページ
 * - サーバーコンポーネントとして実装
 * - metadataを設定し、静的なLP本文はサーバーコンポーネントで描画する
 */
export default function HomePage() {
  return (
    <>
      <HeroSection />
      <LandingPage />
    </>
  );
}
