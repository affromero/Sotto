import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserUpdate = vi.fn();
const mockTagFindMany = vi.fn();
const mockTagUpsert = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
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

import { POST as completeOnboarding } from '@/app/api/onboarding/complete/route';
import { POST as saveInterests } from '@/app/api/onboarding/interests/route';

function createRequest(body?: object): NextRequest {
  const url = new URL('http://localhost:3000/api/onboarding/interests');
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method: 'POST' };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(url, init);
}

describe('POST /api/onboarding/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await completeOnboarding();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const response = await completeOnboarding();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('marks onboarding complete and returns success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserUpdate.mockResolvedValue({ id: 'user-1', hasCompletedOnboarding: true });

    const response = await completeOnboarding();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});

describe('POST /api/onboarding/interests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await saveInterests(createRequest({ tagIds: [] }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 for invalid request body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const response = await saveInterests(createRequest({ tagIds: 'not-an-array' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when combined tags exceed 20', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
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
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockTagFindMany.mockResolvedValue([{ id: 'tag-1', parentId: 'parent-1' }]);

    const response = await saveInterests(createRequest({ tagIds: ['tag-1', 'tag-missing'] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('tag IDs are invalid');
  });

  it('returns 400 when top-level tags are selected', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockTagFindMany.mockResolvedValue([
      { id: 'tag-1', parentId: null },
    ]);

    const response = await saveInterests(createRequest({ tagIds: ['tag-1'] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('sub-interest tags');
  });

  it('saves interests and returns success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
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
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
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
