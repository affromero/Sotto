import * as Sentry from '@sentry/nextjs';
import { sentryCompatibilityOptions } from './src/lib/sentry/options';

Sentry.init({
  ...sentryCompatibilityOptions,
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
