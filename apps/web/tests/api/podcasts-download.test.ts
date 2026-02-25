import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

const mockPodcastFindUnique = vi.fn();
const mockFetch = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

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

describe('GET /api/podcasts/[podcastId]/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 404 when podcast not found', async () => {
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found or not ready' });
  });

  it('returns 404 when podcast status is not READY', async () => {
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'SCRIPTING',
      visibility: 'PUBLIC',
    });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found or not ready' });
  });

  it('returns 404 when audioUrl is null', async () => {
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: null,
      status: 'READY',
      visibility: 'PUBLIC',
    });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found or not ready' });
  });

  it('returns 403 when podcast is private', async () => {
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PRIVATE',
    });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'This podcast is private' });
  });

  it('returns 502 when audio fetch fails', async () => {
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
    });
    mockFetch.mockResolvedValue({ ok: false, body: null });

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ error: 'Audio file not available' });
  });

  it('returns 502 when fetch throws an error', async () => {
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test Podcast',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
    });
    mockFetch.mockRejectedValue(new Error('Network error'));

    const response = await GET(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ error: 'Failed to fetch audio' });
  });

  it('streams audio with correct Content-Disposition header on success', async () => {
    mockPodcastFindUnique.mockResolvedValue({
      title: 'My Great Podcast!',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
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
    mockPodcastFindUnique.mockResolvedValue({
      title: 'Test <script>alert("xss")</script>',
      audioUrl: 'https://example.com/audio.mp3',
      status: 'READY',
      visibility: 'PUBLIC',
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
