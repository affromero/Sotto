import { logger } from './logger';

/** Status codes that indicate a transient server-side problem worth retrying. */
export const RETRYABLE_STATUS = new Set([429, 500, 503, 529]);
export const MAX_RETRIES = 3;

export function isRetryableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    RETRYABLE_STATUS.has((err as { status: number }).status)
  );
}

/**
 * Compute retry delay based on error type and context.
 * Workers: 429 → 30s/60s/90s (waits for per-minute TPM window to reset).
 * API routes: 429 → 1s/2s/4s (same as server errors — can't hang HTTP requests).
 * Server errors (500/503/529): always 1s/2s/4s.
 */
function getRetryDelay(status: number, attempt: number, longBackoff: boolean): number {
  if (status === 429 && longBackoff) {
    return 30_000 * (attempt + 1) + Math.random() * 5_000;
  }
  return 1000 * Math.pow(2, attempt) + Math.random() * 500;
}

export interface RetryOptions {
  /** Use long backoff (30s/60s/90s) for 429 rate limits. Default: false. */
  longBackoff?: boolean;
}

/**
 * Retry a function with backoff on transient HTTP errors (429, 500, 503, 529).
 * By default uses short delays (1s/2s/4s) safe for API routes.
 * Pass { longBackoff: true } in worker contexts to wait for TPM window resets.
 */
export async function withRetry<T>(label: string, fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err) || attempt === MAX_RETRIES) throw err;
      const status = (err as { status?: number }).status ?? 0;
      const delayMs = getRetryDelay(status, attempt, opts?.longBackoff ?? false);
      logger.warn(`${label} — transient error, retrying`, {
        attempt: String(attempt + 1),
        status: String(status),
        delayMs: String(Math.round(delayMs)),
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}
