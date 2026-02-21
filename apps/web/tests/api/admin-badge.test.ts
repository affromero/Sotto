import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockModerationActionCreate = vi.fn();
const mockTransaction = vi.fn();
const mockAddJob = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    moderationAction: {
      create: (...args: unknown[]) => mockModerationActionCreate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock('@/lib/queue', () => ({
  notificationQueue: 'notification-queue',
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { SEND_NOTIFICATION: 'send-notification' },
}));

import { PATCH } from '@/app/api/admin/podcasts/[podcastId]/badge/route';

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/podcasts/pod-1/badge'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

describe('PATCH /api/admin/podcasts/[podcastId]/badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddJob.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest({ isHumanContent: false, reason: 'False claim' });
    const params = await createParams('pod-1');
    const response = await PATCH(request, params);

    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const request = createRequest({ isHumanContent: false, reason: 'False claim' });
    const params = await createParams('pod-1');
    const response = await PATCH(request, params);

    expect(response.status).toBe(403);
  });

  it('returns 404 when podcast not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createRequest({ isHumanContent: false, reason: 'False claim' });
    const params = await createParams('pod-1');
    const response = await PATCH(request, params);

    expect(response.status).toBe(404);
  });

  it('returns 400 for invalid body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const request = createRequest({ isHumanContent: 'not-boolean' });
    const params = await createParams('pod-1');
    const response = await PATCH(request, params);

    expect(response.status).toBe(400);
  });

  it('removes human badge and notifies user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockPodcastFindUnique.mockResolvedValue({
      id: 'pod-1',
      title: 'Test Podcast',
      userId: 'user-1',
      isHumanContent: true,
    });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: { update: mockPodcastUpdate },
        moderationAction: { create: mockModerationActionCreate },
      };
      return callback(tx);
    });
    mockPodcastUpdate.mockResolvedValue({ id: 'pod-1' });
    mockModerationActionCreate.mockResolvedValue({ id: 'action-1' });

    const request = createRequest({ isHumanContent: false, reason: 'AI-generated content' });
    const params = await createParams('pod-1');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, isHumanContent: false });

    // Verify podcast update
    expect(mockPodcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pod-1' },
        data: { isHumanContent: false },
      })
    );

    // Verify moderation action created
    expect(mockModerationActionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          moderatorId: 'admin-1',
          action: 'remove_content',
        }),
      })
    );

    // Verify notification sent
    expect(mockAddJob).toHaveBeenCalledWith(
      'notification-queue',
      'send-notification',
      expect.objectContaining({
        userId: 'user-1',
        type: 'CONTENT_REMOVED',
        title: 'Human Badge Removed',
      })
    );
  });

  it('does not notify when badge value unchanged', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockPodcastFindUnique.mockResolvedValue({
      id: 'pod-1',
      title: 'Test Podcast',
      userId: 'user-1',
      isHumanContent: false,
    });
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        podcast: { update: mockPodcastUpdate },
        moderationAction: { create: mockModerationActionCreate },
      };
      return callback(tx);
    });
    mockPodcastUpdate.mockResolvedValue({ id: 'pod-1' });
    mockModerationActionCreate.mockResolvedValue({ id: 'action-1' });

    const request = createRequest({ isHumanContent: false, reason: 'Confirming' });
    const params = await createParams('pod-1');
    await PATCH(request, params);

    expect(mockAddJob).not.toHaveBeenCalled();
  });
});
