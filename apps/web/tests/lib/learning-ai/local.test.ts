// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';
import {
  capturedLearningAiOptions,
  resolveCapturedEpisodeAi,
  resolveCapturedLearningAi,
  type CapturedLearningAi,
} from '@/lib/learning-ai';
import { createAIProvider } from '@/lib/providers/ai';
import { resolveCapturedSttProvider } from '@/lib/providers/stt';
import { getServerInfra, invalidateServerInfra } from '@/lib/server-config';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('openai') };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Local learning generation', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  const endpoint = 'http://localhost:11434/v1';
  const requests: Request[] = [];
  beforeAll(async () => {
    instance = await createSharedTestInstance('learning_ai_local');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
    invalidateServerInfra();
    requests.length = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({
        id: 'local-response',
        object: 'chat.completion',
        created: 1,
        model: 'qwen3',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'Hallo!' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });
    });
  });
  afterEach(() => {
    invalidateServerInfra();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });
  function execution() {
    const request = new Request('http://localhost:3000/api/v1/courses', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    return {
      userId: identity.ownerId,
      authorize: async (database: Parameters<typeof resolveSottoRequest>[0]) => {
        const current = await resolveSottoRequest(database, request);
        if (!current || current.kind !== 'content') throw new Error('Test session expired');
        return current;
      },
    };
  }
  async function saveLocalPreference() {
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { preferredAiProvider: 'local', preferredAiModel: 'local:qwen3' },
    });
  }
  async function generate(
    ai: CapturedLearningAi,
    expectedEndpoint = endpoint,
    expectedApiKey = 'local'
  ) {
    const result = await createAIProvider(ai.provider).generateResponse(
      'Teach German',
      [{ role: 'user', content: 'Say hello' }],
      await capturedLearningAiOptions(ai)
    );
    expect(result.content).toBe('Hallo!');
    expect(requests.map((request) => request.url)).toEqual([
      `${expectedEndpoint}/chat/completions`,
    ]);
    expect(await requests[0].json()).toMatchObject({ model: 'qwen3' });
    expect(requests[0].headers.get('authorization')).toBe(`Bearer ${expectedApiKey}`);
  }
  it('uses the saved endpoint for subsequent lessons', async () => {
    await instance.configureInfrastructure({
      aiProvider: 'local',
      aiModel: 'qwen3',
      aiBaseUrl: endpoint,
    });
    await saveLocalPreference();
    await generate(await resolveCapturedLearningAi(identity.ownerId, execution()));
  });
  it('uses the saved local API key for normal learning generation', async () => {
    await instance.configureInfrastructure({
      aiProvider: 'local',
      aiModel: 'qwen3',
      aiBaseUrl: endpoint,
    });
    await instance.seedAiCredential(identity.ownerId, 'local', 'local-learning-secret');
    await saveLocalPreference();
    const ai = await resolveCapturedLearningAi(identity.ownerId, execution());
    await generate(ai, endpoint, 'local-learning-secret');
  });
  it('transcribes on a separate local speech server without sending the saved AI key', async () => {
    const speechEndpoint = 'http://localhost:8000/v1';
    await instance.configureInfrastructure({
      aiProvider: 'local',
      aiModel: 'qwen3',
      aiBaseUrl: endpoint,
      sttProvider: 'local',
      sttBaseUrl: speechEndpoint,
      sttModel: 'whisper-small',
    });
    await instance.seedAiCredential(identity.ownerId, 'local', 'private-ai-secret');
    await saveLocalPreference();
    const speechRequests: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      speechRequests.push(request);
      if (request.headers.get('authorization') !== 'Bearer local')
        return new Response(null, { status: 401 });
      return Response.json({
        text: 'Hallo!',
        language: 'de',
        segments: [{ start: 0, end: 1, text: 'Hallo!' }],
      });
    });
    await getServerInfra();
    const stt = await resolveCapturedSttProvider({
      userId: identity.ownerId,
      execution: execution(),
      requestedProvider: 'local',
      requestedModel: 'whisper-small',
    });
    expect(await stt.provider.transcribe(Buffer.from('audio'))).toMatchObject({
      text: 'Hallo!',
    });
    expect(speechRequests.map((request) => request.url)).toEqual([
      `${speechEndpoint}/audio/transcriptions`,
    ]);
    expect(speechRequests[0].headers.get('authorization')).toBe('Bearer local');
    const ai = await resolveCapturedLearningAi(identity.ownerId, execution());
    expect(ai.apiKey).toBe('private-ai-secret');
    expect(ai.endpoint).toBe(endpoint);
  });
  it('uses the shared local endpoint without a personal preference', async () => {
    await instance.configureInfrastructure({
      aiProvider: 'local',
      aiModel: 'local:qwen3',
      aiBaseUrl: endpoint,
    });
    await generate(await resolveCapturedLearningAi(identity.ownerId, execution()));
  });
  it('uses the saved local key and shared model without a personal preference', async () => {
    await instance.configureInfrastructure({
      aiProvider: 'local',
      aiModel: 'qwen3',
      aiBaseUrl: endpoint,
    });
    await instance.seedAiCredential(identity.ownerId, 'local', 'shared-local-secret');
    await generate(
      await resolveCapturedLearningAi(identity.ownerId, execution()),
      endpoint,
      'shared-local-secret'
    );
  });
  it('rejects a retained local key when another shared provider owns the model', async () => {
    await instance.configureInfrastructure({ aiBaseUrl: endpoint });
    await instance.seedAiCredential(identity.ownerId, 'local', 'retained-local-secret');
    await instance.configureInfrastructure({
      aiProvider: 'openai',
      aiModel: 'cloud-model',
      aiBaseUrl: endpoint,
    });
    await expect(resolveCapturedLearningAi(identity.ownerId, execution())).rejects.toThrow();
    expect(requests).toEqual([]);
  });
  it('uses the saved local key for the wizard endpoint', async () => {
    await instance.configureInfrastructure({ aiBaseUrl: endpoint });
    await instance.seedAiCredential(identity.ownerId, 'local', 'wizard-local-secret');
    const ai = await resolveCapturedLearningAi(identity.ownerId, execution(), {
      provider: 'local',
      model: 'local:qwen3',
      endpoint,
    });
    await generate(ai, endpoint, 'wizard-local-secret');
  });
  it('rejects a wizard endpoint that differs from the saved key before dispatch', async () => {
    await instance.configureInfrastructure({ aiBaseUrl: endpoint });
    await instance.seedAiCredential(identity.ownerId, 'local', 'first-endpoint-secret');
    await expect(
      resolveCapturedLearningAi(identity.ownerId, execution(), {
        provider: 'local',
        model: 'local:qwen3',
        endpoint: 'http://localhost:9999/v1',
      })
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(requests).toEqual([]);
  });
  it('uses a keyless wizard endpoint before a shared endpoint is configured', async () => {
    const ai = await resolveCapturedLearningAi(identity.ownerId, execution(), {
      provider: 'local',
      model: 'local:qwen3',
      endpoint,
    });
    await generate(ai);
  });
  it('uses the wizard endpoint before settings are saved', async () => {
    await instance.configureInfrastructure({ aiBaseUrl: 'http://localhost:9999/v1' });
    const ai = await resolveCapturedLearningAi(identity.ownerId, execution(), {
      provider: 'local',
      model: 'local:qwen3',
      endpoint,
    });
    await generate(ai);
  });
  it('uses the saved endpoint for an explicit episode model', async () => {
    await instance.configureInfrastructure({ aiBaseUrl: endpoint });
    await generate(
      await resolveCapturedEpisodeAi({
        userId: identity.ownerId,
        aiProvider: 'local',
        aiModel: 'qwen3',
        allowSharing: false,
        execution: execution(),
      })
    );
  });
  it('keeps the captured destination when settings change and rejects another destination', async () => {
    await instance.configureInfrastructure({ aiBaseUrl: endpoint });
    await saveLocalPreference();
    const ai = await resolveCapturedLearningAi(identity.ownerId, execution());
    await instance.configureInfrastructure({ aiBaseUrl: 'http://localhost:9999/v1' });
    const options = await capturedLearningAiOptions(ai);
    await expect(
      options.fetch!('http://localhost:9999/v1/chat/completions', { method: 'POST' })
    ).rejects.toThrow();
    expect(requests).toEqual([]);
    await generate(ai);
  });
  it('rejects a missing endpoint before sending a request', async () => {
    await saveLocalPreference();
    await expect(resolveCapturedLearningAi(identity.ownerId, execution())).rejects.toThrow(
      /local AI endpoint/i
    );
    expect(requests).toEqual([]);
  });
  it('rejects an empty local model before sending a request', async () => {
    await expect(
      resolveCapturedLearningAi(identity.ownerId, execution(), {
        provider: 'local',
        model: 'local:',
        endpoint,
      })
    ).rejects.toThrow(/local model/i);
    expect(requests).toEqual([]);
  });
});
