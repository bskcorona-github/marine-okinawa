import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 写真・資料（1 回 4MB まで）を Server Action で受け取るため。multipart の区切りの分を足す
      // （Vercel の関数は送信の本文が 4.5MB までなので、これより大きくしても受け取れない）
      bodySizeLimit: '4.5mb',
    },
  },
  async redirects() {
    return [
      // 印刷物などに書いたロケールなしの URL でも、事業者の登録申請フォームを開けるようにする
      { source: '/partner/apply', destination: '/ja/partner/apply', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // ゲスト用の予約確認ページ：URL にトークンを含むため外部へ漏らさない
        source: '/:locale/bookings/:token*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
      {
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/partner/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
