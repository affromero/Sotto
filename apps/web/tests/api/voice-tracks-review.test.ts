import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockVoiceTrackFindUnique = vi.fn();
const mockVoiceTrackUpdate = vi.fn();
const mockAddJob = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    voiceTrack: {
      findUnique: (...args: unknown[]) => mockVoiceTrackFindUnique(...args),
      update: (...args: unknown[]) => mockVoiceTrackUpdate(...args),
    },
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

import { PATCH } from '@/app/api/podcasts/[podcastId]/voice-tracks/[trackId]/review/route';

const mockSession = {
  user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner', role: 'USER' },
  expires: '2026-12-31',
};

function createRequest(body: Record<string, unknown>): NextRequest {
  const url = new URL('http://localhost:3000/api/podcasts/pod-1/voice-tracks/track-1/review');
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PATCH /api/podcasts/[podcastId]/voice-tracks/[trackId]/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await PATCH(createRequest({ action: 'accept' }), {
      params: Promise.resolve({ podcastId: 'pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Unauthorized');
  });

  it('returns 404 when podcast does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await PATCH(createRequest({ action: 'accept' }), {
      params: Promise.resolve({ podcastId: 'nonexistent', trackId: 'track-1' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Podcast not found');
  });

  it('returns 403 when user does not own the podcast', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'other-user', title: 'Test Pod' });

    const response = await PATCH(createRequest({ action: 'accept' }), {
      params: Promise.resolve({ podcastId: 'pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Forbidden');
  });

  it('returns 404 when voice track does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', title: 'My Podcast' });
    mockVoiceTrackFindUnique.mockResolvedValue(null);

    const response = await PATCH(createRequest({ action: 'accept' }), {
      params: Promise.resolve({ podcastId: 'pod-1', trackId: 'nonexistent' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Voice track not found');
  });

  it('returns 404 when voice track belongs to a different podcast', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', title: 'My Podcast' });
    mockVoiceTrackFindUnique.mockResolvedValue({
      podcastId: 'other-pod',
      proposalStatus: 'PENDING',
      contributorId: 'contrib-1',
      name: 'Track',
    });

    const response = await PATCH(createRequest({ action: 'accept' }), {
      params: Promise.resolve({ podcastId: 'pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Voice track not found');
  });

  it('returns 400 when proposal is not PENDING', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', title: 'My Podcast' });
    mockVoiceTrackFindUnique.mockResolvedValue({
      podcastId: 'pod-1',
      proposalStatus: 'ACCEPTED',
      contributorId: 'contrib-1',
      name: 'Track',
    });

    const response = await PATCH(createRequest({ action: 'accept' }), {
      params: Promise.resolve({ podcastId: 'pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Only pending proposals can be reviewed');
  });

  it('accepts a pending proposal and notifies contributor', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', title: 'My Podcast' });
    mockVoiceTrackFindUnique.mockResolvedValue({
      podcastId: 'pod-1',
      proposalStatus: 'PENDING',
      contributorId: 'contrib-1',
      name: 'British Narrator',
    });
    mockVoiceTrackUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);

    const response = await PATCH(createRequest({ action: 'accept' }), {
      params: Promise.resolve({ podcastId: 'pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, action: 'accept' });

    expect(mockVoiceTrackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'track-1' },
        data: expect.objectContaining({ proposalStatus: 'ACCEPTED' }),
      }),
    );

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'notification' }),
      'SEND_NOTIFICATION',
      expect.objectContaining({
        userId: 'contrib-1',
        type: 'RENDITION_ACCEPTED',
      }),
    );
  });

  it('rejects a pending proposal with reason and notifies contributor', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', title: 'My Podcast' });
    mockVoiceTrackFindUnique.mockResolvedValue({
      podcastId: 'pod-1',
      proposalStatus: 'PENDING',
      contributorId: 'contrib-1',
      name: 'Casual Style',
    });
    mockVoiceTrackUpdate.mockResolvedValue({});
    mockAddJob.mockResolvedValue(undefined);

    const response = await PATCH(
      createRequest({ action: 'reject', rejectionReason: 'Not a good fit' }),
      { params: Promise.resolve({ podcastId: 'pod-1', trackId: 'track-1' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, action: 'reject' });

    expect(mockVoiceTrackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proposalStatus: 'REJECTED',
          rejectionReason: 'Not a good fit',
        }),
      }),
    );

    expect(mockAddJob).toHaveBeenCalledWith(
      expect.anything(),
      'SEND_NOTIFICATION',
      expect.objectContaining({
        type: 'RENDITION_REJECTED',
        message: expect.stringContaining('Not a good fit'),
      }),
    );
  });

  it('skips notification when there is no contributorId', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockPodcastFindUnique.mockResolvedValue({ userId: 'owner-1', title: 'My Podcast' });
    mockVoiceTrackFindUnique.mockResolvedValue({
      podcastId: 'pod-1',
      proposalStatus: 'PENDING',
      contributorId: null,
      name: 'Track',
    });
    mockVoiceTrackUpdate.mockResolvedValue({});

    const response = await PATCH(createRequest({ action: 'accept' }), {
      params: Promise.resolve({ podcastId: 'pod-1', trackId: 'track-1' }),
    });

    expect(response.status).toBe(200);
    expect(mockAddJob).not.toHaveBeenCalled();
  });
});
