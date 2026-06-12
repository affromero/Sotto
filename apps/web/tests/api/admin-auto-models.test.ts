import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

vi.mock('@/lib/providers/ai-registry', () => ({
  isValidModelId: vi.fn(() => true),
  getAiProviderIds: vi.fn(() => [
    'anthropic',
    'openai',
    'claude-code',
    'together',
    'deepgram',
    'assemblyai',
  ]),
  getProviderForModel: vi.fn((id: string) => {
    if (id.startsWith('claude')) return 'anthropic';
    if (id.startsWith('gpt')) return 'openai';
    return null;
  }),
}));

vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}));

import { GET, PATCH } from '@/app/api/v1/admin/auto-models/route';

function patchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/admin/auto-models'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const config = {
  model: {
    aiProvider: 'anthropic',
    aiModel: 'claude-sonnet-4-6',
    ttsProvider: 'openai',
    ttsModel: 'tts-1-hd',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  },
  platform: {
    aiProvider: 'anthropic',
    aiModel: 'claude-sonnet-4-6',
  },
  includedModels: null,
  includedTtsModels: null,
  includedSttModels: null,
  imageProvider: 'fal',
  imageModel: 'fal-flux-1-schnell',
  includedImageModels: null,
  videoProvider: 'fal',
  videoModel: 'fal-wan2.5-480p',
  includedVideoModels: null,
  avatarProvider: 'heygen',
  avatarModel: 'heygen-avatar-standard',
  includedAvatarModels: null,
  motionProvider: 'remotion',
};

describe('GET /api/v1/admin/auto-models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' });
  });

  it('returns 403 when the user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'Forbidden' });
  });

  it('returns the unified auto model config for admins', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockGetAutoModelConfig.mockResolvedValue(config);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(config);
  });
});

describe('PATCH /api/v1/admin/auto-models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockSetAutoModelConfig.mockResolvedValue(undefined);
    mockGetAutoModelConfig.mockResolvedValue(config);
  });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await PATCH(patchRequest({ model: { aiProvider: 'anthropic' } }));

    expect(response.status).toBe(403);
    expect(mockSetAutoModelConfig).not.toHaveBeenCalled();
  });

  it('returns 403 when the user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await PATCH(patchRequest({ model: { aiProvider: 'anthropic' } }));

    expect(response.status).toBe(403);
    expect(mockSetAutoModelConfig).not.toHaveBeenCalled();
  });

  it('accepts unified defaults, included lists, and category model config', async () => {
    const body = {
      model: {
        aiProvider: 'openai',
        aiModel: 'gpt-5',
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_v3',
        sttProvider: 'deepgram',
        sttModel: 'nova-3',
      },
      platform: { aiProvider: 'anthropic', aiModel: 'claude-sonnet-4-6' },
      includedModels: ['gpt-5'],
      includedTtsModels: ['elevenlabs:eleven_v3'],
      includedSttModels: ['deepgram:nova-3'],
      imageProvider: 'fal',
      imageModel: 'fal-flux-2-pro',
      includedImageModels: ['fal-flux-2-pro'],
      videoProvider: 'fal',
      videoModel: 'fal-kling3-1080p',
      includedVideoModels: ['fal-kling3-1080p'],
      avatarProvider: 'heygen',
      avatarModel: 'heygen-avatar-iv',
      includedAvatarModels: ['heygen-avatar-iv'],
      motionProvider: 'hera',
    };

    const response = await PATCH(patchRequest(body));

    expect(response.status).toBe(200);
    expect(mockSetAutoModelConfig).toHaveBeenCalledWith(body, 'admin-1');
    await expect(response.json()).resolves.toEqual(config);
  });

  it('accepts null to clear unified included lists', async () => {
    const body = {
      includedModels: null,
      includedTtsModels: null,
      includedSttModels: null,
      includedImageModels: null,
      includedVideoModels: null,
      includedAvatarModels: null,
    };

    const response = await PATCH(patchRequest(body));

    expect(response.status).toBe(200);
    expect(mockSetAutoModelConfig).toHaveBeenCalledWith(body, 'admin-1');
  });

  it('accepts local speech providers in model config', async () => {
    const body = {
      model: {
        ttsProvider: 'local',
        ttsModel: 'local',
        sttProvider: 'local',
        sttModel: 'whisper-local',
      },
    };

    const response = await PATCH(patchRequest(body));

    expect(response.status).toBe(200);
    expect(mockSetAutoModelConfig).toHaveBeenCalledWith(body, 'admin-1');
  });

  it('rejects invalid model block provider values', async () => {
    const response = await PATCH(patchRequest({ model: { aiProvider: 'invalid' } }));

    expect(response.status).toBe(400);
    expect(mockSetAutoModelConfig).not.toHaveBeenCalled();
  });

  it('rejects mismatched AI provider/model pairs', async () => {
    const response = await PATCH(
      patchRequest({ model: { aiProvider: 'anthropic', aiModel: 'gpt-5' } })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('belongs to "openai"'),
    });
    expect(mockSetAutoModelConfig).not.toHaveBeenCalled();
  });

  it('rejects invalid motion provider values', async () => {
    const response = await PATCH(patchRequest({ motionProvider: 'invalid' }));

    expect(response.status).toBe(400);
    expect(mockSetAutoModelConfig).not.toHaveBeenCalled();
  });
});
