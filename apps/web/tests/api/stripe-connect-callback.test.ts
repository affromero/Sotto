import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAccountsRetrieve = vi.fn();
const mockUserUpdateMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      updateMany: (...args: unknown[]) => mockUserUpdateMany(...args),
    },
  },
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    accounts: {
      retrieve: (...args: unknown[]) => mockAccountsRetrieve(...args),
    },
  },
  LIMITS: { maxDurationMinutes: 40 },
  PLATFORM_FEE_PERCENT: 10,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/stripe/connect/callback/route';

function createRequest(accountId?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/stripe/connect/callback');
  if (accountId) {
    url.searchParams.set('account_id', accountId);
  }
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/stripe/connect/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to error when account_id is missing', async () => {
    const request = createRequest();
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/voices?stripe=error');
  });

  it('redirects to success when account is fully onboarded', async () => {
    mockAccountsRetrieve.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: true,
    });
    mockUserUpdateMany.mockResolvedValue({ count: 1 });

    const request = createRequest('acct_123');
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/voices?stripe=success');
  });

  it('redirects to pending when account is not yet fully onboarded', async () => {
    mockAccountsRetrieve.mockResolvedValue({
      charges_enabled: false,
      payouts_enabled: false,
    });

    const request = createRequest('acct_123');
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/voices?stripe=pending');
  });

  it('redirects to error when Stripe API throws', async () => {
    mockAccountsRetrieve.mockRejectedValue(new Error('Stripe API error'));

    const request = createRequest('acct_123');
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/voices?stripe=error');
  });
});
