/**
 * Admin Invitations API — Behavioral Tests
 *
 * Tests POST (generate), GET (list), PATCH (toggle enabled).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth-guards
const mockRequireAdmin = vi.fn();
vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

// Mock Prisma
const mockInvitationLink = {
  create: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
};
vi.mock('@/lib/prisma', () => ({
  prisma: {
    invitationLink: mockInvitationLink,
  },
}));

// Mock api-response
vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) => {
    return new Response(JSON.stringify({ error: message }), { status });
  },
}));

async function getHandlers() {
  const mod = await import('@/app/api/v1/admin/invitations/route');
  return { POST: mod.POST, GET: mod.GET, PATCH: mod.PATCH };
}

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/admin/invitations'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Admin Invitations API', () => {
  let handlers: Awaited<ReturnType<typeof getHandlers>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    handlers = await getHandlers();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST — generate invitation', () => {
    it('returns 403 for non-admin users', async () => {
      mockRequireAdmin.mockResolvedValue(null);
      const res = await handlers.POST();
      expect(res.status).toBe(403);
    });

    it('creates an invitation with a 12-char code and 24h expiry', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      const now = Date.now();
      mockInvitationLink.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({
          id: 'inv-1',
          ...data,
          createdAt: new Date(),
        })
      );

      const res = await handlers.POST();
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.invitation.code).toBeDefined();
      expect(body.url).toBe(`https://selfhost.example.com/invite/${body.invitation.code}`);

      // Verify expiry is ~24h from now
      const createCall = mockInvitationLink.create.mock.calls[0][0].data;
      expect(createCall.code.length).toBe(12);
      expect(createCall.createdBy).toBe('admin-1');
      const expiresAt = new Date(createCall.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThan(now + 23 * 60 * 60 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(now + 25 * 60 * 60 * 1000);
    });
  });

  describe('GET — list invitations', () => {
    it('returns 403 for non-admin users', async () => {
      mockRequireAdmin.mockResolvedValue(null);
      const res = await handlers.GET();
      expect(res.status).toBe(403);
    });

    it('returns invitations with computed status', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      const now = new Date();
      mockInvitationLink.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          code: 'abc123',
          enabled: true,
          usedAt: null,
          expiresAt: new Date(now.getTime() + 60000),
          createdAt: now,
          creator: { name: 'Admin', email: 'admin@test.com' },
        },
        {
          id: 'inv-2',
          code: 'def456',
          enabled: true,
          usedAt: new Date(),
          expiresAt: new Date(now.getTime() + 60000),
          createdAt: now,
          creator: { name: 'Admin', email: 'admin@test.com' },
        },
        {
          id: 'inv-3',
          code: 'ghi789',
          enabled: true,
          usedAt: null,
          expiresAt: new Date(now.getTime() - 60000),
          createdAt: now,
          creator: { name: 'Admin', email: 'admin@test.com' },
        },
        {
          id: 'inv-4',
          code: 'jkl012',
          enabled: false,
          usedAt: null,
          expiresAt: new Date(now.getTime() + 60000),
          createdAt: now,
          creator: { name: 'Admin', email: 'admin@test.com' },
        },
      ]);

      const res = await handlers.GET();
      const body = await res.json();
      expect(body.invitations).toHaveLength(4);
      expect(body.invitations[0].status).toBe('active');
      expect(body.invitations[1].status).toBe('used');
      expect(body.invitations[2].status).toBe('expired');
      expect(body.invitations[3].status).toBe('disabled');
    });
  });

  describe('PATCH — toggle enabled', () => {
    it('returns 403 for non-admin users', async () => {
      mockRequireAdmin.mockResolvedValue(null);
      const res = await handlers.PATCH(createPatchRequest({ id: 'inv-1', enabled: false }));
      expect(res.status).toBe(403);
    });

    it('returns 400 for invalid body', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      const res = await handlers.PATCH(createPatchRequest({ id: 'inv-1' }));
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent invitation', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockInvitationLink.findUnique.mockResolvedValue(null);
      const res = await handlers.PATCH(createPatchRequest({ id: 'inv-1', enabled: false }));
      expect(res.status).toBe(404);
    });

    it('toggles enabled state', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      const invitation = {
        id: 'inv-1',
        code: 'abc123',
        enabled: false,
        usedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      };
      mockInvitationLink.findUnique.mockResolvedValue({ ...invitation, enabled: true });
      mockInvitationLink.update.mockResolvedValue(invitation);

      const res = await handlers.PATCH(createPatchRequest({ id: 'inv-1', enabled: false }));
      expect(res.status).toBe(200);
      expect(mockInvitationLink.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { enabled: false },
      });
    });
  });
});
