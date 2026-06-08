import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockComputeNextRunAt = vi.fn();
const mockUserBriefingCount = vi.fn();
const mockUserBriefingCreate = vi.fn();
const mockUserBriefingFindUnique = vi.fn();
const mockUserBriefingUpdate = vi.fn();
const mockUserBriefingDelete = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/briefing-generator', () => ({
  computeNextRunAt: (...args: unknown[]) => mockComputeNextRunAt(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userBriefing: {
      count: (...args: unknown[]) => mockUserBriefingCount(...args),
      create: (...args: unknown[]) => mockUserBriefingCreate(...args),
      findUnique: (...args: unknown[]) => mockUserBriefingFindUnique(...args),
      update: (...args: unknown[]) => mockUserBriefingUpdate(...args),
      delete: (...args: unknown[]) => mockUserBriefingDelete(...args),
    },
  },
}));

import { POST as createBriefing } from '@/app/api/briefings/route';
import { PATCH as patchBriefing } from '@/app/api/briefings/[id]/route';

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/briefings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/briefings/briefing-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const nextRunAt = new Date('2026-05-19T13:00:00.000Z');
const createdAt = new Date('2026-05-18T13:00:00.000Z');

const minimalPayload = {
  name: 'World news briefing',
  time: '08:00',
  timezone: 'America/Chicago',
  prompt: 'Cover world news only. Keep personal work out of this podcast.',
  ttsProvider: 'openai',
};

describe('/api/briefings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockComputeNextRunAt.mockReturnValue(nextRunAt);
    mockUserBriefingCount.mockResolvedValue(0);
    mockUserBriefingCreate.mockResolvedValue({
      id: 'briefing-1',
      name: 'World news briefing',
      enabled: true,
      time: '08:00',
      timezone: 'America/Chicago',
      days: 127,
      nextRunAt,
      createdAt,
    });
    mockUserBriefingFindUnique.mockResolvedValue({
      userId: 'user-1',
      time: '08:00',
      timezone: 'America/Chicago',
      days: 127,
      enabled: true,
    });
    mockUserBriefingUpdate.mockResolvedValue({
      id: 'briefing-1',
      name: 'World news briefing',
      enabled: true,
      time: '08:00',
      timezone: 'America/Chicago',
      days: 127,
      nextRunAt,
      prompt: 'World news only',
      depth: null,
      tone: null,
      audienceLevel: null,
      duration: null,
      format: 2,
      targetLanguage: null,
      languageMode: null,
      aiModel: null,
      ttsProvider: 'openai',
      ttsModel: null,
      hostVoiceId: null,
      expertVoiceId: null,
      continuousLearning: false,
      contextEpisodes: 3,
      visibility: 'PRIVATE',
      useByokKeys: false,
      zeroCostVideo: false,
      lastGeneratedAt: null,
      createdAt,
    });
  });

  it('creates scheduled briefings as private when visibility is omitted', async () => {
    const response = await createBriefing(createPostRequest(minimalPayload));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('briefing-1');
    expect(mockUserBriefingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        name: minimalPayload.name,
        visibility: 'PRIVATE',
      }),
      select: expect.any(Object),
    });
  });

  it('rejects public scheduled briefing creation', async () => {
    const response = await createBriefing(
      createPostRequest({ ...minimalPayload, visibility: 'PUBLIC' })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
    expect(mockUserBriefingCreate).not.toHaveBeenCalled();
  });

  it('rejects unlisted scheduled briefing updates', async () => {
    const response = await patchBriefing(createPatchRequest({ visibility: 'UNLISTED' }), {
      params: Promise.resolve({ id: 'briefing-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
    expect(mockUserBriefingUpdate).not.toHaveBeenCalled();
  });

  it('allows private visibility to be preserved on update', async () => {
    const response = await patchBriefing(createPatchRequest({ visibility: 'PRIVATE' }), {
      params: Promise.resolve({ id: 'briefing-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.visibility).toBe('PRIVATE');
    expect(mockUserBriefingUpdate).toHaveBeenCalledWith({
      where: { id: 'briefing-1' },
      data: { visibility: 'PRIVATE' },
      select: expect.any(Object),
    });
  });
});
