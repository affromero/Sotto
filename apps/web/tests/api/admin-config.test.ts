import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockGetFreeTierConfig = vi.fn();
const mockSetFreeTierConfig = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/free-tier-config', () => ({
  getFreeTierConfig: (...args: unknown[]) => mockGetFreeTierConfig(...args),
  setFreeTierConfig: (...args: unknown[]) => mockSetFreeTierConfig(...args),
}));

import { GET, PATCH } from '@/app/api/admin/config/route';

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/config'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/admin/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ role: 'USER' });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns config when user is admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
    mockUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    const mockConfig = {
      aiProvider: 'anthropic',
      aiModel: 'claude-sonnet-4-5-20250929',
      ttsProvider: 'elevenlabs',
      generationLimit: 10,
    };
    mockGetFreeTierConfig.mockResolvedValue(mockConfig);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(mockConfig);
  });
});

describe('PATCH /api/admin/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createPatchRequest({ aiProvider: 'openai' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({ role: 'USER' });

    const request = createPatchRequest({ aiProvider: 'openai' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 for invalid body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
    mockUserFindUnique.mockResolvedValue({ role: 'ADMIN' });

    const request = createPatchRequest({ aiProvider: 'invalid-provider' });
    const response = await PATCH(request);

    expect(response.status).toBe(400);
  });

  it('updates config and returns updated values', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
    mockUserFindUnique.mockResolvedValue({ role: 'ADMIN' });
    mockSetFreeTierConfig.mockResolvedValue(undefined);
    const updatedConfig = {
      aiProvider: 'openai',
      aiModel: 'gpt-4',
      ttsProvider: 'elevenlabs',
      generationLimit: 5,
    };
    mockGetFreeTierConfig.mockResolvedValue(updatedConfig);

    const request = createPatchRequest({ aiProvider: 'openai' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(updatedConfig);
  });
});
