// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { capturedLearningAiOptions, resolveCapturedLearningAi } from '@/lib/learning-ai';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { setAutoModelConfig, setSystemAiProviderEnabled } from '@/lib/auto-model-config';
import { invalidateServerInfra } from '@/lib/server-config';

const databaseBoundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const connection = prismaTestBoundary(databaseBoundary);
  return { prisma: connection, prismaUnfiltered: connection };
});

const databaseSuite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
databaseSuite('learning model authority and selection', () => {
  let application: SharedTestInstance;
  let profile: SharedTestIdentity;
  const received: Request[] = [];
  const localUrl = 'http://127.0.0.1:18191/v1';

  beforeAll(async () => {
    application = await createSharedTestInstance('ai_admission');
    databaseBoundary.database = application.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '7'.repeat(64));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    vi.stubEnv('SOTTO_ISOLATED_CLAUDE_IMAGE', '');
    profile = await application.reset();
    invalidateServerInfra();
    received.length = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      received.push(new Request(input, init));
      return Response.json({ admitted: true });
    });
  });
  afterEach(() => {
    invalidateServerInfra();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    databaseBoundary.database = null;
    await application?.close();
  });

  function execution() {
    const request = new Request('http://localhost:3000/api/v1/courses', {
      headers: { cookie: `sotto_session=${profile.ownerToken}` },
    });
    return {
      userId: profile.ownerId,
      authorize: async (database: Parameters<typeof resolveSottoRequest>[0]) => {
        const identity = await resolveSottoRequest(database, request);
        if (identity?.kind !== 'content') throw new Error('The learner session is unavailable');
        return identity;
      },
    };
  }

  async function preference(provider: string, model: string) {
    await application.database.user.update({
      where: { id: profile.ownerId },
      data: { preferredAiProvider: provider, preferredAiModel: model },
    });
  }

  it('keeps an explicit CLI choice while an API key exists', async () => {
    await application.seedAiCredential(profile.ownerId, 'openai', 'personal-api-secret');
    await preference('codex', 'codex');
    const selected = await resolveCapturedLearningAi(profile.ownerId, execution());
    expect(selected).toMatchObject({ provider: 'codex', model: 'codex' });
    expect(selected.apiKey).toBeUndefined();
    expect(received).toEqual([]);
  });

  it('uses a personal API credential with its registry default when the server selects another provider', async () => {
    await application.seedAiCredential(profile.ownerId, 'openai', 'registry-default-secret');
    expect(await resolveCapturedLearningAi(profile.ownerId, execution())).toMatchObject({
      provider: 'openai',
      model: getAiProviderMeta('openai').defaultModel,
      apiKey: 'registry-default-secret',
    });
  });

  it('uses the owner-configured model when it belongs to the selected personal key provider', async () => {
    const model = getAiProviderMeta('anthropic').defaultModel;
    await application.seedAiCredential(profile.ownerId, 'anthropic', 'owner-model-secret');
    await setAutoModelConfig(
      { model: { aiProvider: 'anthropic', aiModel: model } },
      profile.ownerId
    );
    expect(await resolveCapturedLearningAi(profile.ownerId, execution())).toMatchObject({
      provider: 'anthropic',
      model,
      apiKey: 'owner-model-secret',
    });
  });

  it('keeps an explicit API choice while the server selects a CLI', async () => {
    const model = getAiProviderMeta('openai').defaultModel;
    await setAutoModelConfig({ model: { aiProvider: 'codex', aiModel: 'codex' } }, profile.ownerId);
    await application.seedAiCredential(profile.ownerId, 'openai', 'chosen-api-secret');
    await preference('openai', model);
    expect(await resolveCapturedLearningAi(profile.ownerId, execution())).toMatchObject({
      provider: 'openai',
      model,
      apiKey: 'chosen-api-secret',
    });
  });

  it('uses the pending selection without mutating the saved learner preference', async () => {
    const model = getAiProviderMeta('openai').defaultModel;
    await preference('openai', model);
    const selected = await resolveCapturedLearningAi(profile.ownerId, execution(), {
      provider: 'codex',
      model: 'codex',
    });
    expect(selected.provider).toBe('codex');
    expect(
      await application.database.user.findUniqueOrThrow({ where: { id: profile.ownerId } })
    ).toMatchObject({
      preferredAiProvider: 'openai',
      preferredAiModel: model,
    });
  });

  it('rejects a pending model from another provider without dispatch', async () => {
    await expect(
      resolveCapturedLearningAi(profile.ownerId, execution(), {
        provider: 'openai',
        model: 'codex',
      })
    ).rejects.toThrow(/does not belong/);
    expect(received).toEqual([]);
  });

  it('rejects an explicit API selection without its own credential', async () => {
    await application.seedAiCredential(profile.ownerId, 'anthropic', 'unrelated-api-secret');
    await expect(
      resolveCapturedLearningAi(profile.ownerId, execution(), {
        provider: 'openai',
        model: getAiProviderMeta('openai').defaultModel,
      })
    ).rejects.toThrow(/credential.*required/i);
    expect(received).toEqual([]);
  });

  it('keeps the pending local model and endpoint independent of saved defaults', async () => {
    const selected = await resolveCapturedLearningAi(profile.ownerId, execution(), {
      provider: 'local',
      model: 'local:classroom-model',
      endpoint: localUrl,
    });
    expect(selected).toMatchObject({
      provider: 'local',
      model: 'local:classroom-model',
      endpoint: localUrl,
    });
    expect(selected.apiKey).toBeUndefined();
  });

  it('rejects a local key bound to another endpoint before any HTTP request', async () => {
    await application.configureInfrastructure({ aiBaseUrl: localUrl });
    await application.seedAiCredential(profile.ownerId, 'local', 'destination-secret');
    await expect(
      resolveCapturedLearningAi(profile.ownerId, execution(), {
        provider: 'local',
        model: 'local:classroom-model',
        endpoint: 'http://127.0.0.1:18192/v1',
      })
    ).rejects.toThrow(/endpoint changed/);
    expect(received).toEqual([]);
  });

  it.each(['codex', 'claude-code'] as const)(
    'keeps the configured %s provider and model together',
    async (provider) => {
      const model = provider === 'codex' ? 'codex:gpt-5.5:high' : 'claude-code:sonnet';
      await application.configureInfrastructure({
        aiProvider: 'local',
        aiModel: 'unrelated-model',
        aiBaseUrl: localUrl,
      });
      await setAutoModelConfig(
        { model: { aiProvider: provider, aiModel: model } },
        profile.ownerId
      );
      await application.seedAiCredential(profile.ownerId, 'openai', 'unused-api-secret');
      expect(await resolveCapturedLearningAi(profile.ownerId, execution())).toMatchObject({
        provider,
        model,
      });
    }
  );

  it('rejects a disabled CLI instead of using another configured backend', async () => {
    await setSystemAiProviderEnabled('codex', false, profile.ownerId);
    await preference('codex', 'codex');
    await expect(resolveCapturedLearningAi(profile.ownerId, execution())).rejects.toThrow(
      /disabled/
    );
    expect(received).toEqual([]);
  });

  it('enforces operator isolation when a pending image value is empty', async () => {
    vi.stubEnv('SOTTO_ISOLATED_CLAUDE_IMAGE', 'invalid-unpinned-image');
    await expect(
      resolveCapturedLearningAi(profile.ownerId, execution(), {
        provider: 'claude-code',
        model: getAiProviderMeta('claude-code').defaultModel,
        isolatedImage: '',
      })
    ).rejects.toThrow(/immutable image digest/);
  });

  it('rejects authority belonging to another household learner', async () => {
    const other = await profile.household('Second learner');
    await expect(
      resolveCapturedLearningAi(other.id, execution(), {
        provider: 'codex',
        model: 'codex',
      })
    ).rejects.toThrow(/user changed/);
  });

  it('rejects a cancelled request before model admission', async () => {
    const lifetime = new AbortController();
    lifetime.abort();
    await expect(
      resolveCapturedLearningAi(profile.ownerId, { ...execution(), signal: lifetime.signal })
    ).rejects.toThrow();
    expect(received).toEqual([]);
  });

  it('reports that a provider must be configured when neither a personal key nor keyless backend exists', async () => {
    await expect(resolveCapturedLearningAi(profile.ownerId, execution())).rejects.toThrow(
      /No AI provider is configured/
    );
    expect(received).toEqual([]);
  });

  it('preserves the identity of an unchanged durable selection', async () => {
    const learningSelection = { provider: 'codex', model: 'codex', credentialFingerprint: null };
    const selected = await resolveCapturedLearningAi(profile.ownerId, {
      ...execution(),
      learningSelection,
    });
    expect(selected.execution.learningSelection).toEqual(learningSelection);
  });

  it('adds the captured moderation key while preserving Request headers and body', async () => {
    await application.seedAiCredential(profile.ownerId, 'openai', 'moderation-only-secret');
    const options = await capturedLearningAiOptions({
      provider: 'codex',
      model: 'codex',
      execution: execution(),
    });
    const response = await options.moderation?.fetch(
      new Request('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: { 'x-request-id': 'owned-request', authorization: 'Bearer caller-value' },
        body: JSON.stringify({ input: 'A classroom example' }),
      })
    );
    expect(await response?.json()).toEqual({ admitted: true });
    expect(received[0]!.headers.get('authorization')).toBe('Bearer moderation-only-secret');
    expect(received[0]!.headers.get('x-request-id')).toBe('owned-request');
    expect(await received[0]!.json()).toEqual({ input: 'A classroom example' });
  });

  it('uses explicit RequestInit headers and rejects moderation to an unapproved destination', async () => {
    await application.seedAiCredential(profile.ownerId, 'openai', 'moderation-only-secret');
    const options = await capturedLearningAiOptions({
      provider: 'codex',
      model: 'codex',
      execution: execution(),
    });
    await options.moderation?.fetch(
      new Request('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: { 'x-inherited': 'discard' },
      }),
      { headers: { 'x-explicit': 'retain' } }
    );
    expect(received[0]!.headers.get('x-explicit')).toBe('retain');
    expect(received[0]!.headers.has('x-inherited')).toBe(false);
    await expect(
      options.moderation?.fetch('https://unapproved.example/moderations', { method: 'POST' })
    ).rejects.toThrow();
    expect(received.map((request) => request.url)).toEqual([
      'https://api.openai.com/v1/moderations',
    ]);
  });

  it('exposes original source documents only to an author that opts in', async () => {
    const sourceDocuments = {
      parts: [
        {
          type: 'document' as const,
          mediaType: 'application/pdf' as const,
          name: 'Study sketch.pdf',
          data: Buffer.from('%PDF-1.7\nOwned exercise source'),
        },
      ],
      validate: async () => {},
    };
    let cleanupFailure: unknown;
    const selected = {
      provider: 'codex',
      model: 'codex',
      execution: {
        ...execution(),
        sourceDocuments,
        onCleanupError: (error: unknown) => {
          cleanupFailure = error;
        },
      },
    };
    expect(await capturedLearningAiOptions(selected)).not.toHaveProperty('sourceDocuments');
    const author = await capturedLearningAiOptions(selected, { includeSourceDocuments: true });
    expect(author).toHaveProperty('sourceDocuments', sourceDocuments);
    const failure = new Error('Document cleanup incomplete');
    author.onCleanupError?.(failure);
    expect(cleanupFailure).toBe(failure);
  });
});
