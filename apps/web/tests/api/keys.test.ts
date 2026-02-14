import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fns at module scope so they're properly typed as Mock
const mockApiKeyFindMany = vi.fn();
const mockApiKeyFindUnique = vi.fn();
const mockApiKeyCreate = vi.fn();
const mockApiKeyUpdate = vi.fn();
const mockApiKeyCount = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: {
      findMany: (...args: unknown[]) => mockApiKeyFindMany(...args),
      findUnique: (...args: unknown[]) => mockApiKeyFindUnique(...args),
      create: (...args: unknown[]) => mockApiKeyCreate(...args),
      update: (...args: unknown[]) => mockApiKeyUpdate(...args),
      count: (...args: unknown[]) => mockApiKeyCount(...args),
    },
  },
}));

const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

const mockGenerateApiKey = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  generateApiKey: () => mockGenerateApiKey(),
}));

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};
vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}));

import { GET, POST } from '@/app/api/keys/route';
import { DELETE } from '@/app/api/keys/[keyId]/route';

const mockPrisma = {
  apiKey: {
    findMany: mockApiKeyFindMany,
    findUnique: mockApiKeyFindUnique,
    create: mockApiKeyCreate,
    update: mockApiKeyUpdate,
    count: mockApiKeyCount,
  },
};

function createRequest(
  url = 'http://localhost:3000/api/keys',
  options: RequestInit = {}
): NextRequest {
  return new NextRequest(url, options as any);
}

const mockApiKey = {
  id: 'key-1',
  userId: 'user-1',
  name: 'Production Key',
  keyPrefix: 'sk_sotto_abc123...',
  lastUsedAt: new Date('2025-01-15T10:00:00Z'),
  createdAt: new Date('2025-01-10T10:00:00Z'),
  revokedAt: null,
};

const mockApiKey2 = {
  id: 'key-2',
  userId: 'user-1',
  name: 'Staging Key',
  keyPrefix: 'sk_sotto_def456...',
  lastUsedAt: null,
  createdAt: new Date('2025-01-12T10:00:00Z'),
  revokedAt: null,
};

const mockRevokedApiKey = {
  id: 'key-revoked',
  userId: 'user-1',
  name: 'Old Key',
  keyPrefix: 'sk_sotto_old123...',
  lastUsedAt: new Date('2025-01-05T10:00:00Z'),
  createdAt: new Date('2025-01-01T10:00:00Z'),
  revokedAt: new Date('2025-01-08T10:00:00Z'),
};

describe('GET /api/keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when session has no user', async () => {
    mockAuth.mockResolvedValue({ user: null });

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns empty array when user has no API keys', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrisma.apiKey.findMany.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('returns list of API keys for authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrisma.apiKey.findMany.mockResolvedValue([mockApiKey, mockApiKey2]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('key-1');
    expect(body[1].id).toBe('key-2');
  });

  it('returns only selected fields (no keyHash exposed)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrisma.apiKey.findMany.mockResolvedValue([mockApiKey]);

    const response = await GET();
    const body = await response.json();

    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('name');
    expect(body[0]).toHaveProperty('keyPrefix');
    expect(body[0]).toHaveProperty('lastUsedAt');
    expect(body[0]).toHaveProperty('createdAt');
    expect(body[0]).toHaveProperty('revokedAt');
    expect(body[0]).not.toHaveProperty('keyHash');
  });

  it('includes revoked keys in the list', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrisma.apiKey.findMany.mockResolvedValue([mockApiKey, mockRevokedApiKey]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
    expect(body[1].revokedAt).toBeTruthy();
  });
});

