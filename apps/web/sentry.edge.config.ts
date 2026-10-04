import * as Sentry from '@sentry/nextjs';
import { sentryCompatibilityOptions } from './src/lib/sentry/options';

Sentry.init({
  ...sentryCompatibilityOptions,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});
