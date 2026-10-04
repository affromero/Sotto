import type { NodeOptions } from '@sentry/node';

/** Preserve the Sentry 10 privacy and tracing defaults during the SDK upgrade. */
export const sentryCompatibilityOptions = {
  traceLifecycle: 'static',
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
    },
    httpBodies: [],
    urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
    frameContextLines: 7,
  },
} satisfies Pick<NodeOptions, 'traceLifecycle' | 'dataCollection'>;
