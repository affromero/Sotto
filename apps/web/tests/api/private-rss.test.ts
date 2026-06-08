import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockPrivateFeedTokenFindMany = vi.fn();
const mockPrivateFeedTokenCreate = vi.fn();
const mockPrivateFeedTokenFindUnique = vi.fn();
const mockPrivateFeedTokenFindFirst = vi.fn();
const mockPrivateFeedTokenUpdate = vi.fn();
const mockPodcastFindMany = vi.fn();
const mockResolveAudioUrl = vi.fn(async (url: string | null, _visibility?: string) =>
  url ? `https://signed.example.com/${encodeURIComponent(url)}` : null
);

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    privateFeedToken: {
      findMany: (...args: unknown[]) => mockPrivateFeedTokenFindMany(...args),
      create: (...args: unknown[]) => mockPrivateFeedTokenCreate(...args),
      findUnique: (...args: unknown[]) => mockPrivateFeedTokenFindUnique(...args),
      findFirst: (...args: unknown[]) => mockPrivateFeedTokenFindFirst(...args),
      update: (...args: unknown[]) => mockPrivateFeedTokenUpdate(...args),
    },
    podcast: {
      findMany: (...args: unknown[]) => mockPodcastFindMany(...args),
    },
  },
}));

vi.mock('@/lib/r2', () => ({
  resolveAudioUrl: (url: string | null, visibility: string) => mockResolveAudioUrl(url, visibility),
}));

import { GET as listTokens, POST as createToken } from '@/app/api/rss/private/route';
import { GET as readFeed } from '@/app/api/rss/private/[token]/route';
import { DELETE as revokeToken } from '@/app/api/rss/private/tokens/[tokenId]/route';
import { hashPrivateFeedToken } from '@/lib/rss';

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

describe('private RSS token management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://sotto.test';
  });

  it('requires authentication before listing private feed tokens', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await listTokens(request('https://sotto.test/api/rss/private'));

    expect(response.status).toBe(401);
    expect(mockPrivateFeedTokenFindMany).not.toHaveBeenCalled();
  });

  it('lists only active token metadata and never exposes token hashes', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrivateFeedTokenFindMany.mockResolvedValue([
      {
        id: 'feed-token-1',
        name: 'Daily',
        feedType: 'all',
        lastUsedAt: null,
        createdAt: new Date('2026-05-15T10:00:00Z'),
      },
    ]);

    const response = await listTokens(request('https://sotto.test/api/rss/private'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).not.toHaveProperty('tokenHash');
    expect(mockPrivateFeedTokenFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        feedType: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  });

  it('creates a private feed token and stores only its hash', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrivateFeedTokenCreate.mockResolvedValue({ id: 'feed-token-1' });

    const response = await createToken(
      request('https://sotto.test/api/rss/private', {
        method: 'POST',
        body: JSON.stringify({ name: 'Daily Briefing' }),
      })
    );
    const body = await response.json();
    const createArgs = mockPrivateFeedTokenCreate.mock.calls[0][0];

    expect(response.status).toBe(201);
    expect(body.id).toBe('feed-token-1');
    expect(body.token).toEqual(expect.any(String));
    expect(body.feedUrl).toBe(`https://sotto.test/api/rss/private/${body.token}`);
    expect(createArgs.data).toMatchObject({
      userId: 'user-1',
      name: 'Daily Briefing',
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(createArgs.data.tokenHash).toBe(hashPrivateFeedToken(body.token));
    expect(createArgs.data.tokenHash).not.toBe(body.token);
  });

  it('revokes only an active token owned by the authenticated user', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrivateFeedTokenFindFirst.mockResolvedValue({ id: 'feed-token-1' });
    mockPrivateFeedTokenUpdate.mockResolvedValue({ id: 'feed-token-1' });

    const response = await revokeToken(request('https://sotto.test/api/rss/private/tokens/feed-token-1'), {
      params: Promise.resolve({ tokenId: 'feed-token-1' }),
    });

    expect(response.status).toBe(204);
    expect(mockPrivateFeedTokenFindFirst).toHaveBeenCalledWith({
      where: { id: 'feed-token-1', userId: 'user-1', revokedAt: null },
      select: { id: true },
    });
    expect(mockPrivateFeedTokenUpdate).toHaveBeenCalledWith({
      where: { id: 'feed-token-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe('GET /api/rss/private/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://sotto.test';
  });

  it('returns 404 for unknown or revoked tokens', async () => {
    mockPrivateFeedTokenFindUnique.mockResolvedValue(null);

    const unknown = await readFeed(request('https://sotto.test/api/rss/private/raw-token'), {
      params: Promise.resolve({ token: 'raw-token' }),
    });

    expect(unknown.status).toBe(404);
    expect(mockPodcastFindMany).not.toHaveBeenCalled();

    mockPrivateFeedTokenFindUnique.mockResolvedValue({
      id: 'feed-token-1',
      userId: 'user-1',
      name: 'Daily',
      revokedAt: new Date('2026-05-15T10:00:00Z'),
      user: { id: 'user-1', name: 'Alice', bio: null, image: null },
    });

    const revoked = await readFeed(request('https://sotto.test/api/rss/private/raw-token'), {
      params: Promise.resolve({ token: 'raw-token' }),
    });

    expect(revoked.status).toBe(404);
    expect(mockPodcastFindMany).not.toHaveBeenCalled();
  });

  it('renders a private RSS feed for the token owner without filtering to public visibility', async () => {
    const createdAt = new Date('2026-05-15T09:00:00Z');
    mockPrivateFeedTokenFindUnique.mockResolvedValue({
      id: 'feed-token-1',
      userId: 'user-1',
      name: 'Daily Briefing',
      revokedAt: null,
      user: { id: 'user-1', name: 'Alice', bio: 'Internal briefings', image: null },
    });
    mockPrivateFeedTokenUpdate.mockResolvedValue({ id: 'feed-token-1' });
    mockPodcastFindMany.mockResolvedValue([
      {
        id: 'pod-1',
        title: 'Meeting Notes',
        topic: 'Roadmap review',
        audioUrl: 'private/audio.mp3',
        duration: 125,
        language: 'en',
        visibility: 'PRIVATE',
        createdAt,
      },
    ]);

    const response = await readFeed(request('https://sotto.test/api/rss/private/raw-token'), {
      params: Promise.resolve({ token: 'raw-token' }),
    });
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(xml).toContain('<title>Daily Briefing</title>');
    expect(xml).toContain('<title>Meeting Notes</title>');
    expect(xml).toContain('<itunes:duration>2:05</itunes:duration>');
    expect(xml).toContain('https://signed.example.com/private%2Faudio.mp3');
    expect(mockPrivateFeedTokenFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: hashPrivateFeedToken('raw-token') },
      })
    );
    expect(mockPrivateFeedTokenUpdate).toHaveBeenCalledWith({
      where: { id: 'feed-token-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
    expect(mockPodcastFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          status: 'READY',
          deletedAt: null,
          audioUrl: { not: null },
        },
      })
    );
    expect(mockResolveAudioUrl).toHaveBeenCalledWith('private/audio.mp3', 'PRIVATE');
  });
});
