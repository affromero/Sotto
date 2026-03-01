import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger to avoid noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('pinchtab client', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = process.env;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    // Reset modules so env changes take effect
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('isPinchtabAvailable', () => {
    it('returns true when PINCHTAB_URL is set', async () => {
      process.env.PINCHTAB_URL = 'http://localhost:9867';
      const { isPinchtabAvailable } = await import('@/lib/extractors/pinchtab');
      expect(isPinchtabAvailable()).toBe(true);
    });

    it('returns false when PINCHTAB_URL is not set', async () => {
      delete process.env.PINCHTAB_URL;
      const { isPinchtabAvailable } = await import('@/lib/extractors/pinchtab');
      expect(isPinchtabAvailable()).toBe(false);
    });
  });

  describe('extractViaPinchtab', () => {
    it('navigates then extracts text content', async () => {
      process.env.PINCHTAB_URL = 'http://localhost:9867';
      const { extractViaPinchtab } = await import('@/lib/extractors/pinchtab');

      fetchSpy
        .mockResolvedValueOnce(new Response('{}', { status: 200 })) // /navigate
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ text: 'Extracted article content here' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        ); // /text

      const result = await extractViaPinchtab('https://example.com/spa');

      expect(result).toBe('Extracted article content here');
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Verify /navigate call
      const navCall = fetchSpy.mock.calls[0];
      expect(navCall[0]).toBe('http://localhost:9867/navigate');
      expect(navCall[1]?.method).toBe('POST');
      expect(JSON.parse(navCall[1]?.body as string)).toEqual({ url: 'https://example.com/spa' });

      // Verify /text call
      const textCall = fetchSpy.mock.calls[1];
      expect(textCall[0]).toBe('http://localhost:9867/text');
    });

    it('sends Bearer auth header when PINCHTAB_TOKEN is set', async () => {
      process.env.PINCHTAB_URL = 'http://localhost:9867';
      process.env.PINCHTAB_TOKEN = 'my-secret-token';
      const { extractViaPinchtab } = await import('@/lib/extractors/pinchtab');

      fetchSpy
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ text: 'content' }), { status: 200 })
        );

      await extractViaPinchtab('https://example.com');

      const navHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(navHeaders['Authorization']).toBe('Bearer my-secret-token');

      const textHeaders = fetchSpy.mock.calls[1][1]?.headers as Record<string, string>;
      expect(textHeaders['Authorization']).toBe('Bearer my-secret-token');
    });

    it('throws when /navigate returns HTTP error', async () => {
      process.env.PINCHTAB_URL = 'http://localhost:9867';
      const { extractViaPinchtab } = await import('@/lib/extractors/pinchtab');

      fetchSpy.mockResolvedValueOnce(
        new Response('Navigation failed', { status: 500, statusText: 'Internal Server Error' })
      );

      await expect(extractViaPinchtab('https://example.com')).rejects.toThrow(
        'Pinchtab /navigate failed: HTTP 500'
      );
    });

    it('throws when /text returns HTTP error', async () => {
      process.env.PINCHTAB_URL = 'http://localhost:9867';
      const { extractViaPinchtab } = await import('@/lib/extractors/pinchtab');

      fetchSpy
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(
          new Response('Text extraction failed', { status: 502, statusText: 'Bad Gateway' })
        );

      await expect(extractViaPinchtab('https://example.com')).rejects.toThrow(
        'Pinchtab /text failed: HTTP 502'
      );
    });

    it('throws when /text returns empty content', async () => {
      process.env.PINCHTAB_URL = 'http://localhost:9867';
      const { extractViaPinchtab } = await import('@/lib/extractors/pinchtab');

      fetchSpy
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ text: '' }), { status: 200 })
        );

      await expect(extractViaPinchtab('https://example.com')).rejects.toThrow(
        'Pinchtab /text returned empty content'
      );
    });

    it('throws when PINCHTAB_URL is not configured', async () => {
      delete process.env.PINCHTAB_URL;
      const { extractViaPinchtab } = await import('@/lib/extractors/pinchtab');

      await expect(extractViaPinchtab('https://example.com')).rejects.toThrow(
        'PINCHTAB_URL not configured'
      );
    });

    it('throws on network error', async () => {
      process.env.PINCHTAB_URL = 'http://localhost:9867';
      const { extractViaPinchtab } = await import('@/lib/extractors/pinchtab');

      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(extractViaPinchtab('https://example.com')).rejects.toThrow(
        'Connection refused'
      );
    });
  });
});
