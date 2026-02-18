import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockReservedHandleFindMany = vi.fn();
const mockReservedHandleFindUnique = vi.fn();
const mockReservedHandleCreate = vi.fn();
const mockReservedHandleDelete = vi.fn();
const mockIsValidHandleFormat = vi.fn();

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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    reservedHandle: {
      findMany: (...args: unknown[]) => mockReservedHandleFindMany(...args),
      findUnique: (...args: unknown[]) => mockReservedHandleFindUnique(...args),
      create: (...args: unknown[]) => mockReservedHandleCreate(...args),
      delete: (...args: unknown[]) => mockReservedHandleDelete(...args),
    },
  },
}));

vi.mock('@/lib/handles', () => ({
  isValidHandleFormat: (...args: unknown[]) => mockIsValidHandleFormat(...args),
}));

import { GET, POST, DELETE } from '@/app/api/admin/handles/route';

function createRequest(body?: Record<string, unknown>): NextRequest {
  if (body) {
    return new NextRequest(new URL('http://localhost:3000/api/admin/handles'), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new NextRequest(new URL('http://localhost:3000/api/admin/handles'));
}

function mockAdmin() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
}

describe('GET /api/admin/handles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns handles list when admin', async () => {
    mockAdmin();
    const mockHandles = [
      { id: '1', handle: 'admin', reason: 'reserved', createdBy: 'admin-1' },
      { id: '2', handle: 'sotto', reason: 'system', createdBy: 'admin-1' },
    ];
    mockReservedHandleFindMany.mockResolvedValue(mockHandles);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ handles: mockHandles });
  });
});

describe('POST /api/admin/handles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest({ handle: 'test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const request = createRequest({ handle: 'test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 for invalid handle format', async () => {
    mockAdmin();
    mockIsValidHandleFormat.mockReturnValue(false);

    const request = createRequest({ handle: 'ab' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Invalid handle format');
  });

  it('returns 409 when handle already reserved', async () => {
    mockAdmin();
    mockIsValidHandleFormat.mockReturnValue(true);
    mockReservedHandleFindUnique.mockResolvedValue({ id: '1', handle: 'taken' });

    const request = createRequest({ handle: 'taken' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: 'Handle already reserved' });
  });

  it('creates reserved handle successfully', async () => {
    mockAdmin();
    mockIsValidHandleFormat.mockReturnValue(true);
    mockReservedHandleFindUnique.mockResolvedValue(null);
    const created = { id: '1', handle: 'newhandle', reason: 'test', createdBy: 'admin-1' };
    mockReservedHandleCreate.mockResolvedValue(created);

    const request = createRequest({ handle: 'NewHandle', reason: 'test' });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(created);
  });
});

describe('DELETE /api/admin/handles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest({ handle: 'test' });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when handle is missing', async () => {
    mockAdmin();

    const request = createRequest({});
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'handle is required' });
  });

  it('returns 404 when handle not found', async () => {
    mockAdmin();
    mockReservedHandleFindUnique.mockResolvedValue(null);

    const request = createRequest({ handle: 'nonexistent' });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Handle not found' });
  });

  it('deletes handle successfully', async () => {
    mockAdmin();
    mockReservedHandleFindUnique.mockResolvedValue({ id: '1', handle: 'test' });
    mockReservedHandleDelete.mockResolvedValue({ id: '1', handle: 'test' });

    const request = createRequest({ handle: 'test' });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});
