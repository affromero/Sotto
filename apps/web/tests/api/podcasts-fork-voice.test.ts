import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Module-scope mock functions
const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastCreate = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockPodcastVoiceCreateMany = vi.fn();
const mockVoiceTrackCreate = vi.fn();
const mockVoiceTrackVoiceCreateMany = vi.fn();
const mockVoiceTrackSegmentCreateMany = vi.fn();
const mockVoiceTrackSegmentFindMany = vi.fn();
const mockVoicePurchaseFindUnique = vi.fn();
const mockVoicePurchaseUpdateMany = vi.fn();
const mockTransaction = vi.fn();
const mockCheckGenerationGate = vi.fn();
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
      create: (...args: unknown[]) => mockPodcastCreate(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    podcastVoice: {
      createMany: (...args: unknown[]) => mockPodcastVoiceCreateMany(...args),
    },
    voiceTrack: {
      create: (...args: unknown[]) => mockVoiceTrackCreate(...args),
    },
    voiceTrackVoice: {
      createMany: (...args: unknown[]) => mockVoiceTrackVoiceCreateMany(...args),
    },
    voiceTrackSegment: {
      createMany: (...args: unknown[]) => mockVoiceTrackSegmentCreateMany(...args),
      findMany: (...args: unknown[]) => mockVoiceTrackSegmentFindMany(...args),
    },
    voicePurchase: {
      findUnique: (...args: unknown[]) => mockVoicePurchaseFindUnique(...args),
      updateMany: (...args: unknown[]) => mockVoicePurchaseUpdateMany(...args),
    },
    $transaction: (callback: unknown) => mockTransaction(callback),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/queue', () => ({
  voiceTrackAudioQueue: { name: 'voice-track-audio' },
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    GENERATE_VOICE_TRACK_AUDIO: 'GENERATE_VOICE_TRACK_AUDIO',
  },
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/generation-gate', () => ({
  checkGenerationGate: (...args: unknown[]) => mockCheckGenerationGate(...args),
}));

vi.mock('@/lib/voice-pricing', () => ({
  computeVoiceCharges: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/providers', () => ({
  resolveTtsProvider: vi.fn().mockResolvedValue({ providerId: 'elevenlabs' }),
}));

vi.mock('@/lib/slugify', () => ({
  generatePodcastSlug: vi.fn().mockResolvedValue('test-slug'),
}));

vi.mock('@/lib/validations', async () => {
  const actual = await vi.importActual('@/lib/validations');
  return actual;
});

vi.mock('@/lib/api-response', async () => {
  const actual = await vi.importActual('@/lib/api-response');
  return actual;
});

import { POST } from '@/app/api/podcasts/[podcastId]/fork-voice/route';

const mockSession = {
  user: { id: 'user-1', email: 'test@example.com', name: 'Test User', role: 'USER' },
  expires: '2026-12-31',
};

const mockSourcePodcast = {
  id: 'source-pod-1',
  userId: 'creator-user-1',
  title: 'Quantum Computing 101',
  topic: 'An introduction to quantum computing',
  status: 'READY',
  visibility: 'PUBLIC',
  segments: [
    { id: 'seg-1', speaker: 'HOST', text: 'Hello world', order: 0 },
    { id: 'seg-2', speaker: 'EXPERT', text: 'Welcome to the show', order: 1 },
  ],
};

const validBody = {
  name: 'My Rendition',
  voices: [
    { speaker: 'HOST', voiceId: 'voice-1' },
    { speaker: 'EXPERT', voiceId: 'voice-2' },
  ],
};

function createRequest(body: Record<string, unknown> = validBody): NextRequest {
  const url = new URL('http://localhost:3000/api/podcasts/source-pod-1/fork-voice');
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupSuccessMocks(userId = 'user-1') {
  mockAuth.mockResolvedValue({ ...mockSession, user: { ...mockSession.user, id: userId } });
  mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isProUser: false, isByokUser: true });
  mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);
  mockAddJob.mockResolvedValue(undefined);

  const mockTrack = { id: 'track-1', status: 'GENERATING_AUDIO' };
  const mockFork = { id: 'fork-pod-1' };

  mockTransaction.mockImplementation(async (callback) => {
    const tx = {
      podcast: {
        create: mockPodcastCreate,
        update: mockPodcastUpdate,
      },
      podcastVoice: {
        createMany: mockPodcastVoiceCreateMany,
      },
      voiceTrack: {
        create: mockVoiceTrackCreate,
      },
      voiceTrackVoice: {
        createMany: mockVoiceTrackVoiceCreateMany,
      },
      voiceTrackSegment: {
        createMany: mockVoiceTrackSegmentCreateMany,
      },
    };
    return callback(tx);
  });

  mockPodcastCreate.mockResolvedValue(mockFork);
  mockVoiceTrackCreate.mockResolvedValue(mockTrack);
  mockPodcastVoiceCreateMany.mockResolvedValue({ count: 2 });
  mockVoiceTrackVoiceCreateMany.mockResolvedValue({ count: 2 });
  mockVoiceTrackSegmentCreateMany.mockResolvedValue({ count: 2 });
  mockPodcastUpdate.mockResolvedValue({});
  mockVoiceTrackSegmentFindMany.mockResolvedValue([
    { id: 'vts-1', segmentId: 'seg-1' },
    { id: 'vts-2', segmentId: 'seg-2' },
  ]);
}

