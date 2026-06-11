import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCheckRateLimit,
  mockWaitlistFindUnique,
  mockWaitlistUpsert,
  mockAssertEmailDeliveryConfigured,
  mockSendEmail,
  mockBuildWaitlistWelcomeEmail,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockWaitlistFindUnique: vi.fn(),
  mockWaitlistUpsert: vi.fn(),
  mockAssertEmailDeliveryConfigured: vi.fn(),
  mockSendEmail: vi.fn(),
  mockBuildWaitlistWelcomeEmail: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlist: {
      findUnique: (...args: unknown[]) => mockWaitlistFindUnique(...args),
      upsert: (...args: unknown[]) => mockWaitlistUpsert(...args),
      count: vi.fn(),
    },
    user: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/email', () => ({
  assertEmailDeliveryConfigured: () => mockAssertEmailDeliveryConfigured(),
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));
vi.mock('@/lib/email-templates', () => ({
  buildWaitlistWelcomeEmail: (...args: unknown[]) => mockBuildWaitlistWelcomeEmail(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/api-response', () => ({
  errorResponse: (message: unknown, status: number) => {
    return new Response(JSON.stringify({ error: message }), { status });
  },
}));

async function getHandler() {
  const mod = await import('@/app/api/v1/waitlist/route');
  return mod.POST;
}

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/waitlist'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/waitlist', () => {
  let handler: Awaited<ReturnType<typeof getHandler>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockAssertEmailDeliveryConfigured.mockReturnValue(undefined);
    mockSendEmail.mockResolvedValue(undefined);
    mockBuildWaitlistWelcomeEmail.mockReturnValue({
      subject: 'Welcome to Sotto',
      html: '<p>welcome</p>',
    });
    mockWaitlistUpsert.mockResolvedValue({ id: 'wl-1', email: 'user@example.com' });
    handler = await getHandler();
  });

  it('creates a new waitlist signup and sends the welcome email', async () => {
    mockWaitlistFindUnique.mockResolvedValue(null);

    const res = await handler(createPostRequest({ email: 'user@example.com' }));

    expect(res.status).toBe(201);
    expect(mockAssertEmailDeliveryConfigured).toHaveBeenCalled();
    expect(mockWaitlistUpsert).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Welcome to Sotto',
      html: '<p>welcome</p>',
    });
  });

  it('does not persist a new signup when email delivery is not configured', async () => {
    mockWaitlistFindUnique.mockResolvedValue(null);
    mockAssertEmailDeliveryConfigured.mockImplementation(() => {
      throw new Error('EMAIL_FROM is required');
    });

    const res = await handler(createPostRequest({ email: 'user@example.com' }));

    expect(res.status).toBe(503);
    expect(mockWaitlistUpsert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns an error when welcome email delivery fails', async () => {
    mockWaitlistFindUnique.mockResolvedValue(null);
    mockSendEmail.mockRejectedValue(new Error('resend unavailable'));

    const res = await handler(createPostRequest({ email: 'user@example.com' }));

    expect(res.status).toBe(502);
    expect(mockWaitlistUpsert).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalled();
  });

  it('updates existing waitlist entries without sending duplicate welcome email', async () => {
    mockWaitlistFindUnique.mockResolvedValue({ id: 'wl-1', email: 'user@example.com' });

    const res = await handler(
      createPostRequest({ email: 'user@example.com', wishlist: 'Daily private briefings' })
    );

    expect(res.status).toBe(201);
    expect(mockAssertEmailDeliveryConfigured).not.toHaveBeenCalled();
    expect(mockWaitlistUpsert).toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
