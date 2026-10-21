// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createReviewTransport } from '../../../../../scripts/deploy/review/runtime/transport';

function fixture() {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
  const transport = createReviewTransport({
    endpoint: 'http://127.0.0.1:43123/',
    signal: controller.signal,
    fetch: fetcher,
    fail: () => {
      throw new Error('Private review transport refused');
    },
    admitResource: (path, method) =>
      method === 'GET' && ['/api/v1/users/me', '/api/v1/courses?limit=1'].includes(path),
  });
  return { transport, fetcher, controller };
}

describe('candidate-only review transport', () => {
  it('keeps secure review cookies and selected identity on the admitted candidate', async () => {
    const server = fixture();
    server.fetcher.mockResolvedValueOnce(
      Response.json(
        { ok: true },
        {
          headers: { 'Set-Cookie': 'sotto_session=private-cookie; Secure; HttpOnly; Path=/' },
        }
      )
    );
    await server.transport.request('/api/v1/users/me');
    server.transport.selectProfile('profile-one');
    await server.transport.request('/api/v1/courses?limit=1');
    server.transport.selectProfile('profile-two');
    await server.transport.request('/api/v1/users/me');
    const [destination, init] = server.fetcher.mock.calls.at(-1)!;
    expect(String(destination)).toBe('http://127.0.0.1:43123/api/v1/users/me');
    const headers = new Headers(init?.headers);
    expect(headers.get('Cookie')).toBe('sotto_session=private-cookie');
    expect(headers.get('X-Sotto-Expected-Profile-Id')).toBe('profile-two');
    expect(headers.get('Origin')).toBe('https://demo.sotto.fm');
    expect(headers.get('X-Sidedoor-Origin')).toBe('https://demo.sotto.fm');
    expect(headers.has('Host')).toBe(false);
    expect(init).toMatchObject({ redirect: 'error', cache: 'no-store' });
  });

  it('rejects foreign, normalized, unadmitted and differently shaped requests before dispatch', async () => {
    const server = fixture();
    for (const path of [
      'https://example.com/api/v1/users/me',
      '//example.com/api/v1/users/me',
      '/api/v1/../users/me',
      '/api/v1/users/me#secret',
      '/api/v1/users\\me',
      '/api/v1/courses?limit=2',
      '/api/v1/admin',
    ])
      await expect(server.transport.fetch(path)).rejects.toThrow('transport refused');
    await expect(server.transport.fetch('/api/v1/users/me', { method: 'POST' })).rejects.toThrow(
      'transport refused'
    );
    await expect(
      server.transport.fetch('/api/v1/users/me', { headers: { Host: 'demo.sotto.fm' } })
    ).rejects.toThrow('transport refused');
    await expect(
      server.transport.fetch(new Request('http://127.0.0.1:43123/api/v1/users/me'))
    ).rejects.toThrow('transport refused');
    expect(server.fetcher).not.toHaveBeenCalled();
  });

  it('rejects path normalization even when the caller admits the raw path', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const transport = createReviewTransport({
      endpoint: 'http://127.0.0.1:43123/',
      signal: new AbortController().signal,
      fetch: fetcher,
      fail: () => {
        throw new Error('Private review transport refused');
      },
      admitResource: () => true,
    });
    for (const path of ['/api/v1/../users/me', '/api/v1/%2e%2e/users/me'])
      await expect(transport.fetch(path)).rejects.toThrow('transport refused');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects changed response destinations and oversized bodies', async () => {
    const server = fixture();
    const redirected = Response.json({ ok: true });
    Object.defineProperty(redirected, 'url', { value: 'https://example.com/api/v1/users/me' });
    server.fetcher.mockResolvedValueOnce(redirected);
    await expect(server.transport.request('/api/v1/users/me')).rejects.toThrow('transport refused');
    server.fetcher.mockResolvedValueOnce(new Response(new Uint8Array(1024 * 1024 + 1)));
    await expect(server.transport.request('/api/v1/users/me')).rejects.toThrow();
  });

  it('stops aborted requests before dispatch and surfaces uncertain responses', async () => {
    const server = fixture();
    server.fetcher.mockRejectedValueOnce(new TypeError('private uncertain response'));
    await expect(server.transport.fetch('/api/v1/users/me')).rejects.toThrow('uncertain response');
    server.controller.abort();
    server.fetcher.mockClear();
    await expect(server.transport.fetch('/api/v1/users/me')).rejects.toThrow();
    expect(server.fetcher).not.toHaveBeenCalled();
  });
});
