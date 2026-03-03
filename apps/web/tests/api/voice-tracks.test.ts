import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockVoiceTrackFindMany = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    voiceTrack: {
      findMany: (...args: unknown[]) => mockVoiceTrackFindMany(...args),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
    },
    voiceTrackVoice: { createMany: vi.fn() },
    voiceTrackSegment: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    voicePurchase: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

// Mock remaining deps so the module can be imported without errors
vi.mock('@/lib/queue', () => ({
  voiceTrackAudioQueue: { name: 'voice-track-audio' },
  addJob: vi.fn(),
  JobType: { GENERATE_VOICE_TRACK_AUDIO: 'GENERATE_VOICE_TRACK_AUDIO' },
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/generation-gate', () => ({
  checkGenerationGate: vi.fn().mockResolvedValue({ allowed: true, reason: 'ok', isProUser: false, isByokUser: true }),
}));

vi.mock('@/lib/tier-features', () => ({
  getTierFeatures: vi.fn().mockReturnValue({ voiceTracksEnabled: true, maxVoiceTracks: 10 }),
}));

vi.mock('@/lib/voice-pricing', () => ({
  computeVoiceCharges: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/providers', () => ({
  resolveTtsProvider: vi.fn().mockResolvedValue({ providerId: 'elevenlabs' }),
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

import { GET } from '@/app/api/podcasts/[podcastId]/voice-tracks/route';

const ownerSession = {
  user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner', role: 'USER' },
  expires: '2026-12-31',
};

const otherSession = {
  user: { id: 'viewer-1', email: 'viewer@example.com', name: 'Viewer', role: 'USER' },
  expires: '2026-12-31',
};

const mockTracks = [
  { id: 'track-1', name: 'Default', status: 'READY', audioUrl: 'https://example.com/t1.mp3', duration: 300, ttsProvider: 'elevenlabs', ttsModel: null, voices: [], proposalStatus: null, proposalMessage: null, contributor: null },
  { id: 'track-2', name: 'Failed', status: 'FAILED', audioUrl: null, duration: null, ttsProvider: 'elevenlabs', ttsModel: null, failureReason: 'TTS provider error', voices: [], proposalStatus: null, proposalMessage: null, contributor: null },
  { id: 'track-3', name: 'Proposed', status: 'READY', audioUrl: 'https://example.com/t3.mp3', duration: 250, ttsProvider: 'elevenlabs', ttsModel: null, voices: [], proposalStatus: 'PENDING', proposalMessage: 'Great version!', contributor: { id: 'contrib-1', name: 'Contrib', handle: null, image: null } },
];

function createGetRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/voice-tracks'));
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

  it('returns 403 for private podcast when user is not owner', async () => {
    mockAuth.mockResolvedValue(otherSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', visibility: 'PRIVATE' });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Forbidden');
  });

  it('returns all tracks with failureReason when user is owner', async () => {
    mockAuth.mockResolvedValue(ownerSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', visibility: 'PUBLIC' });
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
      }),
    );
  });

  it('filters tracks for non-owner (only READY + non-pending proposals)', async () => {
    mockAuth.mockResolvedValue(otherSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', visibility: 'PUBLIC' });
    mockVoiceTrackFindMany.mockResolvedValue([mockTracks[0]]);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);

    // Verify non-owner query includes status and proposalStatus filters
    expect(mockVoiceTrackFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          podcastId: 'pod-1',
          status: 'READY',
        }),
        select: expect.objectContaining({ failureReason: false }),
      }),
    );
  });

  it('allows unauthenticated access to public podcast tracks', async () => {
    mockAuth.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', visibility: 'PUBLIC' });
    mockVoiceTrackFindMany.mockResolvedValue([mockTracks[0]]);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
  });

  it('returns 403 for private podcast when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', visibility: 'PRIVATE' });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ podcastId: 'pod-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Forbidden');
  });
});
