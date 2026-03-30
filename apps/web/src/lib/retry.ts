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
 * Compute retry delay based on error type.
 * 429 (rate limit): 30s, 60s, 90s — waits for the per-minute TPM window to reset.
 * 500/503/529 (server errors): 1s, 2s, 4s — short backoff for transient failures.
 */
function getRetryDelay(status: number, attempt: number): number {
  if (status === 429) {
    return 30_000 * (attempt + 1) + Math.random() * 5_000;
  }
  return 1000 * Math.pow(2, attempt) + Math.random() * 500;
}

/**
 * Retry a function with backoff on transient HTTP errors (429, 500, 503, 529).
 * Rate limits (429) use longer delays (30s/60s/90s) to let per-minute quotas reset.
 * Server errors (500/503/529) use short exponential backoff (1s/2s/4s).
 */
export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err) || attempt === MAX_RETRIES) throw err;
      const status = (err as { status?: number }).status ?? 0;
      const delayMs = getRetryDelay(status, attempt);
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
