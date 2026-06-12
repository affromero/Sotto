/**
 * POST /api/v1/onboarding/check-local-speech — server-side connectivity check
 * for the welcome wizard's local TTS/STT selections. Tests the same local
 * contracts generation will use, so the UI can block on a real green light.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/v1/onboarding/check-local-speech/route';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/onboarding/check-local-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/onboarding/check-local-speech', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects unauthenticated checks', async () => {
    mockAuth.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(req({ tts: { provider: 'local' }, stt: { provider: 'local' } }));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks selected local TTS and STT endpoints with the default split ports', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'http://localhost:8000/health') {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (url === 'http://localhost:8000/voices') {
        return new Response(JSON.stringify({ voices: [{ id: 'af_heart' }] }), { status: 200 });
      }
      if (url === 'http://localhost:8000/tts') {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        });
      }
      if (url === 'http://localhost:8001/v1/audio/transcriptions') {
        return new Response(JSON.stringify({ text: '' }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(req({ tts: { provider: 'local' }, stt: { provider: 'local' } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      checks: [
        { id: 'tts', url: 'http://localhost:8000', ok: true },
        { id: 'stt', url: 'http://localhost:8001/v1', ok: true },
      ],
    });
  });

  it('fails STT endpoints that omit the OpenAI-compatible /v1 base path', async () => {
    const res = await POST(
      req({
        tts: { provider: 'openai' },
        stt: { provider: 'local', baseUrl: 'http://localhost:8001' },
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: false,
      checks: [
        {
          id: 'stt',
          ok: false,
          detail: 'Use an OpenAI-compatible base URL that includes /v1.',
        },
      ],
    });
  });
});
