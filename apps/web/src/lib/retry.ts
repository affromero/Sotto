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
 * Retry a function with exponential backoff on transient HTTP errors (429, 500, 503, 529).
 * Delays: ~1s, ~2s, ~4s (plus jitter).
 */
export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err) || attempt === MAX_RETRIES) throw err;
      const delayMs = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      logger.warn(`${label} — transient error, retrying`, {
        attempt: String(attempt + 1),
        status: String((err as { status?: number }).status),
        delayMs: String(Math.round(delayMs)),
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}
