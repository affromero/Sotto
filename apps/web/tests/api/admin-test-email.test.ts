import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdmin, mockUserFindUnique, mockSendEmail } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock('@/lib/auth-guards', () => ({
  requireAdmin: () => mockRequireAdmin(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}));
vi.mock('@/lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));
vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) => {
    return new Response(JSON.stringify({ error: message }), { status });
  },
}));

async function getHandler() {
  const mod = await import('@/app/api/admin/test-email/route');
  return mod.POST;
}

describe('POST /api/admin/test-email', () => {
  let handler: Awaited<ReturnType<typeof getHandler>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockUserFindUnique.mockResolvedValue({ email: 'admin@example.com' });
    mockSendEmail.mockResolvedValue(undefined);
    handler = await getHandler();
  });

  it('sends a test email to the current admin', async () => {
    const res = await handler();

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@example.com',
        subject: 'Sotto - Test Email',
      })
    );
  });

  it('returns a delivery error when Resend fails', async () => {
    mockSendEmail.mockRejectedValue(new Error('resend unavailable'));

    const res = await handler();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain('resend unavailable');
  });

  it('requires admin access', async () => {
    mockRequireAdmin.mockResolvedValue(null);

    const res = await handler();

    expect(res.status).toBe(403);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
