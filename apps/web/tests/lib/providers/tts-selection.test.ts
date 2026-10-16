import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  provider: null as string | null,
  key: false,
  configuration: {} as Record<string, string | null>,
}));
vi.mock('@/lib/prisma', () => ({
  prismaUnfiltered: {
    user: { findUnique: async () => ({ preferredTtsProvider: state.provider }) },
  },
}));
vi.mock('@/lib/byok', () => ({
  hasSharedByokKey: async () => state.key,
}));
vi.mock('@/lib/server-config', () => ({
  infra: (key: string) => state.configuration[key],
}));

import { canResolveTts, selectTtsProviderId, selectedTtsModel } from '@/lib/providers/tts';

beforeEach(() => {
  state.provider = null;
  state.key = false;
  state.configuration = { ttsProvider: 'cartesia' };
});

describe('personal speech selection', () => {
  it('uses the admin model unless the selected profile explicitly chose its own model', () => {
    const configured = { ttsProvider: 'fish' as const, ttsModel: 'drama-3' };
    expect(selectedTtsModel(null, 'fish', configured)).toBe('drama-3');
    expect(selectedTtsModel({ preferredTtsModel: 's2-pro' }, 'fish', configured)).toBe('s2-pro');
    expect(selectedTtsModel({ preferredTtsModel: 'sonic-3.5' }, 'fish', configured)).toBe(
      'drama-3'
    );
    expect(
      selectedTtsModel(
        { preferredTtsProvider: 'local', preferredTtsModel: 'piper' },
        'fish',
        configured
      )
    ).toBe('drama-3');
    expect(
      selectedTtsModel(
        { preferredTtsProvider: 'local', preferredTtsModel: 'piper' },
        'local',
        configured
      )
    ).toBe('piper');
  });
  it('keeps audio disabled despite a cloud key and a saved local endpoint', async () => {
    state.provider = 'disabled';
    state.key = true;
    state.configuration.ttsBaseUrl = 'http://local-tts:8000';
    expect(await canResolveTts('learner')).toBe(false);
    expect(selectTtsProviderId(state.provider, 'cartesia')).toBeNull();
  });

  it('makes explicitly selected local speech available without a cloud key', async () => {
    state.provider = 'local';
    state.configuration.ttsBaseUrl = 'http://local-tts:8000';
    expect(await canResolveTts('learner')).toBe(true);
    expect(selectTtsProviderId(state.provider, 'cartesia')).toBe('local');
  });

  it('does not use a saved local endpoint when cloud speech remains selected', async () => {
    state.provider = 'cartesia';
    state.configuration.ttsBaseUrl = 'http://local-tts:8000';
    expect(await canResolveTts('learner')).toBe(false);
    expect(selectTtsProviderId(state.provider, 'local')).toBe('cartesia');
  });

  it('requires a local endpoint and preserves the existing cloud default when no preference exists', async () => {
    state.provider = 'local';
    expect(await canResolveTts('learner')).toBe(false);
    expect(selectTtsProviderId(null, 'cartesia')).toBe('cartesia');
    state.provider = null;
    state.key = true;
    expect(await canResolveTts('learner')).toBe(true);
  });

  it('rejects an invalid personal selection instead of changing providers', async () => {
    state.provider = 'unknown';
    state.key = true;
    await expect(canResolveTts('learner')).rejects.toThrow(/saved TTS provider/);
  });
});
