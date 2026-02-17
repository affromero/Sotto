import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockScriptUpdate = vi.fn();
const mockReferenceFindMany = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    podcast: {
      findUnique: (...args: unknown[]) => mockPodcastFindUnique(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockScriptFindUnique(...args),
      update: (...args: unknown[]) => mockScriptUpdate(...args),
    },
    reference: {
      findMany: (...args: unknown[]) => mockReferenceFindMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/script-updater', () => ({
  cleanAndRenumberCitations: vi.fn((_turns: unknown[]) => _turns),
  cleanAndRenumberMarkdown: vi.fn((md: string) => md),
  buildRenumberMap: vi.fn(() => new Map()),
}));

import { GET, PATCH } from '@/app/api/podcasts/[podcastId]/script/route';

function createGetRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/script'));
}

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/podcasts/pod-1/script'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function createParams(podcastId: string) {
  return { params: Promise.resolve({ podcastId }) };
}

describe('GET /api/podcasts/[podcastId]/script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Podcast not found' });
  });

  it('returns 403 when user does not own the podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'other-user' });

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 when script not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockScriptFindUnique.mockResolvedValue(null);

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Script not found' });
  });

  it('returns script turns, references, and version on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1' });
    const turns = [
      { speaker: 'HOST', text: 'Hello' },
      { speaker: 'EXPERT', text: 'Hi there' },
    ];
    mockScriptFindUnique.mockResolvedValue({ turns, version: 2 });
    const refs = [{ id: 'ref-1', number: 1, title: 'Source 1' }];
    mockReferenceFindMany.mockResolvedValue(refs);

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ turns, references: refs, version: 2 });
  });
});

describe('PATCH /api/podcasts/[podcastId]/script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validTurns = [
    { speaker: 'HOST', text: 'Updated intro' },
    { speaker: 'EXPERT', text: 'Updated response' },
  ];

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Podcast not found' });
  });

  it('returns 403 when user does not own the podcast', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'other-user', status: 'SCRIPT_READY' });

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when status is not SCRIPT_READY', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'READY' });

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('SCRIPT_READY');
  });

  it('returns 400 on invalid input (missing turns)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });

    const response = await PATCH(createPatchRequest({}), await createParams('pod-1'));

    expect(response.status).toBe(400);
  });

  it('returns 400 when turns has fewer than 2 items', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });

    const response = await PATCH(
      createPatchRequest({ turns: [{ speaker: 'HOST', text: 'Solo' }] }),
      await createParams('pod-1'),
    );

    expect(response.status).toBe(400);
  });

  it('returns 404 when script not found during update', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockScriptFindUnique.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Script not found' });
  });

  it('updates script and returns new turns and version', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockScriptFindUnique.mockResolvedValue({
      turns: [
        { speaker: 'HOST', text: 'Old intro' },
        { speaker: 'EXPERT', text: 'Old response' },
      ],
      version: 1,
    });
    mockReferenceFindMany.mockResolvedValue([]);
    mockScriptUpdate.mockResolvedValue({ turns: validTurns, version: 2 });

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ turns: validTurns, version: 2 });
  });
});
