// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { getSttProviderMeta } from '@/lib/providers/stt-registry';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null, token: '' }));
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('openai') };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (boundary.token ? { value: boundary.token } : undefined) }),
}));

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('owner model testing with canonical credentials and actual provider transports', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let route: typeof import('@/app/api/v1/admin/test-model/route');
  let completion: string;
  let transcript: string;
  let requests: Request[];
  beforeAll(async () => {
    instance = await createSharedTestInstance('admin_model');
    boundary.database = instance.database;
    route = await import('@/app/api/v1/admin/test-model/route');
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    identity = await instance.reset();
    await instance.configureInfrastructure({
      aiProvider: 'openai',
      aiModel: getAiProviderMeta('openai').defaultModel,
      ttsProvider: 'openai',
      ttsBaseUrl: 'http://local-tts.example',
      sttProvider: 'openai',
      sttModel: getSttProviderMeta('openai').defaultModel,
    });
    await instance.seedAiCredential(identity.ownerId, 'openai', 'owner-key');
    await instance.seedProfileCredential(identity.ownerId, 'tts', 'openai', {
      apiKey: 'owner-key',
    });
    boundary.token = identity.ownerToken;
    completion = 'Hello';
    transcript = 'Hello world';
    requests = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      const url = new URL(request.url);
      if (url.pathname === '/v1/chat/completions')
        return Response.json({
          id: 'chat-test',
          object: 'chat.completion',
          model: getAiProviderMeta('openai').defaultModel,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: completion },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        });
      if (url.pathname === '/v1/audio/speech' || url.pathname === '/tts')
        return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2]), {
          headers: { 'content-type': 'audio/mpeg' },
        });
      if (url.pathname === '/v1/audio/transcriptions')
        return Response.json({ text: transcript, language: 'en', duration: 1, words: [] });
      throw new Error(`Unexpected provider request: ${url.origin}${url.pathname}`);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });

  function payload(type: 'ai' | 'tts' | 'stt') {
    return {
      type,
      provider: 'openai',
      model:
        type === 'ai'
          ? getAiProviderMeta('openai').defaultModel
          : type === 'tts'
            ? getProviderMeta('openai').models[0]!.id
            : getSttProviderMeta('openai').defaultModel,
    };
  }
  function request(body: unknown) {
    return new NextRequest('http://localhost/api/v1/admin/test-model', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sotto_session=${boundary.token}` },
      body: JSON.stringify(body),
    });
  }

  it('rejects anonymous and household access before contacting a provider', async () => {
    boundary.token = '';
    expect((await route.POST(request(payload('ai')))).status).toBe(403);
    boundary.token = (await identity.household('Learner')).token;
    expect((await route.POST(request(payload('ai')))).status).toBe(403);
    expect(requests).toEqual([]);
  });
  it.each([
    { type: 'invalid', provider: 'openai', model: 'invalid' },
    { type: 'ai', model: 'model' },
    { type: 'ai', provider: 'openai' },
  ])('rejects malformed model input %j', async (body) => {
    expect((await route.POST(request(body))).status).toBe(400);
    expect(requests).toEqual([]);
  });
  it('uses the selected owner AI credential and model, and records usage', async () => {
    const response = await route.POST(request(payload('ai')));
    const result = await response.json();
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, response: 'Hello' });
    const sent = requests.find((item) => new URL(item.url).pathname === '/v1/chat/completions')!;
    expect(sent.headers.get('authorization')).toBe('Bearer owner-key');
    expect(await sent.json()).toMatchObject({ model: getAiProviderMeta('openai').defaultModel });
    expect(
      await instance.database.apiUsageLog.findFirst({
        where: { userId: identity.ownerId, category: 'admin_test' },
      })
    ).toMatchObject({ service: 'openai' });
  });
  it('limits the displayed AI completion to 60 characters', async () => {
    completion = 'A'.repeat(100);
    expect(await (await route.POST(request(payload('ai')))).json()).toMatchObject({
      success: true,
      response: 'A'.repeat(60),
    });
  });
  it('reports a missing selected credential without borrowing another provider account', async () => {
    const missing = {
      type: 'ai',
      provider: 'anthropic',
      model: getAiProviderMeta('anthropic').defaultModel,
    };
    expect(await (await route.POST(request(missing))).json()).toMatchObject({
      success: false,
      error: expect.stringContaining('required'),
    });
    expect(requests).toEqual([]);
  });
  it.each([
    { status: 401, message: 'Invalid API key', expected: /Authentication failed/ },
    { status: 429, message: 'Rate limit exceeded', expected: /Rate limited/ },
    { status: 408, message: 'Request timeout', expected: /Timed out/ },
    {
      status: 400,
      message: 'Unsupported request parameter',
      expected: /Unsupported request parameter/,
    },
  ])(
    'reports provider failure $status',
    async ({ status, message, expected }) => {
      vi.stubGlobal('fetch', async () =>
        Response.json({ error: { message } }, { status, headers: { 'retry-after': '0' } })
      );
      expect(await (await route.POST(request(payload('ai')))).json()).toMatchObject({
        success: false,
        error: expect.stringMatching(expected),
      });
    },
    20_000
  );
  it('returns the generated speech as an audio data URL', async () => {
    expect(await (await route.POST(request(payload('tts')))).json()).toMatchObject({
      success: true,
      audioData: 'data:audio/mpeg;base64,SUQzAQI=',
    });
  });
  it('uses an explicitly selected local TTS service without a hosted key', async () => {
    expect(
      await (
        await route.POST(request({ type: 'tts', provider: 'local', model: 'local-model' }))
      ).json()
    ).toMatchObject({ success: true, audioData: expect.stringContaining('base64,') });
    expect(requests.map((item) => item.url)).toEqual(['http://local-tts.example/tts']);
  });
  it('transcribes the generated sample using the selected owner STT account', async () => {
    expect(await (await route.POST(request(payload('stt')))).json()).toMatchObject({
      success: true,
      transcript: 'Hello world',
    });
    const sent = requests.find(
      (item) => new URL(item.url).pathname === '/v1/audio/transcriptions'
    )!;
    expect(sent.headers.get('authorization')).toBe('Bearer owner-key');
    const form = await sent.formData();
    expect(form.get('model')).toBe(getSttProviderMeta('openai').defaultModel);
    expect(form.get('file')).toBeInstanceOf(File);
  });
  it('reports an empty transcript explicitly', async () => {
    transcript = '';
    expect(await (await route.POST(request(payload('stt')))).json()).toMatchObject({
      success: true,
      transcript: '(empty transcript)',
    });
  });
});
