import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockTagFindMany = vi.fn();
const mockUserInterestDeleteMany = vi.fn();
const mockUserInterestCreateMany = vi.fn();

const txClient = {
  user: { update: (...args: unknown[]) => mockUserUpdate(...args) },
  tag: { findMany: (...args: unknown[]) => mockTagFindMany(...args) },
  userInterest: {
    deleteMany: (...args: unknown[]) => mockUserInterestDeleteMany(...args),
    createMany: (...args: unknown[]) => mockUserInterestCreateMany(...args),
  },
};

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    $transaction: (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient),
  },
}));

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
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns current user data when authenticated', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice Johnson', email: 'alice@example.com' },
    });
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

  it('includes all expected profile fields', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('email');
    expect(body).toHaveProperty('image');
    expect(body).toHaveProperty('bio');
    expect(body).toHaveProperty('createdAt');
    expect(body).toHaveProperty('twitterHandle');
    expect(body).toHaveProperty('twitterEnabled');
  });

  it('handles user with null optional fields', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-2', name: 'Bob Smith', email: 'bob@example.com' },
    });
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

  it('queries user by authenticated user ID', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const request = createGetRequest();
    await GET(request);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('returns 404 when user not found in database', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-999', name: 'Unknown', email: 'unknown@example.com' },
    });
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'User not found' });
  });

  it('preserves createdAt timestamp in response', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.createdAt).toBe(mockUser.createdAt.toISOString());
  });

  it('includes voice preference fields when set', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.preferredHostVoiceId).toBe('voice-host-1');
    expect(body.preferredExpertVoiceId).toBe('voice-expert-1');
  });
});

describe('PATCH /api/users/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createPatchRequest({ name: 'New Name' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('updates user name successfully', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      name: 'Alice Updated',
    });

    const request = createPatchRequest({ name: 'Alice Updated' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Alice Updated');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { name: 'Alice Updated' },
    });
  });

  it('updates user bio successfully', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      bio: 'New bio text',
    });

    const request = createPatchRequest({ bio: 'New bio text' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bio).toBe('New bio text');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { bio: 'New bio text' },
    });
  });

  it('updates both name and bio together', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
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
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        name: 'Alice Updated',
        bio: 'Updated bio',
      },
    });
  });

  it('returns 400 when name is empty string', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });

    const request = createPatchRequest({ name: '' });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('returns 400 when name exceeds 100 characters', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });

    const request = createPatchRequest({ name: 'a'.repeat(101) });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('returns 400 when bio exceeds 500 characters', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });

    const request = createPatchRequest({ bio: 'a'.repeat(501) });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('accepts empty bio to clear it', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
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
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
    mockPrisma.user.update.mockResolvedValue(mockUser);

    const request = createPatchRequest({});
    const response = await PATCH(request);

    expect(response.status).toBe(200);
  });

  it('rejects invalid fields not in schema', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });

    const request = createPatchRequest({
      email: 'newemail@example.com',
      role: 'admin',
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects attempt to update email', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });

    const request = createPatchRequest({
      name: 'Alice',
      email: 'newemail@example.com',
    });
    const response = await PATCH(request);

    expect(response.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects name that is just whitespace', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });

    const request = createPatchRequest({ name: '   ' });
    const response = await PATCH(request);

    expect(response.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('updates for different authenticated users independently', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-2', name: 'Bob', email: 'bob@example.com' },
    });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUserMinimal,
      name: 'Bob Updated',
    });

    const request = createPatchRequest({ name: 'Bob Updated' });
    await PATCH(request);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: { name: 'Bob Updated' },
    });
  });

  it('returns updated user data in response', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
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
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      bio: 'a'.repeat(500),
    });

    const request = createPatchRequest({ bio: 'a'.repeat(500) });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
  });

  it('validates name length at exactly 100 characters', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    });
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      name: 'a'.repeat(100),
    });

    const request = createPatchRequest({ name: 'a'.repeat(100) });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
  });
});
