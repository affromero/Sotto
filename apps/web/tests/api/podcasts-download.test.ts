import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockUserFindUniqueOrThrow = vi.fn();
const mockHasByokKey = vi.fn();
const mockFetch = vi.fn();

vi.mock('@/lib/auth', () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/byok', () => ({
  hasByokKey: (...args: unknown[]) => mockHasByokKey(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock global fetch for audio download
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

import { GET } from '@/app/api/podcasts/[podcastId]/download/route';

function createRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/download'));
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

function mockProSession(userId = 'user-1') {
  mockAuth.mockResolvedValue({ user: { id: userId, role: 'USER' } });
  mockUserFindUniqueOrThrow.mockResolvedValue({ plan: 'PRO', role: 'USER' });
  mockHasByokKey.mockResolvedValue(false);
}

function mockFreeSession(userId = 'user-1') {
  mockAuth.mockResolvedValue({ user: { id: userId, role: 'USER' } });
  mockUserFindUniqueOrThrow.mockResolvedValue({ plan: 'FREE', role: 'USER' });
  mockHasByokKey.mockResolvedValue(false);
}

function mockAdminSession(userId = 'admin-1') {
  mockAuth.mockResolvedValue({ user: { id: userId, role: 'ADMIN' } });
  mockUserFindUniqueOrThrow.mockResolvedValue({ plan: 'FREE', role: 'ADMIN' });
  mockHasByokKey.mockResolvedValue(false);
}

describe('GET /api/podcasts/[podcastId]/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 403 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Download requires a Pro subscription.' });
  });

  it('returns 403 when free-tier user tries to download', async () => {
    mockFreeSession('user-2');
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Download requires a Pro subscription.' });
  });

  it('allows owner to download even on free tier', async () => {
    mockFreeSession('user-1');
    mockPodcastFindUnique.mockResolvedValue({
      title: 'My Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });
    const mockBody = new ReadableStream();
    mockFetch.mockResolvedValue({ ok: true, body: mockBody });

    const response = await GET(createRequest(), await createParams('pod-1'));

    expect(response.status).toBe(200);
    // Should NOT look up user tier since owner bypass kicks in
    expect(mockUserFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('allows pro user to download others podcasts', async () => {
    mockProSession('user-2');
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });
    const mockBody = new ReadableStream();
    mockFetch.mockResolvedValue({ ok: true, body: mockBody });

    const response = await GET(createRequest(), await createParams('pod-1'));

    expect(response.status).toBe(200);
  });

  it('allows admin to download on free tier', async () => {
    mockAdminSession('admin-1');
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });
    const mockBody = new ReadableStream();
    mockFetch.mockResolvedValue({ ok: true, body: mockBody });

    const response = await GET(createRequest(), await createParams('pod-1'));

    expect(response.status).toBe(200);
  });

  it('returns 404 when podcast not found', async () => {
    mockProSession();
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found or not ready' });
  });

  it('returns 404 when podcast status is not READY', async () => {
    mockProSession();
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'SCRIPTING',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found or not ready' });
  });

  it('returns 404 when audioUrl is null', async () => {
    mockProSession();
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: null,
      status: 'READY',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found or not ready' });
  });

  it('returns 403 when podcast is private', async () => {
    mockProSession();
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PRIVATE',
      userId: 'user-1',
    });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'This podcast is private' });
  });

  it('returns 502 when audio fetch fails', async () => {
    mockProSession('user-1');
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });
    mockFetch.mockResolvedValue({ ok: false, body: null });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ error: 'Audio file not available' });
  });

  it('returns 502 when fetch throws an error', async () => {
    mockProSession('user-1');
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });
    mockFetch.mockRejectedValue(new Error('Network error'));

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ error: 'Failed to fetch audio' });
  });

  it('streams audio with correct Content-Disposition header on success', async () => {
    mockProSession('user-1');
    mockPodcastFindUnique.mockResolvedValue({
      title: 'My Great Podcast!',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });
    const mockBody = new ReadableStream();
    mockFetch.mockResolvedValue({ ok: true, body: mockBody });

    const response = await GET(createRequest(), await createParams('pod-1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="My Great Podcast.mp3"');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  it('sanitizes special characters in filename', async () => {
    mockProSession('user-1');
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test <script>alert("xss")</script>',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
      userId: 'user-1',
    });
    const mockBody = new ReadableStream();
    mockFetch.mockResolvedValue({ ok: true, body: mockBody });

    const response = await GET(createRequest(), await createParams('pod-1'));

    expect(response.status).toBe(200);
    // Special characters removed, only alphanumeric + space + _ + - remain
    const disposition = response.headers.get('Content-Disposition');
    expect(disposition).not.toContain('<');
    expect(disposition).not.toContain('>');
    expect(disposition).toContain('.mp3');
  });
});
