import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  // PGlite(wasm)·postgres 는 서버 번들에 넣지 않고 node_modules 에서 읽는다
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  poweredByHeader: false,
  // 빌드 서버(미국)와 운영 DB(서울)가 멀다 — 공개 화면 미리 만들기가 60초 기본값에 걸리지 않게 여유를 둔다
  staticPageGenerationTimeout: 180,
  outputFileTracingIncludes: { '/**': ['./src/assets/og/**'] },
  typedRoutes: false,
  images: { unoptimized: true },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'radix-ui'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default withNextIntl(config);
