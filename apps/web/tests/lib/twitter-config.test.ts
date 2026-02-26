import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPrismaTwitterConfigUpsert = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    twitterConfig: {
      upsert: (...args: unknown[]) => mockPrismaTwitterConfigUpsert(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

// ---- Import under test ----

import { getTwitterConfig, setTwitterConfig } from '@/lib/twitter-config';

// ---- Tests ----

describe('getTwitterConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns config data from upsert', async () => {
    const row = {
      id: 'singleton',
      autoTweetEnabled: true,
      minLikes: 5,
      minPlays: 20,
      minForks: 2,
      trendPollingEnabled: true,
      trendPollIntervalMs: 3600000,
      maxTrendPodcastsPerDay: 5,
      trendSearchQueries: ['AI', 'crypto'],
      tweetTemplate: 'Check out: {{title}}',
      defaultAiModel: 'claude-sonnet-4-6',
      defaultTtsProvider: 'elevenlabs',
      defaultTtsModel: 'eleven_v3',
      updatedAt: new Date(),
      updatedBy: null,
    };
    mockPrismaTwitterConfigUpsert.mockResolvedValue(row);

    const result = await getTwitterConfig();

    expect(result).toEqual({
      autoTweetEnabled: true,
      minLikes: 5,
      minPlays: 20,
      minForks: 2,
      trendPollingEnabled: true,
      trendPollIntervalMs: 3600000,
      maxTrendPodcastsPerDay: 5,
      trendSearchQueries: ['AI', 'crypto'],
      tweetTemplate: 'Check out: {{title}}',
      defaultAiModel: 'claude-sonnet-4-6',
      defaultTtsProvider: 'elevenlabs',
      defaultTtsModel: 'eleven_v3',
    });
  });

  it('upserts with singleton id and defaults', async () => {
    mockPrismaTwitterConfigUpsert.mockResolvedValue({
      autoTweetEnabled: false,
      minLikes: 10,
      minPlays: 50,
      minForks: 3,
      trendPollingEnabled: false,
      trendPollIntervalMs: 7200000,
      maxTrendPodcastsPerDay: 3,
      trendSearchQueries: ['AI', 'science', 'technology'],
      tweetTemplate: 'New on Sotto: {{title}}\n\n{{topic}}\n\nListen: {{url}}',
      defaultAiModel: null,
      defaultTtsProvider: null,
      defaultTtsModel: null,
    });

    await getTwitterConfig();

    expect(mockPrismaTwitterConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'singleton' },
        update: {},
        create: expect.objectContaining({
          id: 'singleton',
          autoTweetEnabled: false,
          minLikes: 10,
        }),
      })
    );
  });

  it('strips extra database fields from the response', async () => {
    mockPrismaTwitterConfigUpsert.mockResolvedValue({
      id: 'singleton',
      autoTweetEnabled: false,
      minLikes: 10,
      minPlays: 50,
      minForks: 3,
      trendPollingEnabled: false,
      trendPollIntervalMs: 7200000,
      maxTrendPodcastsPerDay: 3,
      trendSearchQueries: [],
      tweetTemplate: 'test',
      defaultAiModel: null,
      defaultTtsProvider: null,
      defaultTtsModel: null,
      updatedAt: new Date(),
      updatedBy: 'admin-123',
    });

    const result = await getTwitterConfig();

    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('updatedAt');
    expect(result).not.toHaveProperty('updatedBy');
  });
});

describe('setTwitterConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts with partial data and adminId', async () => {
    mockPrismaTwitterConfigUpsert.mockResolvedValue({});

    await setTwitterConfig({ minLikes: 25, autoTweetEnabled: true }, 'admin-456');

    expect(mockPrismaTwitterConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'singleton' },
        update: expect.objectContaining({
          minLikes: 25,
          autoTweetEnabled: true,
          updatedBy: 'admin-456',
        }),
        create: expect.objectContaining({
          id: 'singleton',
          minLikes: 25,
          autoTweetEnabled: true,
          updatedBy: 'admin-456',
        }),
      })
    );
  });

  it('does not include undefined fields in update', async () => {
    mockPrismaTwitterConfigUpsert.mockResolvedValue({});

    await setTwitterConfig({ minPlays: 100 }, 'admin-789');

    const call = mockPrismaTwitterConfigUpsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('minLikes');
    expect(call.update).not.toHaveProperty('autoTweetEnabled');
    expect(call.update.minPlays).toBe(100);
    expect(call.update.updatedBy).toBe('admin-789');
  });

  it('uses defaults for fields not provided in create', async () => {
    mockPrismaTwitterConfigUpsert.mockResolvedValue({});

    await setTwitterConfig({ minForks: 7 }, 'admin-abc');

    const call = mockPrismaTwitterConfigUpsert.mock.calls[0][0];
    expect(call.create.minForks).toBe(7);
    // Other fields should fall back to defaults
    expect(call.create.minLikes).toBe(10);
    expect(call.create.minPlays).toBe(50);
    expect(call.create.autoTweetEnabled).toBe(false);
  });
});
