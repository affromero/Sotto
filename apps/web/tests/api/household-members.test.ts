/**
 * /api/household/members — admin-only member management. Adversarial: every
 * method refuses a non-admin, you cannot remove yourself or another admin, and
 * removal goes through removeMember (which revokes sessions).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireAdmin = vi.fn();
const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockCreateMember = vi.fn();
const mockUpdateMember = vi.fn();
const mockRemoveMember = vi.fn();

vi.mock('@/lib/auth-guards', () => ({ requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
    },
  },
}));
vi.mock('@/lib/local-account', () => ({
  createMember: (...a: unknown[]) => mockCreateMember(...a),
  updateMember: (...a: unknown[]) => mockUpdateMember(...a),
  removeMember: (...a: unknown[]) => mockRemoveMember(...a),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET, POST, PATCH, DELETE } from '@/app/api/household/members/route';

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/household/members', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

describe('/api/household/members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue('admin1');
    mockFindMany.mockResolvedValue([]);
    mockCreateMember.mockResolvedValue({ id: 'm1' });
  });

  it('refuses a non-admin on every method', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
    expect((await POST(req('POST', { name: 'a', password: 'temppass12' }))).status).toBe(403);
    expect((await PATCH(req('PATCH', { memberId: 'm1', name: 'b' }))).status).toBe(403);
    expect((await DELETE(req('DELETE', { memberId: 'm1' }))).status).toBe(403);
    expect(mockCreateMember).not.toHaveBeenCalled();
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  it('creates a member for an admin', async () => {
    const res = await POST(req('POST', { name: 'Kid', password: 'temppass12', avatar: 'sloth' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ memberId: 'm1' });
  });

  it('refuses to remove yourself', async () => {
    const res = await DELETE(req('DELETE', { memberId: 'admin1' }));
    expect(res.status).toBe(400);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  it('refuses to remove another admin', async () => {
    mockFindUnique.mockResolvedValue({ role: 'ADMIN' });
    const res = await DELETE(req('DELETE', { memberId: 'admin2' }));
    expect(res.status).toBe(400);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  it('removes a member (revoking sessions) for an admin', async () => {
    mockFindUnique.mockResolvedValue({ role: 'USER' });
    const res = await DELETE(req('DELETE', { memberId: 'm1' }));
    expect(res.status).toBe(200);
    expect(mockRemoveMember).toHaveBeenCalledWith('m1');
  });

  it('refuses to patch your own profile through this route', async () => {
    const res = await PATCH(req('PATCH', { memberId: 'admin1', name: 'x' }));
    expect(res.status).toBe(400);
    expect(mockUpdateMember).not.toHaveBeenCalled();
  });
});
