import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockPodcastFindUnique = vi.fn();
const mockScriptFindUnique = vi.fn();
const mockScriptUpdate = vi.fn();
const mockReferenceFindMany = vi.fn();
const mockDiscoveryFindUnique = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
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
    discovery: {
      findUnique: (...args: unknown[]) => mockDiscoveryFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/script-verifier', () => ({
  getMinReferenceCount: (depth: string) => {
    const bases: Record<string, number> = { deep_dive: 10, standard: 5, quick_overview: 3, eli5: 3 };
    return bases[depth] ?? 5;
  },
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
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 403 when user does not own the podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'other-user' });

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 404 when script not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockScriptFindUnique.mockResolvedValue(null);

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Script not found' });
  });

  it('returns script turns, references, and version on success', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', lowReferences: false });
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
    expect(body.lowReferences).toBeUndefined();
  });

  it('includes lowReferences and requiredRefCount when podcast has low references', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', lowReferences: true });
    const turns = [{ speaker: 'HOST', text: 'Hello' }];
    mockScriptFindUnique.mockResolvedValue({ turns, version: 1 });
    mockReferenceFindMany.mockResolvedValue([]);
    mockDiscoveryFindUnique.mockResolvedValue({ depth: 'deep_dive' });

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.lowReferences).toBe(true);
    expect(body.requiredRefCount).toBe(10);
  });

  it('defaults requiredRefCount to 5 when discovery not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', lowReferences: true });
    const turns = [{ speaker: 'HOST', text: 'Hello' }];
    mockScriptFindUnique.mockResolvedValue({ turns, version: 1 });
    mockReferenceFindMany.mockResolvedValue([]);
    mockDiscoveryFindUnique.mockResolvedValue(null);

    const response = await GET(createGetRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.lowReferences).toBe(true);
    expect(body.requiredRefCount).toBe(5);
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
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when podcast not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Podcast not found' });
  });

  it('returns 403 when user does not own the podcast', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'other-user', status: 'SCRIPT_READY' });

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when status is not SCRIPT_READY', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'READY' });

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('SCRIPT_READY');
  });

  it('returns 400 on invalid input (missing turns)', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });

    const response = await PATCH(createPatchRequest({}), await createParams('pod-1'));

    expect(response.status).toBe(400);
  });

  it('returns 400 when turns is empty', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });

    const response = await PATCH(
      createPatchRequest({ turns: [] }),
      await createParams('pod-1'),
    );

    expect(response.status).toBe(400);
  });

  it('accepts a single-turn monologue script', async () => {
    const monologueTurn = [{ speaker: 'HOST', text: 'Solo monologue turn.' }];
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockScriptFindUnique.mockResolvedValue({ turns: monologueTurn, version: 1 });
    mockReferenceFindMany.mockResolvedValue([]);
    mockScriptUpdate.mockResolvedValue({ turns: monologueTurn, version: 2 });

    const response = await PATCH(
      createPatchRequest({ turns: monologueTurn }),
      await createParams('pod-1'),
    );

    expect(response.status).toBe(200);
  });

  it('returns 404 when script not found during update', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPodcastFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockScriptFindUnique.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ turns: validTurns }), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Script not found' });
  });

  it('updates script and returns new turns and version', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
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
