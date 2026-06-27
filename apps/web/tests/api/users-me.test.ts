// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockTagFindMany = vi.fn();
const mockUserInterestDeleteMany = vi.fn();
const mockUserInterestCreateMany = vi.fn();
const mockEpisodeCount = vi.fn();
const mockFollowCount = vi.fn();

const txClient = {
  user: { update: (...args: unknown[]) => mockUserUpdate(...args) },
  tag: { findMany: (...args: unknown[]) => mockTagFindMany(...args) },
  userInterest: {
    deleteMany: (...args: unknown[]) => mockUserInterestDeleteMany(...args),
    createMany: (...args: unknown[]) => mockUserInterestCreateMany(...args),
  },
};

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getProviderForModel: vi.fn((id: string) =>
    id.includes('claude') ? 'anthropic' : id.includes('gpt') ? 'openai' : null
  ),
  isValidModelId: vi.fn(
    (id: string) => id.includes('claude') || id.includes('gpt') || id.includes('llama')
  ),
  getAllAiProviderMeta: vi.fn(() => []),
  getAiProviderMeta: vi.fn(() => ({ models: [] })),
  getAiProviderIdsWithPricing: vi.fn(() => []),
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: vi.fn().mockResolvedValue({
    model: {
      ttsProvider: 'openai',
      ttsModel: 'tts-1-hd',
      sttProvider: 'openai',
      sttModel: 'whisper-1',
    },
  }),
}));

vi.mock('@/lib/providers/tts', () => ({
  getConfiguredTtsProviderId: vi.fn(() => 'openai'),
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn(() => ({
    models: [{ id: 'tts-1-hd', displayName: 'TTS HD', supportedLanguages: new Set(['en', 'es']) }],
  })),
}));

vi.mock('@/lib/providers/stt-registry', () => ({
  getSttProviderMeta: vi.fn(() => ({
    models: [
      { id: 'whisper-1', displayName: 'Whisper', supportedLanguages: new Set(['en', 'es']) },
    ],
  })),
  isValidSttProviderId: vi.fn((id: string) => id === 'openai'),
  supportsSttLanguage: vi.fn((_provider: string, _model: string, language: string) =>
    ['en', 'es'].includes(language)
  ),
}));

vi.mock('@/lib/server-config', () => ({
  getServerInfra: vi.fn().mockResolvedValue({ sttProvider: 'openai' }),
}));

vi.mock('@/lib/tts-language-support', () => ({
  supportsLanguage: vi.fn((_provider: string, _model: string, language: string) =>
    ['en', 'es'].includes(language)
  ),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    episode: { count: (...args: unknown[]) => mockEpisodeCount(...args) },
    follow: { count: (...args: unknown[]) => mockFollowCount(...args) },
    $transaction: (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

import { GET, PATCH } from '@/app/api/v1/users/me/route';

const mockPrisma = {
  user: {
    findUnique: mockUserFindUnique,
    update: mockUserUpdate,
  },
};

function createGetRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/users/me');
  return new NextRequest(url, { method: 'GET' });
}

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/users/me');
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockUser = {
  id: 'user-1',
  name: 'Alice Johnson',
  email: 'alice@example.com',
  image: 'https://example.com/alice.jpg',
  role: 'ADMIN',
  createdAt: new Date('2025-01-10T10:00:00Z'),
  preferredHostVoiceId: 'voice-host-1',
  preferredExpertVoiceId: 'voice-expert-1',
  preferredLanguage: 'en',
  preferredAiModel: null,
  preferredTtsModel: null,
  preferredSttModel: null,
  showAgentUsageStatus: true,
};

const mockUserMinimal = {
  id: 'user-2',
  name: 'Bob Smith',
  email: 'bob@example.com',
  image: null,
  role: 'USER',
  createdAt: new Date('2025-01-15T10:00:00Z'),
  preferredHostVoiceId: null,
  preferredExpertVoiceId: null,
  preferredLanguage: null,
  preferredAiModel: null,
  preferredTtsModel: null,
  preferredSttModel: null,
  showAgentUsageStatus: true,
};

describe('GET /api/v1/users/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEpisodeCount.mockResolvedValue(0);
    mockFollowCount.mockResolvedValue(0);
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns current user data when authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('user-1');
    expect(body.name).toBe('Alice Johnson');
    expect(body.email).toBe('alice@example.com');
    expect(body.role).toBe('ADMIN');
    expect(body.showAgentUsageStatus).toBe(true);
  });

  it('returns the real role for a non-owner learner profile', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-2' });
    mockPrisma.user.findUnique.mockResolvedValue(mockUserMinimal);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.role).toBe('USER');
  });

  it('handles user with null optional fields', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-2' });
    mockPrisma.user.findUnique.mockResolvedValue(mockUserMinimal);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.image).toBeNull();
  });

  it('returns 404 when user not found in database', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-999' });
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'User not found' });
  });
});

