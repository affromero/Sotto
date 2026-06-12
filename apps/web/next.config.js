const path = require('path');
const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Per-instance build dir, so two dev servers (e.g. the self-hosted instance and
  // the SELF_HOSTED=false mock) can run side by side without fighting over .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    proxyClientMaxBodySize: '150mb',
    viewTransition: true,
  },
  transpilePackages: [
    'next-auth',
    '@auth/prisma-adapter',
    '@auth/core',
    '@sotto/shared',
    '@sotto/verification-standard',
    '@sotto/maps',
  ],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  images: {
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.r2.dev',
      },
      {
        protocol: 'https',
        hostname: '**.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
    ],
  },
  async redirects() {
    return [];
  },
  async rewrites() {
    return [
      {
        source: '/@:handle/:slug/embed',
        destination: '/episode/by-slug/:handle/:slug/embed',
      },
      {
        source: '/@:handle/:slug',
        destination: '/episode/by-slug/:handle/:slug',
      },
    ];
  },
  async headers() {
    // React/Next dev mode requires eval() (source maps, fast refresh, error
    // overlays). Allow 'unsafe-eval' in development ONLY — production stays strict.
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://js.stripe.com`;
    const connectSrc = `connect-src 'self' https:${isDev ? ' ws: wss:' : ''}`;

    const defaultCsp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      connectSrc,
      "media-src 'self' data: https: blob:",
      "frame-src 'self' https://js.stripe.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    const embedCsp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      connectSrc,
      "media-src 'self' data: https: blob:",
      "frame-src 'self' https://js.stripe.com",
      'frame-ancestors *',
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    const permissionsPolicy = [
      'camera=()',
      'microphone=(self)',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'autoplay=(self)',
      'fullscreen=(self)',
      'picture-in-picture=(self)',
      'screen-wake-lock=(self)',
      'interest-cohort=()',
      'browsing-topics=()',
      'run-ad-auction=()',
      'join-ad-interest-group=()',
    ].join(', ');

    // Order matters: when multiple patterns match, last entry's values win
    // for duplicate header keys. So: API → catch-all → embed (most specific last).
    return [
      {
        source: '/api/v1/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, nosnippet' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: defaultCsp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: permissionsPolicy },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        source: '/@:handle/:slug/embed',
        headers: [
          { key: 'Content-Security-Policy', value: embedCsp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: permissionsPolicy },
        ],
      },
      {
        source: '/episode/:episodeId/embed',
        headers: [
          { key: 'Content-Security-Policy', value: embedCsp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: permissionsPolicy },
        ],
      },
    ];
  },
};

module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  tunnelRoute: '/api/v1/monitoring',
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
