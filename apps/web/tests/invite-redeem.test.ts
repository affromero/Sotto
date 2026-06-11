/**
 * Invite Redemption API — Behavioral Tests
 *
 * Tests valid redemption and expired/used/disabled links.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Prisma
const mockInvitationLinkFindUnique = vi.fn();
const mockInvitationLinkUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}));

// Mock api-response
vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) => {
    return new Response(JSON.stringify({ error: message }), { status });
  },
}));

async function getHandler() {
  const mod = await import('@/app/api/v1/invite/redeem/route');
  return mod.POST;
}

function createRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/invite/redeem'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function setupTransaction() {
  const tx = {
    invitationLink: {
      findUnique: mockInvitationLinkFindUnique,
      update: mockInvitationLinkUpdate,
    },
  };
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
}

describe('POST /api/v1/invite/redeem', () => {
  let handler: Awaited<ReturnType<typeof getHandler>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    handler = await getHandler();
    setupTransaction();
  });

  it('returns 400 for missing email', async () => {
    const res = await handler(createRequest({ code: 'abc123' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email', async () => {
    const res = await handler(createRequest({ code: 'abc123', email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when invitation code does not exist', async () => {
    mockInvitationLinkFindUnique.mockResolvedValue(null);
    const res = await handler(createRequest({ code: 'nonexistent', email: 'user@test.com' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 when invitation is disabled', async () => {
    mockInvitationLinkFindUnique.mockResolvedValue({
      id: 'inv-1', code: 'abc123', enabled: false, usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    });
    const res = await handler(createRequest({ code: 'abc123', email: 'user@test.com' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('disabled');
  });

  it('returns 400 when invitation is already used', async () => {
    mockInvitationLinkFindUnique.mockResolvedValue({
      id: 'inv-1', code: 'abc123', enabled: true, usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    });
    const res = await handler(createRequest({ code: 'abc123', email: 'user@test.com' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('already been used');
  });

  it('returns 400 when invitation is expired', async () => {
    mockInvitationLinkFindUnique.mockResolvedValue({
      id: 'inv-1', code: 'abc123', enabled: true, usedAt: null,
      expiresAt: new Date(Date.now() - 60000),
    });
    const res = await handler(createRequest({ code: 'abc123', email: 'user@test.com' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('expired');
  });

  it('redeems a valid invitation and marks the link as used', async () => {
    const email = 'newuser@test.com';
    mockInvitationLinkFindUnique.mockResolvedValue({
      id: 'inv-1', code: 'abc123', enabled: true, usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    });
    mockInvitationLinkUpdate.mockResolvedValue({ id: 'inv-1' });

    const res = await handler(createRequest({ code: 'abc123', email }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify invitation marked as used
    expect(mockInvitationLinkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ email, usedAt: expect.any(Date) }),
      }),
    );
  });

  it('allows the same email to redeem a different invitation link', async () => {
    const email = 'existing@test.com';
    mockInvitationLinkFindUnique.mockResolvedValue({
      id: 'inv-1', code: 'abc123', enabled: true, usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    });
    mockInvitationLinkUpdate.mockResolvedValue({ id: 'inv-1' });

    const res = await handler(createRequest({ code: 'abc123', email }));
    expect(res.status).toBe(200);

    expect(mockInvitationLinkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ email, usedAt: expect.any(Date) }),
      }),
    );
  });
});
