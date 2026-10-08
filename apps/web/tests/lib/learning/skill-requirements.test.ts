// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requiredLearningSkills } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import { useProviderCredentialDatabase } from '../../helpers/runtime/provider-credentials-postgres';
import { EMPTY_INFRA } from '@/lib/site-config';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { captureConfiguredSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
import { captureSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import {
  sottoRequestExecution,
  createSottoProviderTransport,
} from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { readSkillRequirements, resolveSkillRequirements } from '@/lib/learning/skill-requirements';

let database: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() {
    return database;
  },
}));
const context = {
  scope: 'FULL' as const,
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2' as const,
};
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('learner speech access with canonical PostgreSQL credential selection', () => {
  const fixture = useProviderCredentialDatabase();
  beforeAll(() => {
    database = fixture.database;
  });
  beforeEach(() => configure({}));
  async function execution() {
    const admission = await fixture.transaction((tx) => fixture.admission(tx));
    return sottoRequestExecution(admission.request, admission.identity);
  }
  async function configure(
    settings: Record<string, string | null>,
    preference: string | null = null
  ) {
    await fixture.transaction(async (tx) => {
      await sidedoorStateStore(tx).transact((state) => {
        state.configuration.site = { ...EMPTY_INFRA, ...settings };
      });
      await tx.user.update({
        where: { id: 'alice' },
        data: { preferredTtsProvider: preference },
        select: { id: true },
      });
    });
  }
  async function seed(provider: string, scope: 'tts' | 'stt' = 'tts', enabled = true) {
    await fixture.transaction(async (tx) => {
      const storage = await sottoCredentialStorage(tx, scope, provider);
      const owner = await captureSottoCredentialOwner(tx, 'alice');
      const probe = await captureConfiguredSottoCredentialProbe(
        tx,
        storage.slot.modality,
        provider,
        {}
      );
      if (probe.kind === 'unsupported') throw new Error('Missing fixture provider transport');
      await storage.owned.replace(
        storage.owned.prepareReplacement(
          { ...storage.slot, owner },
          {
            expectedHeadRevision: null,
            credentialRevision: randomUUID(),
            values: { apiKey: `speech-access-${randomUUID()}` },
            binding: probe.binding,
            availability: enabled ? 'enabled' : 'disabled',
            label: 'Fixture speech credential',
            metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
          }
        )
      );
    });
  }
  async function exhaust() {
    const actor = await execution();
    const credential = await fixture.transaction((tx) =>
      captureSottoExecutionCredential(tx, actor.authorize, 'tts', 'cartesia', true)
    );
    if (!credential) throw new Error('Missing fixture Cartesia credential');
    const transport = await createSottoProviderTransport({ ...actor, credential }, [
      { method: 'POST', url: 'https://api.cartesia.ai/tts/bytes' },
    ]);
    vi.stubGlobal(
      'fetch',
      async () => new Response('Model credits limit reached: exhausted', { status: 402 })
    );
    await (
      await transport.authenticatedFetch('https://api.cartesia.ai/tts/bytes', { method: 'POST' })
    ).text();
  }
  const requirements = async () => resolveSkillRequirements(await execution(), context);

  it('blocks known exhausted access before oral requirements and permits a distinct explicit account', async () => {
    await configure({ ttsProvider: 'cartesia' });
    await seed('cartesia');
    await exhaust();
    await expect(requirements()).rejects.toMatchObject({ code: 'PROVIDER_CREDITS_EXHAUSTED' });
    await seed('openai');
    await configure({ ttsProvider: 'cartesia' }, 'openai');
    expect((await requirements()).ttsProvider).toBe('openai');
  });
  it('honors disabled audio despite invalid configured speech credentials', async () => {
    await seed('cartesia', 'tts', false);
    await configure({ ttsProvider: 'cartesia', sttProvider: 'cartesia' }, 'disabled');
    const selected = await requirements();
    expect(requiredLearningSkills(selected)).toEqual(['GRAMMAR', 'READING', 'WRITING']);
    expect(selected.ttsProvider).toBeNull();
    expect(selected.sttProvider).toBeNull();
  });
  it('allows local lesson speech while retaining a latched future transcription requirement', async () => {
    await configure({ ttsProvider: 'cartesia' });
    await seed('cartesia');
    await exhaust();
    await configure(
      { ttsProvider: 'cartesia', sttProvider: 'cartesia', ttsBaseUrl: 'http://local-tts:8000' },
      'local'
    );
    const selected = await requirements();
    expect(selected.ttsProvider).toBe('local');
    expect(selected.sttProvider).toBe('cartesia');
    expect(selected.skills.SPEAKING.state).toBe('REQUIRED');
    expect(selected.skills.LISTENING.state).toBe('REQUIRED');
  });
  it('keeps all text skills available without speech configuration', async () => {
    expect(requiredLearningSkills(await requirements())).toEqual(['GRAMMAR', 'READING', 'WRITING']);
  });
  it('does not infer audio access from an unrelated provider key', async () => {
    await configure({ ttsProvider: 'cartesia' });
    await seed('elevenlabs');
    expect((await requirements()).skills.LISTENING).toEqual({
      state: 'EXEMPT_NO_PROVIDER',
      reason: 'NO_TTS_PROVIDER',
    });
  });
  it('uses the explicit instance provider when a personal override is absent', async () => {
    await configure({ ttsProvider: 'cartesia' });
    await seed('cartesia');
    const selected = await requirements();
    expect(selected.ttsProvider).toBe('cartesia');
    expect(selected.skills.LISTENING.state).toBe('REQUIRED');
  });
  it('honors a personal TTS selection independently of the instance provider', async () => {
    await configure({ ttsProvider: 'cartesia' }, 'openai');
    await seed('openai');
    expect((await requirements()).ttsProvider).toBe('openai');
  });
  it('requires both oral skills for explicitly configured keyless local providers', async () => {
    await configure({
      ttsProvider: 'local',
      sttProvider: 'local',
      ttsBaseUrl: 'http://local-tts:8000',
      sttBaseUrl: 'http://local-stt:8000',
    });
    expect(requiredLearningSkills(await requirements())).toEqual([
      'GRAMMAR',
      'READING',
      'LISTENING',
      'SPEAKING',
      'WRITING',
    ]);
  });
  it.each(['unknown-provider', 'auto'])(
    'rejects invalid selection %s instead of waiving listening',
    async (provider) => {
      await configure({ ttsProvider: provider });
      await expect(requirements()).rejects.toMatchObject({
        name: 'LearningConfigurationError',
        message: expect.stringMatching(/TTS provider/),
      });
    }
  );
  it('surfaces a disabled selected credential instead of waiving an audio skill', async () => {
    await seed('openai', 'stt', false);
    await configure({ sttProvider: 'openai' });
    await expect(requirements()).rejects.toThrow(/disabled|unavailable/i);
  });
  it('rejects an incomplete local provider configuration', async () => {
    await configure({ sttProvider: 'local' });
    await expect(requirements()).rejects.toThrow(/endpoint/);
  });
  it('rejects malformed persisted requirements instead of treating the session as legacy', () => {
    expect(readSkillRequirements(null)).toBeNull();
    expect(() => readSkillRequirements({ version: 1 })).toThrow();
  });
});
