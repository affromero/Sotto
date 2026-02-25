import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockGetFreeTierConfig = vi.fn();
const mockSetFreeTierConfig = vi.fn();

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
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns config when user is admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const mockConfig = {
      aiProvider: 'anthropic',
      aiModel: 'claude-sonnet-4-6',
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
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const request = createPatchRequest({ aiProvider: 'openai' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 for invalid body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const request = createPatchRequest({ aiProvider: 'invalid-provider' });
    const response = await PATCH(request);

    expect(response.status).toBe(400);
  });

  it('updates config and returns updated values', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
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

  it('accepts valid allocations', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockSetFreeTierConfig.mockResolvedValue(undefined);
    mockGetFreeTierConfig.mockResolvedValue({ generationLimit: 5 });

    const request = createPatchRequest({
      generationLimit: 5,
      ttsAllocations: [
        { provider: 'elevenlabs', model: 'eleven_v3', quota: 2 },
        { provider: 'openai', model: 'tts-1-hd', quota: 3 },
      ],
    });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(mockSetFreeTierConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        ttsAllocations: [
          { provider: 'elevenlabs', model: 'eleven_v3', quota: 2 },
          { provider: 'openai', model: 'tts-1-hd', quota: 3 },
        ],
      }),
      'admin-1'
    );
  });

  it('rejects TTS allocations exceeding generation limit', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const request = createPatchRequest({
      generationLimit: 3,
      ttsAllocations: [
        { provider: 'elevenlabs', model: 'eleven_v3', quota: 2 },
        { provider: 'openai', model: 'tts-1-hd', quota: 3 },
      ],
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('TTS allocation quotas (5) exceed generation limit (3)');
  });

  it('rejects AI allocations exceeding generation limit', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const request = createPatchRequest({
      generationLimit: 2,
      aiAllocations: [
        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', quota: 3 },
      ],
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('AI allocation quotas (3) exceed generation limit (2)');
  });

  it('rejects allocation with missing fields', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const request = createPatchRequest({
      generationLimit: 5,
      ttsAllocations: [{ provider: 'elevenlabs' }],
    });
    const response = await PATCH(request);

    expect(response.status).toBe(400);
  });

  it('clears allocations when empty arrays are sent', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockSetFreeTierConfig.mockResolvedValue(undefined);
    mockGetFreeTierConfig.mockResolvedValue({ generationLimit: 5 });

    const request = createPatchRequest({
      generationLimit: 5,
      aiAllocations: [],
      ttsAllocations: [],
    });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(mockSetFreeTierConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiAllocations: [],
        ttsAllocations: [],
      }),
      'admin-1'
    );
  });
});
