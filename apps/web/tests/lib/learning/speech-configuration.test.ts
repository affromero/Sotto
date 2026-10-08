import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';

const state = vi.hoisted(() => ({
  user: {
    preferredTtsProvider: null as string | null,
    preferredTtsModel: null as string | null,
    preferredSttModel: null as string | null,
  },
  configuration: {
    ttsProvider: null as string | null,
    sttProvider: null as string | null,
    ttsBaseUrl: null as string | null,
    sttBaseUrl: null as string | null,
    ttsVoices: null as string | null,
    sttModel: null,
  },
}));
vi.mock('@/lib/site-config', () => ({ getSiteConfig: async () => state.configuration }));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-credentials', () => ({
  resolveSottoProfileCredential: async () => null,
}));
vi.mock('@/lib/sidedoor/credentials/runtime/credential-execution', () => ({
  captureSottoExecutionCredential: async () => null,
}));

import { learningSpeechFingerprint } from '@/lib/learning/speech-configuration';
import { resolveSkillRequirementsInTransaction } from '@/lib/learning/skill-requirements';

const database = {
  user: { findUniqueOrThrow: async () => state.user, findUnique: async () => state.user },
} as unknown as Prisma.TransactionClient;
const authorize = async () =>
  ({ userId: 'learner' }) as Awaited<ReturnType<Parameters<typeof learningSpeechFingerprint>[1]>>;
const context = {
  scope: 'FULL' as const,
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2' as const,
};
const requirements = () =>
  resolveSkillRequirementsInTransaction(database, { userId: 'learner', authorize }, context);

beforeEach(() => {
  state.user = { preferredTtsProvider: null, preferredTtsModel: null, preferredSttModel: null };
  state.configuration = {
    ttsProvider: null,
    sttProvider: null,
    ttsBaseUrl: null,
    sttBaseUrl: null,
    ttsVoices: null,
    sttModel: null,
  };
});

describe('captured speech configuration', () => {
  it('preserves the historical empty fingerprint when audio is unconfigured', async () => {
    expect(await learningSpeechFingerprint(database, authorize, await requirements())).toBe(
      createHash('sha256').update('{}').digest('hex')
    );
  });

  it('distinguishes explicit audio disable from unconfigured audio', async () => {
    const absent = await learningSpeechFingerprint(database, authorize, await requirements());
    state.user.preferredTtsProvider = 'disabled';
    expect(await learningSpeechFingerprint(database, authorize, await requirements())).not.toBe(
      absent
    );
  });

  it('rejects enabling speech after capturing an operation with disabled audio', async () => {
    state.user.preferredTtsProvider = 'disabled';
    const captured = await requirements();
    state.user.preferredTtsProvider = 'local';
    state.configuration.ttsBaseUrl = 'http://local-tts:8000';
    await expect(learningSpeechFingerprint(database, authorize, captured)).rejects.toThrow(
      /provider changed/
    );
  });

  it('rejects disabling speech after capturing a required local provider', async () => {
    state.user.preferredTtsProvider = 'local';
    state.configuration.ttsBaseUrl = 'http://local-tts:8000';
    const captured = await requirements();
    state.user.preferredTtsProvider = 'disabled';
    await expect(learningSpeechFingerprint(database, authorize, captured)).rejects.toThrow(
      /provider changed/
    );
  });

  it('binds local models, endpoints and voices without changing the selected cloud configuration', async () => {
    state.user.preferredTtsProvider = 'local';
    state.user.preferredTtsModel = 'piper-de';
    state.configuration.ttsProvider = 'cartesia';
    state.configuration.ttsBaseUrl = 'http://local-tts:8000';
    state.configuration.ttsVoices = 'de-host,de-expert';
    const captured = await requirements();
    const initial = await learningSpeechFingerprint(database, authorize, captured);
    state.user.preferredTtsModel = 'piper-de-new';
    expect(await learningSpeechFingerprint(database, authorize, captured)).not.toBe(initial);
    state.user.preferredTtsModel = 'piper-de';
    state.configuration.ttsBaseUrl = 'http://other-local-tts:8000';
    expect(await learningSpeechFingerprint(database, authorize, captured)).not.toBe(initial);
    state.configuration.ttsBaseUrl = 'http://local-tts:8000';
    state.configuration.ttsVoices = 'de-other-host,de-expert';
    expect(await learningSpeechFingerprint(database, authorize, captured)).not.toBe(initial);
    expect(state.configuration.ttsProvider).toBe('cartesia');
  });
});
