import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { withRetry, isRetryableError, RETRYABLE_STATUS } from '@/lib/retry';

describe('retry', () => {
  // Stub setTimeout to resolve immediately in all withRetry tests
  let origSetTimeout: typeof globalThis.setTimeout;

  beforeEach(() => {
    origSetTimeout = globalThis.setTimeout;

    globalThis.setTimeout = ((fn: () => void) => origSetTimeout(fn, 0)) as any;
  });

  afterEach(() => {
    globalThis.setTimeout = origSetTimeout;
  });

  describe('isRetryableError', () => {
    it('returns true for 429 rate limit errors', () => {
      const err = Object.assign(new Error('Rate limited'), { status: 429 });
      expect(isRetryableError(err)).toBe(true);
    });

    it('returns true for all retryable status codes', () => {
      for (const status of [429, 500, 503, 529]) {
        const err = Object.assign(new Error('fail'), { status });
        expect(isRetryableError(err)).toBe(true);
      }
    });

    it('returns false for non-retryable status codes', () => {
      const err = Object.assign(new Error('Not found'), { status: 404 });
      expect(isRetryableError(err)).toBe(false);
    });

    it('returns false for errors without a status', () => {
      expect(isRetryableError(new Error('generic'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(isRetryableError('string')).toBe(false);
      expect(isRetryableError(null)).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await withRetry('test', fn);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 rate limit and succeeds', async () => {
      const err429 = Object.assign(new Error('Rate limited'), { status: 429 });
      const fn = vi.fn().mockRejectedValueOnce(err429).mockResolvedValueOnce('recovered');

      const result = await withRetry('test', fn);
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 server error and succeeds', async () => {
      const err500 = Object.assign(new Error('Server error'), { status: 500 });
      const fn = vi.fn().mockRejectedValueOnce(err500).mockResolvedValueOnce('recovered');

      const result = await withRetry('test', fn);
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws immediately on non-retryable errors', async () => {
      const err404 = Object.assign(new Error('Not found'), { status: 404 });
      const fn = vi.fn().mockRejectedValue(err404);

      await expect(withRetry('test', fn)).rejects.toThrow('Not found');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting all retries', async () => {
      const err429 = Object.assign(new Error('Rate limited'), { status: 429 });
      const fn = vi.fn().mockRejectedValue(err429);

      await expect(withRetry('test', fn)).rejects.toThrow('Rate limited');
      // 1 initial + 3 retries = 4 calls
      expect(fn).toHaveBeenCalledTimes(4);
    });
  });

  describe('RETRYABLE_STATUS', () => {
    it('contains expected status codes', () => {
      expect(RETRYABLE_STATUS.has(429)).toBe(true);
      expect(RETRYABLE_STATUS.has(500)).toBe(true);
      expect(RETRYABLE_STATUS.has(503)).toBe(true);
      expect(RETRYABLE_STATUS.has(529)).toBe(true);
      expect(RETRYABLE_STATUS.has(400)).toBe(false);
    });
  });
});
