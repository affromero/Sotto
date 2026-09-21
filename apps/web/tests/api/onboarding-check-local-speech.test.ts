/**
 * POST /api/v1/onboarding/check-local-speech — server-side connectivity check
 * for the welcome wizard's local TTS/STT selections. Tests the same local
 * contracts generation will use, so the UI can block on a real green light.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';
const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});

import { POST } from '@/app/api/v1/onboarding/check-local-speech/route';

function req(body: unknown, token?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/onboarding/check-local-speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { cookie: `sotto_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('POST /api/v1/onboarding/check-local-speech', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('speech_checks');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });

  it('rejects unauthenticated checks', async () => {
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

    const res = await POST(
      req({ tts: { provider: 'local' }, stt: { provider: 'local' } }, identity.ownerToken)
    );

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
      req(
        {
          tts: { provider: 'openai' },
          stt: { provider: 'local', baseUrl: 'http://localhost:8001' },
        },
        identity.ownerToken
      )
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
