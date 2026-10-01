import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requiredLearningSkills } from '@sotto/shared';

const boundary = vi.hoisted(() => ({
  configuration: {
    ttsProvider: null as string | null,
    sttProvider: null as string | null,
    ttsBaseUrl: null as string | null,
    sttBaseUrl: null as string | null,
  },
  preference: null as string | null,
  credentials: new Set<string>(),
  storageError: null as Error | null,
}));
vi.mock('@/lib/prisma', () => ({
  prismaUnfiltered: {
    $transaction: async (operation: (database: unknown) => Promise<unknown>) =>
      operation({
        user: { findUnique: async () => ({ preferredTtsProvider: boundary.preference }) },
      }),
  },
}));
vi.mock('@/lib/site-config', () => ({ getSiteConfig: async () => boundary.configuration }));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-credentials', () => ({
  resolveSottoProfileCredential: async (
    _database: unknown,
    _userId: string,
    scope: string,
    provider: string
  ) => {
    if (boundary.storageError) throw boundary.storageError;
    return boundary.credentials.has(`${scope}:${provider}`) ? { credential: { provider } } : null;
  },
}));

import { readSkillRequirements, resolveSkillRequirements } from '@/lib/learning/skill-requirements';

const execution = { userId: 'learner', authorize: async () => ({ userId: 'learner' }) };
const context = {
  scope: 'FULL' as const,
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2' as const,
};

beforeEach(() => {
  boundary.configuration = {
    ttsProvider: null,
    sttProvider: null,
    ttsBaseUrl: null,
    sttBaseUrl: null,
  };
  boundary.preference = null;
  boundary.credentials.clear();
  boundary.storageError = null;
});

describe('learner speech access', () => {
  it('keeps all text skills available without speech configuration', async () => {
    expect(requiredLearningSkills(await resolveSkillRequirements(execution, context))).toEqual([
      'GRAMMAR',
      'READING',
      'WRITING',
    ]);
  });

  it('does not infer audio access from an unrelated provider key', async () => {
    boundary.configuration.ttsProvider = 'cartesia';
    boundary.credentials.add('tts:elevenlabs');
    const requirements = await resolveSkillRequirements(execution, context);
    expect(requirements.skills.LISTENING).toEqual({
      state: 'EXEMPT_NO_PROVIDER',
      reason: 'NO_TTS_PROVIDER',
    });
  });

  it('uses the explicit instance provider when a personal override is absent', async () => {
    boundary.configuration.ttsProvider = 'cartesia';
    boundary.credentials.add('tts:cartesia');
    const requirements = await resolveSkillRequirements(execution, context);
    expect(requirements.ttsProvider).toBe('cartesia');
    expect(requirements.skills.LISTENING.state).toBe('REQUIRED');
  });

  it('honors a personal TTS selection independently of the instance provider', async () => {
    boundary.configuration.ttsProvider = 'cartesia';
    boundary.preference = 'openai';
    boundary.credentials.add('tts:openai');
    expect((await resolveSkillRequirements(execution, context)).ttsProvider).toBe('openai');
  });

  it('requires both audio skills for explicitly configured keyless local providers', async () => {
    boundary.configuration = {
      ttsProvider: 'local',
      sttProvider: 'local',
      ttsBaseUrl: 'http://local-tts:8000',
      sttBaseUrl: 'http://local-stt:8000',
    };
    expect(requiredLearningSkills(await resolveSkillRequirements(execution, context))).toContain(
      'LISTENING'
    );
    expect(requiredLearningSkills(await resolveSkillRequirements(execution, context))).toContain(
      'SPEAKING'
    );
  });

  it.each(['unknown-provider', 'auto'])(
    'rejects saved invalid selection %s instead of waiving listening',
    async (provider) => {
      boundary.configuration.ttsProvider = provider;
      await expect(resolveSkillRequirements(execution, context)).rejects.toThrow(/TTS provider/);
    }
  );

  it('surfaces unavailable credential storage instead of waiving an audio skill', async () => {
    boundary.configuration.sttProvider = 'openai';
    boundary.storageError = new Error('Selected credential is disabled');
    await expect(resolveSkillRequirements(execution, context)).rejects.toThrow(/disabled/);
  });

  it('rejects an incomplete local provider configuration', async () => {
    boundary.configuration.sttProvider = 'local';
    await expect(resolveSkillRequirements(execution, context)).rejects.toThrow(/endpoint/);
  });

  it('rejects malformed persisted requirements instead of treating the session as legacy', () => {
    expect(readSkillRequirements(null)).toBeNull();
    expect(() => readSkillRequirements({ version: 1 })).toThrow();
  });
});
