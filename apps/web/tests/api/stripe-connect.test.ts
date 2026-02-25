import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const mockUserFindUniqueOrThrow = vi.fn();
const mockUserUpdate = vi.fn();
const mockAccountsCreate = vi.fn();
const mockAccountLinksCreate = vi.fn();
const mockAccountsRetrieve = vi.fn();
const mockAccountsCreateLoginLink = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    accounts: {
      create: (...args: unknown[]) => mockAccountsCreate(...args),
      retrieve: (...args: unknown[]) => mockAccountsRetrieve(...args),
      createLoginLink: (...args: unknown[]) => mockAccountsCreateLoginLink(...args),
    },
    accountLinks: {
      create: (...args: unknown[]) => mockAccountLinksCreate(...args),
    },
  },
  LIMITS: { maxDurationMinutes: 40 },
  PLATFORM_FEE_PERCENT: 10,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from '@/app/api/stripe/connect/route';

describe('POST /api/stripe/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('creates a new Stripe account and returns onboarding URL', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      stripeAccountId: null,
      stripeOnboarded: false,
      email: 'test@example.com',
    });
    mockAccountsCreate.mockResolvedValue({ id: 'acct_123' });
    mockUserUpdate.mockResolvedValue({});
    mockAccountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/onboarding' });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ url: 'https://connect.stripe.com/onboarding' });
  });

  it('reuses existing Stripe account when already created', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      stripeAccountId: 'acct_existing',
      stripeOnboarded: false,
      email: 'test@example.com',
    });
    mockAccountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/onboarding' });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ url: 'https://connect.stripe.com/onboarding' });
  });
});

describe('GET /api/stripe/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns onboarded: false when user has no Stripe account', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      stripeAccountId: null,
      stripeOnboarded: false,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ onboarded: false, accountId: null, dashboardUrl: null });
  });

  it('returns dashboard URL when account is fully onboarded', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      stripeAccountId: 'acct_123',
      stripeOnboarded: true,
    });
    mockAccountsRetrieve.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: true,
    });
    mockAccountsCreateLoginLink.mockResolvedValue({
      url: 'https://dashboard.stripe.com/login',
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      onboarded: true,
      accountId: 'acct_123',
      dashboardUrl: 'https://dashboard.stripe.com/login',
    });
  });
});
