import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUserTtsKeyFindFirst = vi.fn();

vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    userTtsKey: {
      findFirst: (...args: unknown[]) => mockUserTtsKeyFindFirst(...args),
    },
  };
  return { prisma: mockPrisma, prismaUnfiltered: mockPrisma };
});

import {
  checkMusicGenerationGate,
  getMusicGenerationStatus,
  tryIncrementMusicGeneration,
} from '@/lib/music-gate';

function mockByokKey(found: boolean) {
  mockUserTtsKeyFindFirst.mockResolvedValue(found ? { id: 'key-1' } : null);
}

describe('music gate', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SUNO_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allows generation when a platform music key is configured', async () => {
    process.env.SUNO_API_KEY = 'test-suno-key';
    mockByokKey(false);

    const result = await checkMusicGenerationGate('user-1');

    expect(result).toEqual({ allowed: true, reason: 'ok', hasByokKey: false });
  });

  it('allows generation when the user has a BYOK music key', async () => {
    mockByokKey(true);

    const result = await checkMusicGenerationGate('user-1');

    expect(result).toEqual({ allowed: true, reason: 'ok', hasByokKey: true });
  });

  it('blocks generation when no platform or BYOK music provider is available', async () => {
    mockByokKey(false);

    const result = await checkMusicGenerationGate('user-1');

    expect(result).toEqual({ allowed: false, reason: 'no_music_provider', hasByokKey: false });
  });

  it('reports status with provider availability and BYOK state', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key';
    mockByokKey(true);

    const result = await getMusicGenerationStatus('user-1');

    expect(result).toEqual({ available: true, hasByokKey: true });
  });

  it('keeps increment as a no-op success', async () => {
    await expect(tryIncrementMusicGeneration('user-1')).resolves.toBe(true);
  });
});
