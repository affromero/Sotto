// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockTagFindMany = vi.fn();
const mockUserInterestDeleteMany = vi.fn();
const mockUserInterestCreateMany = vi.fn();
const mockPodcastCount = vi.fn();
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
  isValidModelId: vi.fn((id: string) =>
    id.includes('claude') || id.includes('gpt') || id.includes('llama')
  ),
  getAllAiProviderMeta: vi.fn(() => []),
  getAiProviderMeta: vi.fn(() => ({ models: [] })),
  getAiProviderIdsWithPricing: vi.fn(() => []),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    podcast: { count: (...args: unknown[]) => mockPodcastCount(...args) },
    follow: { count: (...args: unknown[]) => mockFollowCount(...args) },
    $transaction: (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

import { GET, PATCH } from '@/app/api/users/me/route';

const mockPrisma = {
  user: {
    findUnique: mockUserFindUnique,
    update: mockUserUpdate,
  },
};

function createGetRequest(): NextRequest {
  const url = new URL('http://localhost:3000/api/users/me');
  return new NextRequest(url, { method: 'GET' });
}

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  const url = new URL('http://localhost:3000/api/users/me');
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
  bio: 'Science educator and podcast creator',
  createdAt: new Date('2025-01-10T10:00:00Z'),
  twitterHandle: '@alicejohnson',
  twitterEnabled: true,
  preferredHostVoiceId: 'voice-host-1',
  preferredExpertVoiceId: 'voice-expert-1',
};

const mockUserMinimal = {
  id: 'user-2',
  name: 'Bob Smith',
  email: 'bob@example.com',
  image: null,
  bio: null,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  twitterHandle: null,
  twitterEnabled: false,
  preferredHostVoiceId: null,
  preferredExpertVoiceId: null,
};

describe('GET /api/users/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPodcastCount.mockResolvedValue(0);
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
    expect(body.bio).toBe('Science educator and podcast creator');
  });

  it('handles user with null optional fields', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-2' });
    mockPrisma.user.findUnique.mockResolvedValue(mockUserMinimal);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.image).toBeNull();
    expect(body.bio).toBeNull();
    expect(body.twitterHandle).toBeNull();
    expect(body.twitterEnabled).toBe(false);
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

describe('PATCH /api/users/me', () => {
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

  it('updates user bio successfully', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      bio: 'New bio text',
    });

    const request = createPatchRequest({ bio: 'New bio text' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bio).toBe('New bio text');
  });

  it('updates both name and bio together', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      name: 'Alice Updated',
      bio: 'Updated bio',
    });

    const request = createPatchRequest({
      name: 'Alice Updated',
      bio: 'Updated bio',
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Alice Updated');
    expect(body.bio).toBe('Updated bio');
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

  it('returns 400 when bio exceeds 500 characters', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const request = createPatchRequest({ bio: 'a'.repeat(501) });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('accepts empty bio to clear it', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      bio: '',
    });

    const request = createPatchRequest({ bio: '' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bio).toBe('');
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
      bio: 'New bio',
    };
    mockPrisma.user.update.mockResolvedValue(updatedUser);

    const request = createPatchRequest({
      name: 'Alice New',
      bio: 'New bio',
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(body).toMatchObject({
      id: 'user-1',
      name: 'Alice New',
      bio: 'New bio',
      email: 'alice@example.com',
    });
  });

  it('validates bio length at exactly 500 characters', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      bio: 'a'.repeat(500),
    });

    const request = createPatchRequest({ bio: 'a'.repeat(500) });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
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
});
