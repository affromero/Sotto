import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockVoiceTrackFindMany = vi.fn();
const mockDiscoveryFindUnique = vi.fn();
const mockResolveTtsProvider = vi.fn();
const mockGetAutoModelConfig = vi.fn();
const mockVoiceTrackCount = vi.fn();
const mockVoiceTrackCreate = vi.fn();
const mockVoiceTrackVoiceCreateMany = vi.fn();
const mockVoiceTrackSegmentCreateMany = vi.fn();
const mockVoiceTrackSegmentFindMany = vi.fn();
const mockVoicePurchaseFindUnique = vi.fn();
const mockVoicePurchaseUpdateMany = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockAddJob = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockDiscoveryFindUnique(...args),
    },
    voiceTrack: {
      findMany: (...args: unknown[]) => mockVoiceTrackFindMany(...args),
      count: (...args: unknown[]) => mockVoiceTrackCount(...args),
      create: (...args: unknown[]) => mockVoiceTrackCreate(...args),
    },
    voiceTrackVoice: { createMany: (...args: unknown[]) => mockVoiceTrackVoiceCreateMany(...args) },
    voiceTrackSegment: {
      createMany: (...args: unknown[]) => mockVoiceTrackSegmentCreateMany(...args),
      findMany: (...args: unknown[]) => mockVoiceTrackSegmentFindMany(...args),
    },
    voicePurchase: {
      findUnique: (...args: unknown[]) => mockVoicePurchaseFindUnique(...args),
      updateMany: (...args: unknown[]) => mockVoicePurchaseUpdateMany(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockScriptFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

// Mock remaining deps so the module can be imported without errors
vi.mock('@/lib/queue', () => ({
  voiceTrackAudioQueue: { name: 'voice-track-audio' },
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { GENERATE_VOICE_TRACK_AUDIO: 'GENERATE_VOICE_TRACK_AUDIO' },
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/tier-features', () => ({
  getTierFeatures: vi.fn().mockReturnValue({ voiceTracksEnabled: true, maxVoiceTracks: 10 }),
}));

vi.mock('@/lib/voice-pricing', () => ({
  computeVoiceCharges: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/providers', () => ({
  resolveTtsProvider: (...args: unknown[]) => mockResolveTtsProvider(...args),
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
}));

vi.mock('@/lib/voice-pool', () => ({
  findVoiceName: vi.fn((voiceId: string) => (voiceId === 'voice-auto' ? 'Auto Voice' : null)),
  formatModelName: vi.fn((modelId: string) => modelId),
}));

vi.mock('@/lib/auth-guards', () => ({
  checkSuspension: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/validations', async () => {
  const actual = await vi.importActual('@/lib/validations');
  return actual;
});

vi.mock('@/lib/api-response', async () => {
  const actual = await vi.importActual('@/lib/api-response');
  return actual;
});

import { GET, POST } from '@/app/api/podcasts/[podcastId]/voice-tracks/route';

const ownerSession = {
  user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner', role: 'USER' },
  expires: '2026-12-31',
};

const otherSession = {
  user: { id: 'viewer-1', email: 'viewer@example.com', name: 'Viewer', role: 'USER' },
  expires: '2026-12-31',
};

const mockTracks = [
  {
    id: 'track-1',
    name: 'Default',
    status: 'READY',
    audioUrl: 'https://example.com/t1.mp3',
    duration: 300,
    ttsProvider: 'elevenlabs',
    ttsModel: null,
    voices: [],
    proposalStatus: null,
    proposalMessage: null,
    contributor: null,
  },
  {
    id: 'track-2',
    name: 'Failed',
    status: 'FAILED',
    audioUrl: null,
    duration: null,
    ttsProvider: 'elevenlabs',
    ttsModel: null,
    failureReason: 'TTS provider error',
    voices: [],
    proposalStatus: null,
    proposalMessage: null,
    contributor: null,
  },
  {
    id: 'track-3',
    name: 'Proposed',
    status: 'READY',
    audioUrl: 'https://example.com/t3.mp3',
    duration: 250,
    ttsProvider: 'elevenlabs',
    ttsModel: null,
    voices: [],
    proposalStatus: 'PENDING',
    proposalMessage: 'Great version!',
    contributor: { id: 'contrib-1', name: 'Contrib', handle: null, image: null },
  },
];

function createGetRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/voice-tracks'));
}

function createPostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/voice-tracks'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/podcasts/[podcastId]/voice-tracks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuth.mockResolvedValue(ownerSession);
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'nonexistent' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Podcast not found');
  });

  it('returns 403 when user is not owner', async () => {
    mockAuth.mockResolvedValue(otherSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1' });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Forbidden');
  });

  it('returns all tracks with failureReason when user is owner', async () => {
    mockAuth.mockResolvedValue(ownerSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1' });
    mockVoiceTrackFindMany.mockResolvedValue(mockTracks);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(3);

    // Verify the findMany was called without filtering (owner sees all)
    expect(mockVoiceTrackFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ podcastId: 'pod-1' }),
        select: expect.objectContaining({ failureReason: true }),
      })
    );
  });

  it('returns 403 for non-owner public tracks', async () => {
    mockAuth.mockResolvedValue(otherSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1' });
    mockVoiceTrackFindMany.mockResolvedValue([mockTracks[0]]);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(403);
    expect(mockVoiceTrackFindMany).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1' });
    mockVoiceTrackFindMany.mockResolvedValue([mockTracks[0]]);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Unauthorized');
    expect(mockPodcastFindUnique).not.toHaveBeenCalled();
  });

  it('does not query podcast when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1' });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Unauthorized');
    expect(mockPodcastFindUnique).not.toHaveBeenCalled();
  });
});

