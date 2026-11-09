import type { NextConfig } from 'next';
import { currentEnvironment } from './lib/env.ts';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
];

/**
 * Everywhere but the live site, search engines are asked to keep every address out of their
 * results (staging is public from step 1.5d, previews sit behind Vercel's login). robots.txt
 * also refuses their crawlers there (app/robots.ts). Read when the site is built, which is
 * when Vercel names the environment.
 */
const searchEnginesStayOut = currentEnvironment() !== 'production';

const config: NextConfig = {
  // The shared packages are TypeScript source, compiled as part of the website.
  transpilePackages: [
    '@hrizzup/core',
    '@hrizzup/api',
    '@hrizzup/agreement',
    '@hrizzup/db',
    '@hrizzup/ledger',
    '@hrizzup/market-engine',
    '@hrizzup/markets',
  ],
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  async headers() {
    const headers = searchEnginesStayOut
      ? [...securityHeaders, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
      : securityHeaders;
    return [{ source: '/:path*', headers }];
  },
};

export default config;