describe('POST /api/keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Key' }),
    });
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 400 for invalid input (missing name)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const request = createRequest('http://localhost:3000/api/keys', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for invalid input (name too long)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });


    const request = createRequest('http://localhost:3000/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'a'.repeat(101) }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when user has reached MAX_ACTIVE_KEYS limit (10)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    mockPrisma.apiKey.count.mockResolvedValue(10);

    const request = createRequest('http://localhost:3000/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Key' }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Maximum of 10 active API keys allowed');
  });

  it('creates API key successfully for authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    mockPrisma.apiKey.count.mockResolvedValue(3);

    mockGenerateApiKey.mockReturnValue({
      key: 'sk_sotto_abc123def456',
      hash: 'hash123',
      prefix: 'sk_sotto_abc123...',
    });

    mockPrisma.apiKey.create.mockResolvedValue({
      id: 'key-new',
      userId: 'user-1',
      name: 'Production Key',
      keyHash: 'hash123',
      keyPrefix: 'sk_sotto_abc123...',
      createdAt: new Date('2025-01-20T10:00:00Z'),
      lastUsedAt: null,
      revokedAt: null,
    });

    const request = createRequest('http://localhost:3000/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'Production Key' }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe('key-new');
    expect(body.name).toBe('Production Key');
    expect(body.keyPrefix).toBe('sk_sotto_abc123...');
  });

  it('returns full API key only on creation (shown once)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    mockPrisma.apiKey.count.mockResolvedValue(0);

    mockGenerateApiKey.mockReturnValue({
      key: 'sk_sotto_fullkeyhere123456',
      hash: 'hash123',
      prefix: 'sk_sotto_fullkey...',
    });

    mockPrisma.apiKey.create.mockResolvedValue({
      id: 'key-new',
      userId: 'user-1',
      name: 'Test Key',
      keyHash: 'hash123',
      keyPrefix: 'sk_sotto_fullkey...',
      createdAt: new Date('2025-01-20T10:00:00Z'),
      lastUsedAt: null,
      revokedAt: null,
    });

    const request = createRequest('http://localhost:3000/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Key' }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.key).toBe('sk_sotto_fullkeyhere123456');
  });

  it('generates API key with sk_sotto_ prefix', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    mockPrisma.apiKey.count.mockResolvedValue(0);

    mockGenerateApiKey.mockReturnValue({
      key: 'sk_sotto_test123',
      hash: 'hash123',
      prefix: 'sk_sotto_test123...',
    });

    mockPrisma.apiKey.create.mockResolvedValue({
      id: 'key-new',
      userId: 'user-1',
      name: 'Test Key',
      keyHash: 'hash123',
      keyPrefix: 'sk_sotto_test123...',
      createdAt: new Date('2025-01-20T10:00:00Z'),
      lastUsedAt: null,
      revokedAt: null,
    });

    const request = createRequest('http://localhost:3000/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Key' }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.key).toMatch(/^sk_sotto_/);
  });

});

describe('DELETE /api/keys/[keyId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/keys/key-1', { method: 'DELETE' });
    const response = await DELETE(request, { params: Promise.resolve({ keyId: 'key-1' }) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when API key does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrisma.apiKey.findUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/keys/nonexistent', {
      method: 'DELETE',
    });
    const response = await DELETE(request, { params: Promise.resolve({ keyId: 'nonexistent' }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('API key not found');
  });

  it("returns 403 when trying to delete another user's API key", async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      userId: 'user-1',
      revokedAt: null,
    });

    const request = createRequest('http://localhost:3000/api/keys/key-1', { method: 'DELETE' });
    const response = await DELETE(request, { params: Promise.resolve({ keyId: 'key-1' }) });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Forbidden');
  });

  it('returns 400 when trying to revoke already revoked key', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      userId: 'user-1',
      revokedAt: new Date('2025-01-08T10:00:00Z'),
    });

    const request = createRequest('http://localhost:3000/api/keys/key-revoked', {
      method: 'DELETE',
    });
    const response = await DELETE(request, { params: Promise.resolve({ keyId: 'key-revoked' }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('API key already revoked');
  });

  it('revokes API key successfully', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      userId: 'user-1',
      revokedAt: null,
    });
    mockPrisma.apiKey.update.mockResolvedValue(mockApiKey);

    const request = createRequest('http://localhost:3000/api/keys/key-1', { method: 'DELETE' });
    const response = await DELETE(request, { params: Promise.resolve({ keyId: 'key-1' }) });

    expect(response.status).toBe(204);
  });

});