describe('POST /api/podcasts/[podcastId]/voice-tracks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(ownerSession);
    mockPodcastFindUnique.mockResolvedValue({
      userId: 'owner-1',
      status: 'READY',
      segments: [{ id: 'seg-1', speaker: 'HOST', text: 'Hello', order: 0 }],
    });
    mockVoiceTrackCount.mockResolvedValue(0);
    mockVoiceTrackFindMany.mockResolvedValue([]);
    mockDiscoveryFindUnique.mockResolvedValue(null);
    mockResolveTtsProvider.mockResolvedValue({
      providerId: 'elevenlabs',
      provider: {
        getModelId: () => 'eleven_v3',
        getVoiceId: () => 'voice-auto',
      },
    });
    mockGetAutoModelConfig.mockResolvedValue({
      model: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
        ttsProvider: 'openai',
        ttsModel: 'tts-1-hd',
        sttProvider: 'openai',
        sttModel: 'whisper-1',
      },
      platform: {
        aiProvider: 'anthropic',
        aiModel: 'claude-haiku-4-5-20251001',
      },
    });
    mockVoiceTrackCreate.mockResolvedValue({
      id: 'track-new',
      status: 'GENERATING_AUDIO',
    });
    mockVoiceTrackVoiceCreateMany.mockResolvedValue({ count: 1 });
    mockVoiceTrackSegmentCreateMany.mockResolvedValue({ count: 1 });
    mockVoiceTrackSegmentFindMany.mockResolvedValue([{ id: 'vtseg-1', segmentId: 'seg-1' }]);
    mockScriptFindUnique.mockResolvedValue({ turns: [{ speaker: 'HOST', text: 'Hello' }] });
    mockAddJob.mockResolvedValue({ id: 'job-1' });
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        voiceTrack: { create: mockVoiceTrackCreate },
        voiceTrackVoice: { createMany: mockVoiceTrackVoiceCreateMany },
        voiceTrackSegment: { createMany: mockVoiceTrackSegmentCreateMany },
      })
    );
  });

  it('uses auto-model provider for providerless voices', async () => {
    const response = await POST(
      createPostRequest({
        voices: [{ speaker: 'HOST', voiceId: '' }],
      }),
      { params: Promise.resolve({ podcastId: 'pod-1' }) }
    );

    expect(response.status).toBe(201);
    expect(mockResolveTtsProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedProvider: 'openai',
        requestedModel: 'tts-1-hd',
      })
    );
  });
});