describe('POST /api/podcasts/[podcastId]/fork-voice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Unauthorized');
  });

  it('returns 403 when user is suspended', async () => {
    mockAuth.mockResolvedValue(mockSession);
    const { checkSuspension } = await import('@/lib/auth-guards');
    const mockCheckSuspension = vi.mocked(checkSuspension);
    const { NextResponse } = await import('next/server');
    mockCheckSuspension.mockReturnValueOnce(NextResponse.json({ error: 'Account suspended' }, { status: 403 }));

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(403);
  });

  it('returns 429 when hourly rate limit exceeded', async () => {
    mockAuth.mockResolvedValue(mockSession);
    const { checkRateLimit } = await import('@/lib/redis');
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 3600 });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Rate limit exceeded: max 20 generations per hour.');
  });

  it('returns 403 when generation gate blocks', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckGenerationGate.mockResolvedValue({ allowed: false, reason: 'generation_in_progress' });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('already generating');
  });

  it('returns 400 when body fails validation (empty name)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isProUser: false, isByokUser: true });

    const response = await POST(
      createRequest({ name: '', voices: [{ speaker: 'HOST', voiceId: 'v-1' }] }),
      { params: Promise.resolve({ podcastId: 'source-pod-1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 when body fails validation (no voices)', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isProUser: false, isByokUser: true });

    const response = await POST(
      createRequest({ name: 'Test', voices: [] }),
      { params: Promise.resolve({ podcastId: 'source-pod-1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('returns 404 when source podcast does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isProUser: false, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'nonexistent' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Podcast not found');
  });

  it('returns 403 when source podcast is not PUBLIC', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isProUser: false, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue({ ...mockSourcePodcast, visibility: 'PRIVATE' });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Only public podcasts can be re-voiced');
  });

  it('returns 400 when source podcast is not READY', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isProUser: false, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue({ ...mockSourcePodcast, status: 'PENDING' });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Only podcasts with READY status can be re-voiced');
  });

  it('returns 402 when paid voices require payment', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isProUser: false, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);
    const { computeVoiceCharges } = await import('@/lib/voice-pricing');
    vi.mocked(computeVoiceCharges).mockResolvedValueOnce([{ voiceCloneId: 'voice-1', name: 'Custom Voice', priceInCents: 500, ownerName: 'Owner', platformFeeCents: 50 }]);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toHaveProperty('requiresPayment', true);
    expect(body).toHaveProperty('voiceCharges');
  });

  it('returns 400 for invalid payment intent', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckGenerationGate.mockResolvedValue({ allowed: true, reason: 'ok', isProUser: false, isByokUser: true });
    mockPodcastFindUnique.mockResolvedValue(mockSourcePodcast);
    mockVoicePurchaseFindUnique.mockResolvedValue(null);

    const response = await POST(
      createRequest({ ...validBody, paymentIntentIds: ['pi_invalid'] }),
      { params: Promise.resolve({ podcastId: 'source-pod-1' }) },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Invalid or unauthorized payment');
  });

  it('creates fork podcast and voice track on success (201)', async () => {
    setupSuccessMocks();

    const response = await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('id', 'fork-pod-1');
    expect(body).toHaveProperty('voiceTrackId', 'track-1');
  });

  it('enqueues audio generation jobs for each segment', async () => {
    setupSuccessMocks();

    await POST(createRequest(), {
      params: Promise.resolve({ podcastId: 'source-pod-1' }),
    });

    expect(mockAddJob).toHaveBeenCalledTimes(2);
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'voice-track-audio' }),
      'GENERATE_VOICE_TRACK_AUDIO',
      expect.objectContaining({
        podcastId: 'fork-pod-1',
        voiceTrackId: 'track-1',
      }),
    );
  });
});
