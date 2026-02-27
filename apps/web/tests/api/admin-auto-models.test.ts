import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuth = vi.fn();
const mockGetAutoModelConfig = vi.fn();
const mockSetAutoModelConfig = vi.fn();

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

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
  setAutoModelConfig: (...args: unknown[]) => mockSetAutoModelConfig(...args),
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}));

// ---- Import under test ----

import { GET, PATCH } from '@/app/api/admin/auto-models/route';

// ---- Helpers ----

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/auto-models'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockConfig = {
  free: {
    aiProvider: 'groq',
    aiModel: 'llama-3.1-8b-instant',
    ttsProvider: 'kittentts',
    ttsModel: 'kitten-tts-mini-0.8',
    sttProvider: 'groq',
    sttModel: 'whisper-large-v3-turbo',
  },
  pro: {
    aiProvider: 'anthropic',
    aiModel: 'claude-haiku-4-5-20251001',
    ttsProvider: 'elevenlabs',
    ttsModel: 'eleven_v3',
    sttProvider: 'groq',
    sttModel: 'whisper-large-v3-turbo',
  },
};

// ---- Tests ----

describe('GET /api/admin/auto-models', () => {
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

  it('returns auto model config when user is admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockGetAutoModelConfig.mockResolvedValue(mockConfig);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(mockConfig);
  });
});

describe('PATCH /api/admin/auto-models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetAutoModelConfig.mockResolvedValue(undefined);
    mockGetAutoModelConfig.mockResolvedValue(mockConfig);
  });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ free: { aiProvider: 'groq' } }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await PATCH(createPatchRequest({ free: { aiProvider: 'groq' } }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('updates config and returns updated state', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const updated = { ...mockConfig, free: { ...mockConfig.free, aiProvider: 'openai' } };
    mockGetAutoModelConfig.mockResolvedValue(updated);

    const response = await PATCH(
      createPatchRequest({ free: { aiProvider: 'openai', aiModel: 'gpt-4o-mini' } })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockSetAutoModelConfig).toHaveBeenCalledWith(
      { free: { aiProvider: 'openai', aiModel: 'gpt-4o-mini' } },
      'admin-1'
    );
    expect(body).toEqual(updated);
  });

  it('rejects invalid aiProvider value', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const response = await PATCH(
      createPatchRequest({ free: { aiProvider: 'invalid-provider' } })
    );

    expect(response.status).toBe(400);
    expect(mockSetAutoModelConfig).not.toHaveBeenCalled();
  });

  it('rejects invalid ttsProvider value', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const response = await PATCH(
      createPatchRequest({ pro: { ttsProvider: 'not-a-provider' } })
    );

    expect(response.status).toBe(400);
    expect(mockSetAutoModelConfig).not.toHaveBeenCalled();
  });

  it('accepts partial update with only pro fields', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const response = await PATCH(
      createPatchRequest({ pro: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_v3' } })
    );

    expect(response.status).toBe(200);
    expect(mockSetAutoModelConfig).toHaveBeenCalledWith(
      { pro: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_v3' } },
      'admin-1'
    );
  });
});
