/**
 * Admin Waitlist PATCH Endpoint — Behavioral Tests
 *
 * Tests approve/reject actions, auth guards, and email notifications.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth-guards
const mockRequireAdmin = vi.fn();
vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

// Mock Prisma
const mockPrismaWaitlist = {
  findUnique: vi.fn(),
  update: vi.fn(),
};
vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlist: mockPrismaWaitlist,
  },
}));

// Mock email
const mockSendEmail = vi.fn().mockResolvedValue(undefined);
const mockAssertEmailDeliveryConfigured = vi.fn();
const mockBuildWaitlistApprovalEmail = vi.fn().mockReturnValue({
  subject: "You're in!",
  html: '<p>approved</p>',
});
vi.mock('@/lib/email', () => ({
  assertEmailDeliveryConfigured: () => mockAssertEmailDeliveryConfigured(),
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));
vi.mock('@/lib/email-templates', () => ({
  buildWaitlistApprovalEmail: (...args: unknown[]) => mockBuildWaitlistApprovalEmail(...args),
}));

// Mock api-response
vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) => {
    return new Response(JSON.stringify({ error: message }), { status });
  },
}));

async function getHandler() {
  const mod = await import('@/app/api/admin/waitlist/route');
  return mod.PATCH;
}

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/admin/waitlist'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Admin Waitlist PATCH — approve/reject', () => {
  let handler: Awaited<ReturnType<typeof getHandler>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAssertEmailDeliveryConfigured.mockReturnValue(undefined);
    mockSendEmail.mockResolvedValue(undefined);
    handler = await getHandler();
  });

  it('returns 403 for non-admin users', async () => {
    mockRequireAdmin.mockResolvedValue(null);

    const res = await handler(createPatchRequest({ id: 'wl-1', status: 'APPROVED' }));
    expect(res.status).toBe(403);
  });

  it('approves a waitlist entry and sends email', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPrismaWaitlist.findUnique.mockResolvedValue({
      id: 'wl-1',
      email: 'user@example.com',
      status: 'PENDING',
      unsubscribed: false,
    });
    mockPrismaWaitlist.update.mockResolvedValue({
      id: 'wl-1',
      email: 'user@example.com',
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: 'admin-1',
    });

    const res = await handler(createPatchRequest({ id: 'wl-1', status: 'APPROVED' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entry.status).toBe('APPROVED');
    expect(body.entry.approvedBy).toBe('admin-1');

    // Verify update was called with correct data
    expect(mockPrismaWaitlist.update).toHaveBeenCalledWith({
      where: { id: 'wl-1' },
      data: expect.objectContaining({
        status: 'APPROVED',
        approvedBy: 'admin-1',
      }),
    });

    expect(mockAssertEmailDeliveryConfigured).toHaveBeenCalled();
    expect(mockBuildWaitlistApprovalEmail).toHaveBeenCalledWith('user@example.com');
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: "You're in!",
      html: '<p>approved</p>',
    });
  });

  it('does not approve a waitlist entry when approval email is not configured', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPrismaWaitlist.findUnique.mockResolvedValue({
      id: 'wl-1',
      email: 'user@example.com',
      status: 'PENDING',
      unsubscribed: false,
    });
    mockAssertEmailDeliveryConfigured.mockImplementation(() => {
      throw new Error('EMAIL_FROM is required');
    });

    const res = await handler(createPatchRequest({ id: 'wl-1', status: 'APPROVED' }));
    expect(res.status).toBe(503);
    expect(mockPrismaWaitlist.update).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns an error when approval email delivery fails', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPrismaWaitlist.findUnique.mockResolvedValue({
      id: 'wl-1',
      email: 'user@example.com',
      status: 'PENDING',
      unsubscribed: false,
    });
    mockPrismaWaitlist.update.mockResolvedValue({
      id: 'wl-1',
      email: 'user@example.com',
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: 'admin-1',
    });
    mockSendEmail.mockRejectedValue(new Error('resend unavailable'));

    const res = await handler(createPatchRequest({ id: 'wl-1', status: 'APPROVED' }));
    expect(res.status).toBe(502);
    expect(mockPrismaWaitlist.update).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalled();
  });

  it('rejects a waitlist entry without sending email', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPrismaWaitlist.findUnique.mockResolvedValue({
      id: 'wl-2',
      email: 'reject@example.com',
      status: 'PENDING',
      unsubscribed: false,
    });
    mockPrismaWaitlist.update.mockResolvedValue({
      id: 'wl-2',
      email: 'reject@example.com',
      status: 'REJECTED',
    });

    const res = await handler(createPatchRequest({ id: 'wl-2', status: 'REJECTED' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entry.status).toBe('REJECTED');

    expect(mockAssertEmailDeliveryConfigured).not.toHaveBeenCalled();
    expect(mockBuildWaitlistApprovalEmail).not.toHaveBeenCalled();
  });

  it('returns 404 for non-existent entry', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockPrismaWaitlist.findUnique.mockResolvedValue(null);

    const res = await handler(createPatchRequest({ id: 'nonexistent', status: 'APPROVED' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status value', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');

    const res = await handler(createPatchRequest({ id: 'wl-1', status: 'INVALID' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing id', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');

    const res = await handler(createPatchRequest({ status: 'APPROVED' }));
    expect(res.status).toBe(400);
  });
});