describe('PATCH /api/v1/users/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createPatchRequest({ name: 'New Name' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('updates user name successfully', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      name: 'Alice Updated',
    });

    const request = createPatchRequest({ name: 'Alice Updated' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Alice Updated');
  });

  it('returns 400 when name is empty string', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest({ name: '' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when name exceeds 100 characters', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest({ name: 'a'.repeat(101) });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('handles empty request body without errors', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue(mockUser);

    const request = createPatchRequest({});
    const response = await PATCH(request);

    expect(response.status).toBe(200);
  });

  it('rejects invalid fields not in schema', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest({
      email: 'newemail@example.com',
      role: 'admin',
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('rejects attempt to update email', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest({
      name: 'Alice',
      email: 'newemail@example.com',
    });
    const response = await PATCH(request);

    expect(response.status).toBe(400);
  });

  it('rejects name that is just whitespace', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest({ name: '   ' });
    const response = await PATCH(request);

    expect(response.status).toBe(400);
  });

  it('returns updated user data in response', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    const updatedUser = {
      ...mockUser,
      name: 'Alice New',
    };
    mockPrisma.user.update.mockResolvedValue(updatedUser);

    const request = createPatchRequest({
      name: 'Alice New',
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(body).toMatchObject({
      id: 'user-1',
      name: 'Alice New',
      email: 'alice@example.com',
    });
  });

  it('validates name length at exactly 100 characters', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      name: 'a'.repeat(100),
    });

    const request = createPatchRequest({ name: 'a'.repeat(100) });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
  });

  it('updates preferredAiModel successfully', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      preferredAiModel: 'claude-sonnet-4-6',
    });

    const request = createPatchRequest({ preferredAiModel: 'claude-sonnet-4-6' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferredAiModel).toBe('claude-sonnet-4-6');
  });

  it('clears preferredAiModel when set to null', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      preferredAiModel: null,
    });

    const request = createPatchRequest({ preferredAiModel: null });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferredAiModel).toBeNull();
  });

  it('updates learner speech models when compatible with the profile language', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'es' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      preferredLanguage: 'es',
      preferredTtsModel: 'tts-1-hd',
      preferredSttModel: 'whisper-1',
    });

    const request = createPatchRequest({
      preferredLanguage: 'es',
      preferredTtsModel: 'tts-1-hd',
      preferredSttModel: 'whisper-1',
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferredTtsModel).toBe('tts-1-hd');
    expect(body.preferredSttModel).toBe('whisper-1');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preferredLanguage: 'es',
          preferredTtsModel: 'tts-1-hd',
          preferredSttModel: 'whisper-1',
        }),
      })
    );
  });

  it('accepts per-profile appearance prefs and refreshes the theme cookie', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      themeMode: 'dark',
      themePalette: 'aula',
      themeAccent: null,
      reducedMotion: true,
    });

    const request = createPatchRequest({ themeMode: 'dark', reducedMotion: true });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((c) => c.startsWith('sotto_theme='))).toBe(true);
  });

  it('updates agent usage status visibility', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      showAgentUsageStatus: false,
    });

    const response = await PATCH(createPatchRequest({ showAgentUsageStatus: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.showAgentUsageStatus).toBe(false);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ showAgentUsageStatus: false }),
      })
    );
  });

  it('rejects an invalid accent color', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await PATCH(createPatchRequest({ themeAccent: 'blue' }));
    expect(response.status).toBe(400);
  });

  it('accepts a preset animal avatar path for image', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({ ...mockUser, image: '/avatars/jaguar.png' });

    const response = await PATCH(createPatchRequest({ image: '/avatars/jaguar.png' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.image).toBe('/avatars/jaguar.png');
  });

  it('rejects an image that is neither a URL nor a preset avatar', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await PATCH(createPatchRequest({ image: 'not-an-image' }));
    expect(response.status).toBe(400);
  });
});
