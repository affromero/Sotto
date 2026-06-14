import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockUserUpdate = vi.fn();
const mockTagFindMany = vi.fn();
const mockTagUpsert = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    tag: {
      findMany: (...args: unknown[]) => mockTagFindMany(...args),
      upsert: (...args: unknown[]) => mockTagUpsert(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock('@/lib/slugify', () => ({
  generateTagSlug: (name: string) =>
    name
      .trim()
      .toLowerCase()
      .replace(/[&/]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockValidateDisplayName = vi.fn();
const mockModerateDisplayName = vi.fn();

vi.mock('@/lib/name-validation', () => ({
  validateDisplayName: (...args: unknown[]) => mockValidateDisplayName(...args),
}));

vi.mock('@/lib/name-moderation', () => ({
  moderateDisplayName: (...args: unknown[]) => mockModerateDisplayName(...args),
}));

import { POST as saveInterests } from '@/app/api/v1/onboarding/interests/route';
import { POST as setName } from '@/app/api/v1/onboarding/name/route';

function createRequest(body?: object): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/onboarding/interests');
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method: 'POST' };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(url, init);
}

describe('POST /api/v1/onboarding/interests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await saveInterests(createRequest({ tagIds: [] }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 for invalid request body', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await saveInterests(createRequest({ tagIds: 'not-an-array' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when combined tags exceed 20', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    const tagIds = Array.from({ length: 15 }, (_, i) => `tag-${i}`);
    const customTags = Array.from({ length: 6 }, (_, i) => ({
      name: `Custom ${i}`,
      parentSlug: 'tech',
    }));

    const response = await saveInterests(createRequest({ tagIds, customTags }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Maximum 20 interests');
  });

  it('returns 400 when some tag IDs do not exist', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockTagFindMany.mockResolvedValue([{ id: 'tag-1', parentId: 'parent-1' }]);

    const response = await saveInterests(createRequest({ tagIds: ['tag-1', 'tag-missing'] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('tag IDs are invalid');
  });

  it('returns 400 when top-level tags are selected', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockTagFindMany.mockResolvedValue([
      { id: 'tag-1', parentId: null },
    ]);

    const response = await saveInterests(createRequest({ tagIds: ['tag-1'] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('sub-interest tags');
  });

  it('saves interests and returns success', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockTagFindMany.mockResolvedValue([
      { id: 'tag-1', parentId: 'parent-1' },
      { id: 'tag-2', parentId: 'parent-1' },
    ]);
    mockTransaction.mockImplementation(async (callback) => {
      const tx = {
        userInterest: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        user: {
          update: vi.fn().mockResolvedValue({ id: 'user-1' }),
        },
      };
      return callback(tx);
    });

    const response = await saveInterests(createRequest({ tagIds: ['tag-1', 'tag-2'] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  it('returns 400 for unknown parent category in custom tags', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    // First call: tag validation for tagIds (empty), second call: parent lookup for custom tags
    mockTagFindMany.mockResolvedValueOnce([]); // no parent found

    const response = await saveInterests(
      createRequest({
        tagIds: [],
        customTags: [{ name: 'Quantum Computing', parentSlug: 'nonexistent' }],
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Unknown parent category');
  });
});

function createNameRequest(body?: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/onboarding/name', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/v1/onboarding/name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateDisplayName.mockReturnValue({ valid: true });
    mockModerateDisplayName.mockResolvedValue({ valid: true });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await setName(createNameRequest({ name: 'Alice' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 for empty name', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await setName(createNameRequest({ name: '' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 for missing name field', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await setName(createNameRequest({}));

    expect(response.status).toBe(400);
  });

  it('returns 400 when validateDisplayName rejects', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockValidateDisplayName.mockReturnValue({ valid: false, reason: 'Please enter a real name' });

    const response = await setName(createNameRequest({ name: 'aaaa' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Please enter a real name');
  });

  it('returns 400 when moderateDisplayName rejects', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockModerateDisplayName.mockResolvedValue({ valid: false, reason: 'This name contains inappropriate content' });

    const response = await setName(createNameRequest({ name: 'BadWord' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('This name contains inappropriate content');
  });

  it('saves name and returns success', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockUserUpdate.mockResolvedValue({ id: 'user-1', name: 'Alice' });

    const response = await setName(createNameRequest({ name: 'Alice' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { name: 'Alice' },
    });
  });

  it('trims whitespace from name before saving', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockUserUpdate.mockResolvedValue({ id: 'user-1', name: 'Alice' });

    const response = await setName(createNameRequest({ name: '  Alice  ' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { name: 'Alice' },
    });
  });
});
