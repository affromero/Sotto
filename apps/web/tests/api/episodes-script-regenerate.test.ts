import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockEpisodeFindUnique = vi.fn();
const mockEpisodeUpdate = vi.fn();
const mockDiscoveryFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockEnqueueDurableJob = vi.fn();
const mockResearchDossierFindUnique = vi.fn();
const mockCreativeOutlineFindUnique = vi.fn();
const mockScriptFindUnique = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    episode: {
      findUnique: (...args: unknown[]) => mockEpisodeFindUnique(...args),
      update: (...args: unknown[]) => mockEpisodeUpdate(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockDiscoveryFindUnique(...args),
    },
    script: {
      findUnique: (...args: unknown[]) => mockScriptFindUnique(...args),
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    reference: {
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    segment: {
      deleteMany: vi.fn().mockReturnValue({ then: vi.fn() }),
    },
    researchDossier: {
      findUnique: (...args: unknown[]) => mockResearchDossierFindUnique(...args),
    },
    creativeOutline: {
      findUnique: (...args: unknown[]) => mockCreativeOutlineFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/queue', () => ({
  scriptWritingQueue: 'script-writing-queue',
  deepResearchQueue: 'deep-research-queue',
  admitDurableJob: (...args: unknown[]) => mockEnqueueDurableJob(...args),
  JobType: { WRITE_SCRIPT: 'WRITE_SCRIPT', DEEP_RESEARCH: 'DEEP_RESEARCH' },
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getRedisClient: vi.fn(),
  invalidateEpisodeCache: vi.fn().mockResolvedValue(undefined),
  publishEpisodeStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/v1/episodes/[episodeId]/script/regenerate/route';

function createRequest(body?: object): NextRequest {
  if (body) {
    return new NextRequest(
      new URL('http://localhost:3000/api/v1/episodes/pod-1/script/regenerate'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
  }
  return new NextRequest(new URL('http://localhost:3000/api/v1/episodes/pod-1/script/regenerate'), {
    method: 'POST',
  });
}

async function createParams(episodeId: string) {
  return { params: Promise.resolve({ episodeId }) };
}

describe('POST /api/v1/episodes/[episodeId]/script/regenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: dossier + outline exist (happy path goes to script-writing)
    mockResearchDossierFindUnique.mockResolvedValue({ id: 'dossier-1' });
    mockCreativeOutlineFindUnique.mockResolvedValue({ id: 'outline-1' });
    mockScriptFindUnique.mockResolvedValue({
      id: 'script-1',
      version: 1,
      updatedAt: new Date(0),
      turns: [{ speaker: 'HOST', text: 'Original greeting' }],
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when episode not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Episode not found' });
  });

  it('returns 403 when user does not own the episode', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'other-user', status: 'SCRIPT_READY' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when status is not SCRIPT_READY', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'GENERATING_AUDIO' });

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('SCRIPT_READY');
  });

  it('returns 404 when discovery not found', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Discovery not found' });
  });

  it('deletes old data, transitions to SCRIPTING, and queues script-writing job (no feedback)', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: 'some content' });
    mockTransaction.mockResolvedValue(undefined);
    mockEpisodeUpdate.mockResolvedValue({});
    mockEnqueueDurableJob.mockResolvedValue(undefined);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });

    // Verify job payload includes dossierId and outlineId
    const payload = mockEnqueueDurableJob.mock.calls[0][2];
    expect(payload.dossierId).toBe('dossier-1');
    expect(payload.outlineId).toBe('outline-1');
  });

  it('rejects unverified source additions before admitting or deleting work', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: null });
    mockTransaction.mockResolvedValue(undefined);
    mockEpisodeUpdate.mockResolvedValue({});
    mockEnqueueDurableJob.mockResolvedValue(undefined);

    const response = await POST(
      createRequest({
        feedback: 'Need better sources',
        sourceUrls: ['https://example.com/article', 'https://bbc.co.uk/news'],
      }),
      await createParams('pod-1')
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('researched and verified');
    expect(mockEnqueueDurableJob).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'carries original dialogue and revision preferences with existing dossier=%s',
    async (hasDossier) => {
      mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
      mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
      mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1' });
      if (!hasDossier) mockResearchDossierFindUnique.mockResolvedValue(null);
      const response = await POST(
        createRequest({
          feedback: 'Use simpler language',
          originalScript: { id: 'script-1', version: 1 },
          turnComments: { 0: 'More welcoming' },
          highlights: [{ turnIndex: 0, text: 'greeting', note: 'Expand this' }],
        }),
        await createParams('pod-1')
      );
      expect(response.status).toBe(200);
      const payload = mockEnqueueDurableJob.mock.calls[0][2];
      expect(payload.revisionFeedback).toContain('Use simpler language');
      expect(payload.revisionFeedback).toContain('Original greeting');
      expect(payload.revisionFeedback).toContain('More welcoming');
      expect(payload.revisionFeedback).toContain('Expand this');
      const admission = mockEnqueueDurableJob.mock.calls[0][3];
      await expect(
        admission.mutate(
          {
            episode: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
            segment: { deleteMany: vi.fn() },
            reference: { deleteMany: vi.fn() },
            script: {
              deleteMany: async ({ where }: { where: { id: string; version: number } }) => {
                expect(where).toMatchObject({ id: 'script-1', version: 1 });
                return { count: 0 };
              },
            },
          },
          'operation-1'
        )
      ).rejects.toThrow('original script changed');
    }
  );

  it('rejects an annotation for text absent from the original turn', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1' });
    const response = await POST(
      createRequest({
        highlights: [{ turnIndex: 0, text: 'different revision', note: 'Change this' }],
        originalScript: { id: 'script-1', version: 1 },
      }),
      await createParams('pod-1')
    );
    expect(response.status).toBe(400);
    expect(mockEnqueueDurableJob).not.toHaveBeenCalled();
  });

  it('rejects oversized raw bodies even when extra fields would be discarded', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    const response = await POST(
      createRequest({ feedback: 'short', unused: 'x'.repeat(65536) }),
      await createParams('pod-1')
    );
    expect(response.status).toBe(413);
    expect(mockEnqueueDurableJob).not.toHaveBeenCalled();
  });

  it('rejects annotations from a previously replaced script before admission', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1' });
    const response = await POST(
      createRequest({
        turnComments: { 0: 'Shorten this' },
        originalScript: { id: 'previous-script', version: 1 },
      }),
      await createParams('pod-1')
    );
    expect(response.status).toBe(409);
    expect(mockEnqueueDurableJob).not.toHaveBeenCalled();
  });

  it('returns conflict when the original script changes during admission', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1' });
    mockEnqueueDurableJob.mockImplementationOnce(async (_queue, _type, _payload, admission) =>
      admission.mutate(
        {
          episode: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          segment: { deleteMany: vi.fn() },
          reference: { deleteMany: vi.fn() },
          script: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        },
        'operation-1'
      )
    );
    const response = await POST(
      createRequest({ feedback: 'Simplify' }),
      await createParams('pod-1')
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Reload');
  });

  it('handles an omitted feedback body', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: null });
    mockTransaction.mockResolvedValue(undefined);
    mockEpisodeUpdate.mockResolvedValue({});
    mockEnqueueDurableJob.mockResolvedValue(undefined);

    const response = await POST(createRequest({}), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  it('falls back to deep research when dossier is missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockEpisodeFindUnique.mockResolvedValue({ userId: 'user-1', status: 'SCRIPT_READY' });
    mockDiscoveryFindUnique.mockResolvedValue({ id: 'disc-1', sourceContent: null });
    mockTransaction.mockResolvedValue(undefined);
    mockEpisodeUpdate.mockResolvedValue({});
    mockEnqueueDurableJob.mockResolvedValue(undefined);
    mockResearchDossierFindUnique.mockResolvedValue(null);

    const response = await POST(createRequest(), await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });

    const admission = mockEnqueueDurableJob.mock.calls[0][3];
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await admission.mutate(
      {
        episode: { updateMany },
        segment: { deleteMany: vi.fn() },
        reference: { deleteMany: vi.fn() },
        script: { deleteMany: vi.fn() },
      },
      'operation-1'
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RESEARCHING' }),
      })
    );
  });

  it('returns 400 for invalid feedback body', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const req = new NextRequest(
      new URL('http://localhost:3000/api/v1/episodes/pod-1/script/regenerate'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      }
    );

    const response = await POST(req, await createParams('pod-1'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Invalid feedback body');
  });
});
