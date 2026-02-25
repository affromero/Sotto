import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}));

import { PATCH } from '@/app/api/admin/users/[userId]/role/route';

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/users/user-2/role'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function createParams(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

describe('PATCH /api/admin/users/[userId]/role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest({ role: 'CREATOR' });
    const params = await createParams('user-2');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 403 when user is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const request = createRequest({ role: 'CREATOR' });
    const params = await createParams('user-2');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('returns 400 when trying to change own role', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const request = createRequest({ role: 'USER' });
    const params = await createParams('admin-1');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Cannot change your own role' });
  });

  it('returns 400 for invalid role', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    const request = createRequest({ role: 'SUPERADMIN' });
    const params = await createParams('user-2');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request');
  });

  it('updates user role successfully', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const updatedUser = { id: 'user-2', name: 'Test User', email: 'test@test.com', role: 'CREATOR' };
    mockUserUpdate.mockResolvedValue(updatedUser);

    const request = createRequest({ role: 'CREATOR' });
    const params = await createParams('user-2');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(updatedUser);
  });

  it('returns 500 when prisma throws non-zod error', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockUserUpdate.mockRejectedValue(new Error('DB error'));

    const request = createRequest({ role: 'CREATOR' });
    const params = await createParams('user-2');
    const response = await PATCH(request, params);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: 'Failed to update user role' });
  });
});
