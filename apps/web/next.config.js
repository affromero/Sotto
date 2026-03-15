const path = require('path');
const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    proxyClientMaxBodySize: '150mb',
    viewTransition: true,
  },
  transpilePackages: ['next-auth', '@auth/prisma-adapter', '@auth/core', '@sotto/shared', '@sottofm/verification-standard', '@sotto/maps'],
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
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
      },
      {
        protocol: 'https',
        hostname: 'ui-avatars.com',
      },
    ],
  },
  async redirects() {
    return [
      { source: '/profile/handle/:handle', destination: '/@:handle', permanent: true },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/@:handle/:slug/embed',
        destination: '/podcast/by-slug/:handle/:slug/embed',
      },
      {
        source: '/@:handle/:slug',
        destination: '/podcast/by-slug/:handle/:slug',
      },
      {
        source: '/@:handle',
        destination: '/profile/handle/:handle',
      },
    ];
  },
  async headers() {
    const defaultCsp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https:",
      "media-src 'self' data: https: blob:",
      "frame-src 'self' https://js.stripe.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    const embedCsp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https:",
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
        source: '/api/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, nosnippet' },
        ],
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
        source: '/podcast/:podcastId/embed',
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
  tunnelRoute: '/api/monitoring',
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
