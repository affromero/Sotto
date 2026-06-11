import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockPodcastCreate = vi.fn();
const mockPodcastUpdate = vi.fn();
const mockDiscoveryCreate = vi.fn();
const mockAddJob = vi.fn();
const mockGetAutoModelConfig = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: async () => {
    const session = await mockAuth();
    if (!session?.user?.id) return null;
    if (session.user.role !== 'ADMIN') return null;
    return session.user.id;
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      create: (...args: unknown[]) => mockPodcastCreate(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
    discovery: {
      create: (...args: unknown[]) => mockDiscoveryCreate(...args),
    },
  },
  prismaUnfiltered: {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
      update: (...args: unknown[]) => mockPodcastUpdate(...args),
    },
  },
}));

vi.mock('@/lib/queue', () => ({
  contentExtractionQueue: { name: 'content-extraction' },
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { EXTRACT_CONTENT: 'extract_content' },
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
}));

import { POST } from '@/app/api/admin/podcasts/create-as-system-owner/route';
import { DELETE } from '@/app/api/admin/podcasts/[podcastId]/route';

function createPostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/podcasts/create-as-system-owner'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/podcasts/pod-1'), {
    method: 'DELETE',
  });
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

describe('POST /api/admin/podcasts/create-as-system-owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SYSTEM_USER_HANDLE', 'system');
    mockGetAutoModelConfig.mockResolvedValue({
      model: {
        aiProvider: 'openai',
        aiModel: 'gpt-5-mini',
        ttsProvider: 'openai',
        ttsModel: 'tts-1-hd',
        sttProvider: 'openai',
        sttModel: 'whisper-1',
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createPostRequest({ title: 'Test', topic: 'Test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const request = createPostRequest({ title: 'Test', topic: 'Test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 404 when system owner account is not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockUserFindUnique.mockResolvedValueOnce(null);

    const request = createPostRequest({ title: 'Test', topic: 'Test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain('Configured system owner @system was not found');
  });

  it('returns 400 when title or topic missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockUserFindUnique.mockResolvedValueOnce({ id: 'system-owner-id' });

    const request = createPostRequest({ title: 'Test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'title and topic are required' });
  });

  it('creates podcast owned by the system owner successfully (no metadata)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockUserFindUnique.mockResolvedValueOnce({ id: 'system-owner-id' });
    mockPodcastCreate.mockResolvedValue({
      id: 'pod-1',
      userId: 'system-owner-id',
      title: 'Test Podcast',
      topic: 'AI',
      status: 'PENDING',
      visibility: 'PUBLIC',
      source: 'WEB',
    });

    const request = createPostRequest({ title: 'Test Podcast', topic: 'AI' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: 'pod-1', status: 'PENDING' });
    expect(mockDiscoveryCreate).not.toHaveBeenCalled();
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('creates podcast with metadata, Discovery, and queues pipeline', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockUserFindUnique.mockResolvedValueOnce({ id: 'system-owner-id' });
    mockPodcastCreate.mockResolvedValue({
      id: 'pod-2',
      status: 'EXTRACTING',
    });
    mockDiscoveryCreate.mockResolvedValue({ id: 'disc-1' });
    mockAddJob.mockResolvedValue({ id: 'job-1' });

    const metadata = {
      topic: 'Sotto Features',
      depth: 'quick_overview',
      audience: 'New users',
      audienceLevel: 'beginner',
      tone: 'casual',
      focusAreas: ['AI generation', 'Private feeds'],
      durationTarget: 2,
      speakers: [
        { name: 'Host', description: 'Warm guide' },
        { name: 'Expert', description: 'Product expert' },
      ],
    };

    const request = createPostRequest({
      title: 'Sotto Features',
      topic: 'Sotto Features',
      metadata,
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: 'pod-2', status: 'EXTRACTING' });
    expect(mockPodcastCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aiProvider: 'openai',
        aiModel: 'gpt-5-mini',
      }),
    });

    // Discovery record created with system owner user ID
    expect(mockDiscoveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        podcastId: 'pod-2',
        userId: 'system-owner-id',
        topic: 'Sotto Features',
        durationTarget: 2,
      }),
    });

    // Pipeline job queued with admin priority
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'content-extraction' }),
      'extract_content',
      expect.objectContaining({
        podcastId: 'pod-2',
        userId: 'system-owner-id',
        useAdminCredits: true,
      }),
      { priority: 1 },
    );
  });
});

describe('DELETE /api/admin/podcasts/[podcastId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 409 when podcast already deleted', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockPodcastFindUnique.mockResolvedValue({
      deletedAt: new Date(),
    });

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: 'Podcast already deleted' });
  });

  it('soft-deletes podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockPodcastFindUnique.mockResolvedValue({
      deletedAt: null,
    });
    mockPodcastUpdate.mockResolvedValue({ id: 'pod-1' });

    const request = createDeleteRequest();
    const params = await createParams('pod-1');
    const response = await DELETE(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockPodcastUpdate).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
