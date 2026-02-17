import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockVoiceCloneFindUnique = vi.fn();
const mockSubscriptionFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockVoiceAllowlistCreate = vi.fn();
const mockVoiceAllowlistFindMany = vi.fn();
const mockVoiceAllowlistFindUnique = vi.fn();
const mockVoiceAllowlistDelete = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  get prismaUnfiltered() { return this.prisma; },
  prisma: {
    voiceClone: {
      findUnique: (...args: unknown[]) => mockVoiceCloneFindUnique(...args),
    },
    subscription: {
      findUnique: (...args: unknown[]) => mockSubscriptionFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    voiceAllowlist: {
      create: (...args: unknown[]) => mockVoiceAllowlistCreate(...args),
      findMany: (...args: unknown[]) => mockVoiceAllowlistFindMany(...args),
      findUnique: (...args: unknown[]) => mockVoiceAllowlistFindUnique(...args),
      delete: (...args: unknown[]) => mockVoiceAllowlistDelete(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { POST, GET } from '@/app/api/voices/allowlist/route';
import { DELETE } from '@/app/api/voices/allowlist/[entryId]/route';

function createRequest(
  url = 'http://localhost:3000/api/voices/allowlist',
  options?: RequestInit
): NextRequest {
  return new NextRequest(url, options as any);
}

const mockSession = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2025-12-31',
};

const mockVoiceClone = {
  id: 'clone-1',
  userId: 'user-1',
};

const mockSubscription = {
  tier: 'STUDIO',
  voiceCreatorAddonActive: true,
};

const mockTargetUser = {
  id: 'user-2',
  handle: 'targetuser',
  name: 'Target User',
  image: 'https://example.com/avatar.jpg',
};

const mockAllowlistEntry = {
  id: 'entry-1',
  createdAt: '2025-01-15T10:00:00.000Z',
  allowedUser: {
    id: 'user-2',
    handle: 'targetuser',
    name: 'Target User',
    image: 'https://example.com/avatar.jpg',
  },
};

describe('POST /api/voices/allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/allowlist', {
      method: 'POST',
      body: JSON.stringify({ voiceCloneId: 'clone-1', handle: 'targetuser' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 for invalid body with missing voiceCloneId', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/voices/allowlist', {
      method: 'POST',
      body: JSON.stringify({ handle: 'targetuser' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for invalid body with missing handle', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/voices/allowlist', {
      method: 'POST',
      body: JSON.stringify({ voiceCloneId: 'clone-1' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  it('returns 404 when voice clone not found', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/allowlist', {
      method: 'POST',
      body: JSON.stringify({ voiceCloneId: 'clone-1', handle: 'targetuser' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Voice clone not found or not owned by you' });
  });

  it('returns 404 when voice clone not owned by user', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue({ id: 'clone-1', userId: 'user-999' });

    const request = createRequest('http://localhost:3000/api/voices/allowlist', {
      method: 'POST',
      body: JSON.stringify({ voiceCloneId: 'clone-1', handle: 'targetuser' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Voice clone not found or not owned by you' });
  });

  it('returns 404 when target user handle not found', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(mockVoiceClone);
    mockSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockUserFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/allowlist', {
      method: 'POST',
      body: JSON.stringify({ voiceCloneId: 'clone-1', handle: 'nonexistent' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'User @nonexistent not found' });
  });

  it('returns 400 when trying to self-allowlist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(mockVoiceClone);
    mockSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1',
      handle: 'testuser',
      name: 'Test User',
      image: null,
    });

    const request = createRequest('http://localhost:3000/api/voices/allowlist', {
      method: 'POST',
      body: JSON.stringify({ voiceCloneId: 'clone-1', handle: 'testuser' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'You cannot add yourself to the allowlist' });
  });

  it('returns 409 on duplicate entry', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(mockVoiceClone);
    mockSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockUserFindUnique.mockResolvedValue(mockTargetUser);
    mockVoiceAllowlistCreate.mockRejectedValue(new Error('Unique constraint failed'));

    const request = createRequest('http://localhost:3000/api/voices/allowlist', {
      method: 'POST',
      body: JSON.stringify({ voiceCloneId: 'clone-1', handle: 'targetuser' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'User is already on the allowlist for this voice' });
  });

  it('returns 201 on successful add', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(mockVoiceClone);
    mockSubscriptionFindUnique.mockResolvedValue(mockSubscription);
    mockUserFindUnique.mockResolvedValue(mockTargetUser);
    mockVoiceAllowlistCreate.mockResolvedValue(mockAllowlistEntry);

    const request = createRequest('http://localhost:3000/api/voices/allowlist', {
      method: 'POST',
      body: JSON.stringify({ voiceCloneId: 'clone-1', handle: 'targetuser' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(mockAllowlistEntry);
  });
});

describe('GET /api/voices/allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest(
      'http://localhost:3000/api/voices/allowlist?voiceCloneId=clone-1'
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when voiceCloneId query param missing', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/voices/allowlist');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'voiceCloneId is required' });
  });

  it('returns 404 when voice clone not owned', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue({ userId: 'user-999' });

    const request = createRequest(
      'http://localhost:3000/api/voices/allowlist?voiceCloneId=clone-1'
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Voice clone not found or not owned by you' });
  });

  it('returns 404 when voice clone not found', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(null);

    const request = createRequest(
      'http://localhost:3000/api/voices/allowlist?voiceCloneId=clone-1'
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Voice clone not found or not owned by you' });
  });

  it('returns entries for valid request', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(mockVoiceClone);
    mockVoiceAllowlistFindMany.mockResolvedValue([mockAllowlistEntry]);

    const request = createRequest(
      'http://localhost:3000/api/voices/allowlist?voiceCloneId=clone-1'
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([mockAllowlistEntry]);
  });
});

describe('DELETE /api/voices/allowlist/[entryId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/allowlist/entry-1', {
      method: 'DELETE',
    });
    const params = Promise.resolve({ entryId: 'entry-1' });
    const response = await DELETE(request, { params });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when entry not found', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceAllowlistFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/allowlist/entry-1', {
      method: 'DELETE',
    });
    const params = Promise.resolve({ entryId: 'entry-1' });
    const response = await DELETE(request, { params });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Allowlist entry not found' });
  });

  it('returns 403 when voice clone not owned by user', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceAllowlistFindUnique.mockResolvedValue({
      id: 'entry-1',
      voiceClone: { userId: 'user-999' },
    });

    const request = createRequest('http://localhost:3000/api/voices/allowlist/entry-1', {
      method: 'DELETE',
    });
    const params = Promise.resolve({ entryId: 'entry-1' });
    const response = await DELETE(request, { params });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 200 on successful delete', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceAllowlistFindUnique.mockResolvedValue({
      id: 'entry-1',
      voiceClone: { userId: 'user-1' },
    });
    mockVoiceAllowlistDelete.mockResolvedValue({});

    const request = createRequest('http://localhost:3000/api/voices/allowlist/entry-1', {
      method: 'DELETE',
    });
    const params = Promise.resolve({ entryId: 'entry-1' });
    const response = await DELETE(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});
