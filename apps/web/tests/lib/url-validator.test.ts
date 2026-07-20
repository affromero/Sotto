/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

vi.mock('dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

import { safeFetch, UrlValidationError } from '@/lib/url-validator';

describe('safeFetch', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects direct requests to private IPs', async () => {
    await expect(safeFetch('http://127.0.0.1/')).rejects.toThrow(UrlValidationError);
  });

  it('rejects redirect to internal IP', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }),
    });

    await expect(safeFetch('https://example.com/redirect')).rejects.toThrow(UrlValidationError);
  });

  it('follows safe redirects to valid public URLs', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'https://example.com/final' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        ok: true,
      });
    globalThis.fetch = mockFetch;

    const response = await safeFetch('https://example.com/start');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects after exceeding max redirects', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'https://example.com/loop' }),
    });

    await expect(safeFetch('https://example.com/start')).rejects.toThrow('Too many redirects');
  });

  it('resolves relative Location headers against current URL', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: '/page2' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        ok: true,
      });
    globalThis.fetch = mockFetch;

    const response = await safeFetch('https://example.com/page1');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.com/page2',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('passes through non-redirect responses directly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      ok: true,
    });

    const response = await safeFetch('https://example.com/page');

    expect(response.status).toBe(200);
  });

  it('passes through 4xx/5xx responses without following redirects', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      headers: new Headers(),
      ok: false,
    });

    const response = await safeFetch('https://example.com/not-found');

    expect(response.status).toBe(404);
  });

  it('forwards init options to fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      ok: true,
    });
    globalThis.fetch = mockFetch;

    await safeFetch('https://example.com/', {
      method: 'HEAD',
      headers: { 'User-Agent': 'TestBot/1.0' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({
        method: 'HEAD',
        headers: { 'User-Agent': 'TestBot/1.0' },
        redirect: 'manual',
      })
    );
  });
});
