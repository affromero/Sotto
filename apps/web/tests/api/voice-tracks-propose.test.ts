import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockVoiceTrackFindUnique = vi.fn();
const mockVoiceTrackFindFirst = vi.fn();
const mockVoiceTrackCreate = vi.fn();
const mockVoiceTrackVoiceCreateMany = vi.fn();
const mockVoiceTrackSegmentCreateMany = vi.fn();
const mockUserFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockAddJob = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/auth-guards', () => ({
  checkSuspension: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    voiceTrack: {
      findUnique: (...args: unknown[]) => mockVoiceTrackFindUnique(...args),
      findFirst: (...args: unknown[]) => mockVoiceTrackFindFirst(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    $transaction: (callback: unknown) => mockTransaction(callback),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/queue', () => ({
  notificationQueue: { name: 'notification' },
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    SEND_NOTIFICATION: 'SEND_NOTIFICATION',
  },
}));

vi.mock('@/lib/api-response', async () => {
  const actual = await vi.importActual('@/lib/api-response');
  return actual;
});

import { POST } from '@/app/api/podcasts/[podcastId]/voice-tracks/[trackId]/propose/route';

const mockSession = {
  user: { id: 'user-1', email: 'test@example.com', name: 'Test User', role: 'USER' },
  expires: '2026-12-31',
};

const mockForkPodcast = {
  userId: 'user-1',
  isVoiceOnlyFork: true,
  forkedFromId: 'original-pod-1',
  title: 'My Voice Fork',
};

const mockSourceTrack = {
  id: 'track-1',
  podcastId: 'fork-pod-1',
  status: 'READY',
  name: 'British Narrator',
  audioUrl: 'https://r2.example.com/audio/track.mp3',
  duration: 300,
  fileSize: 5000000,
  ttsProvider: 'elevenlabs',
  ttsModel: 'eleven_multilingual_v2',
  voices: [
    { speaker: 'HOST', voiceId: 'voice-1', provider: 'elevenlabs' },
  ],
  segments: [
    { segmentId: 'seg-1', audioUrl: 'https://r2.example.com/seg1.mp3', duration: 150, startTime: 0, order: 0 },
    { segmentId: 'seg-2', audioUrl: 'https://r2.example.com/seg2.mp3', duration: 150, startTime: 150, order: 1 },
  ],
};

const mockOriginalPodcast = {
  id: 'original-pod-1',
  userId: 'original-owner',
  title: 'Original Podcast',
};

function createRequest(body: Record<string, unknown> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/podcasts/fork-pod-1/voice-tracks/track-1/propose');
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/podcasts/[podcastId]/voice-tracks/[trackId]/propose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'fork-pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Unauthorized');
  });

  it('returns 404 when fork podcast does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'nonexistent', trackId: 'track-1' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Podcast not found');
  });

  it('returns 403 when user does not own the fork podcast', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ ...mockForkPodcast, userId: 'other-user' });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'fork-pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Forbidden');
  });

  it('returns 400 when podcast is not a voice-only fork', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ ...mockForkPodcast, isVoiceOnlyFork: false });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'fork-pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Only voice-only forks can propose renditions');
  });

  it('returns 404 when voice track does not exist or belongs to different podcast', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockForkPodcast);
    mockVoiceTrackFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'fork-pod-1', trackId: 'nonexistent' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Voice track not found');
  });

  it('returns 400 when voice track is not READY', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(mockForkPodcast);
    mockVoiceTrackFindUnique.mockResolvedValue({ ...mockSourceTrack, status: 'GENERATING_AUDIO' });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'fork-pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Voice track must be READY before proposing');
  });

  it('returns 404 when original podcast no longer exists', async () => {
    mockAuth.mockResolvedValue(mockSession);
    // First call: fork podcast; Second call: original podcast
    mockPodcastFindUnique
      .mockResolvedValueOnce(mockForkPodcast)
      .mockResolvedValueOnce(null);
    mockVoiceTrackFindUnique.mockResolvedValue(mockSourceTrack);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'fork-pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Original podcast no longer exists');
  });

  it('returns 409 when a pending proposal already exists', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique
      .mockResolvedValueOnce(mockForkPodcast)
      .mockResolvedValueOnce(mockOriginalPodcast);
    mockVoiceTrackFindUnique.mockResolvedValue(mockSourceTrack);
    mockVoiceTrackFindFirst.mockResolvedValue({ id: 'existing-proposal' });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'fork-pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'You already have a pending proposal for this podcast');
  });

  it('creates proposed track on original podcast and returns 201', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique
      .mockResolvedValueOnce(mockForkPodcast)
      .mockResolvedValueOnce(mockOriginalPodcast);
    mockVoiceTrackFindUnique.mockResolvedValue(mockSourceTrack);
    mockVoiceTrackFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ name: 'Test User' });
    mockAddJob.mockResolvedValue(undefined);

    const proposedTrack = { id: 'proposed-track-1' };
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        voiceTrack: { create: mockVoiceTrackCreate },
        voiceTrackVoice: { createMany: mockVoiceTrackVoiceCreateMany },
        voiceTrackSegment: { createMany: mockVoiceTrackSegmentCreateMany },
      };
      return callback(tx);
    });
    mockVoiceTrackCreate.mockResolvedValue(proposedTrack);
    mockVoiceTrackVoiceCreateMany.mockResolvedValue({ count: 1 });
    mockVoiceTrackSegmentCreateMany.mockResolvedValue({ count: 2 });

    const response = await POST(createRequest({ message: 'Great rendition!' }), {
      params: Promise.resolve({ podcastId: 'fork-pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ id: 'proposed-track-1', podcastId: 'original-pod-1' });
  });

  it('sends notification to original podcast owner', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique
      .mockResolvedValueOnce(mockForkPodcast)
      .mockResolvedValueOnce(mockOriginalPodcast);
    mockVoiceTrackFindUnique.mockResolvedValue(mockSourceTrack);
    mockVoiceTrackFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ name: 'Test User' });
    mockAddJob.mockResolvedValue(undefined);

    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        voiceTrack: { create: mockVoiceTrackCreate },
        voiceTrackVoice: { createMany: mockVoiceTrackVoiceCreateMany },
        voiceTrackSegment: { createMany: mockVoiceTrackSegmentCreateMany },
      };
      return callback(tx);
    });
    mockVoiceTrackCreate.mockResolvedValue({ id: 'proposed-track-1' });
    mockVoiceTrackVoiceCreateMany.mockResolvedValue({ count: 1 });
    mockVoiceTrackSegmentCreateMany.mockResolvedValue({ count: 2 });

    await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'fork-pod-1', trackId: 'track-1' }),
    });

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'notification' }),
      'SEND_NOTIFICATION',
      expect.objectContaining({
        userId: 'original-owner',
        type: 'RENDITION_PROPOSED',
      }),
    );
  });
});
