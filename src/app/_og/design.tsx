/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from 'react';
import siteConfig from '@/lib/site-config';

export const OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
} as const;

export const palette = {
  ink: '#14213d',
  muted: '#4f6078',
  surface: '#f8fafc',
  panel: '#ffffff',
  border: 'rgba(79, 96, 120, 0.14)',
  primary: '#4f46e5',
  primarySoft: '#e0e7ff',
  mint: '#14b8a6',
  mintSoft: '#ccfbf1',
  amber: '#f59e0b',
} as const;

/**
 * サービスURLから表示用ドメインを取得する
 *
 * @returns {string} プロトコルと末尾スラッシュを除いたドメイン
 */
function getServiceDomain() {
  return siteConfig.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function LogoBadge({ logoUrl, size = 108 }: { logoUrl: string; size?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 28,
        background: palette.panel,
        border: `1px solid ${palette.border}`,
        boxShadow: '0 24px 60px rgba(20, 33, 61, 0.14)',
      }}
    >
      <img
        src={logoUrl}
        alt="DaySynthロゴ"
        width={Math.round(size * 0.72)}
        height={Math.round(size * 0.72)}
        style={{ borderRadius: 20 }}
      />
    </div>
  );
}

export function LayerMark({
  logoUrl,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
}: {
  logoUrl: string;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: 340 * scale,
        height: 300 * scale,
        transform: `translate(${offsetX}px, ${offsetY}px)`,
      }}
    >
      {[
        {
          top: 28 * scale,
          left: 52 * scale,
          width: 210 * scale,
          height: 210 * scale,
          background: palette.primarySoft,
          opacity: 0.95,
        },
        {
          top: 76 * scale,
          left: 112 * scale,
          width: 210 * scale,
          height: 210 * scale,
          background: palette.mintSoft,
          opacity: 0.86,
        },
        {
          top: 132 * scale,
          left: 18 * scale,
          width: 210 * scale,
          height: 140 * scale,
          background: 'rgba(245, 158, 11, 0.22)',
          opacity: 0.9,
        },
      ].map((shape, index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            borderRadius: 34 * scale,
            boxShadow: '0 26px 70px rgba(20, 33, 61, 0.12)',
            ...shape,
          }}
        />
      ))}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 112 * scale,
          left: 116 * scale,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LogoBadge logoUrl={logoUrl} size={118 * scale} />
      </div>
    </div>
  );
}

export function Shell({
  children,
  showDomain = true,
}: {
  children: ReactNode;
  showDomain?: boolean;
}) {
  return (
    <div
      style={{
        width: `${OG_IMAGE_SIZE.width}px`,
        height: `${OG_IMAGE_SIZE.height}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        padding: '70px 84px 54px 92px',
        fontFamily: '"Noto Sans JP", "Inter", "Segoe UI", Arial, sans-serif',
        background: palette.surface,
        color: palette.ink,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          background:
            'linear-gradient(120deg, rgba(248,250,252,1) 0%, rgba(248,250,252,0.96) 58%, rgba(224,231,255,0.76) 100%)',
        }}
      />
      {children}
      {showDomain && (
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            justifyContent: 'flex-end',
            color: palette.muted,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {getServiceDomain()}
        </div>
      )}
    </div>
  );
}
