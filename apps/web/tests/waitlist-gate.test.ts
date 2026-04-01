/**
 * Waitlist Sign-Up Gate — Behavioral Tests
 *
 * Tests the signIn callback logic: who is allowed to create an account
 * and who gets redirected to the waitlisted page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
const mockPrismaUser = {
  findUnique: vi.fn(),
};
const mockPrismaWaitlist = {
  findUnique: vi.fn(),
  create: vi.fn().mockResolvedValue({}),
};
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: mockPrismaUser,
    waitlist: mockPrismaWaitlist,
  },
}));

// Mock admin-emails
const mockIsAdminEmail = vi.fn();
vi.mock('@/lib/admin-emails', () => ({
  isAdminEmail: (...args: unknown[]) => mockIsAdminEmail(...args),
}));

// Mock site-config
const mockIsOpenSignup = vi.fn();
vi.mock('@/lib/site-config', () => ({
  isOpenSignup: () => mockIsOpenSignup(),
}));

// Mock other auth dependencies that NextAuth imports
vi.mock('@auth/prisma-adapter', () => ({
  PrismaAdapter: () => ({}),
}));
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }));
vi.mock('next-auth/providers/github', () => ({ default: () => ({}) }));
vi.mock('next-auth/providers/twitter', () => ({ default: () => ({}) }));
vi.mock('next-auth/providers/apple', () => ({ default: () => ({}) }));
vi.mock('next-auth', () => {
  let capturedConfig: Record<string, unknown> | null = null;
  return {
    default: (config: Record<string, unknown>) => {
      capturedConfig = config;
      return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
    },
    __getCapturedConfig: () => capturedConfig,
  };
});

async function getSignInCallback() {
  vi.resetModules();
  // Re-import to capture the config
  await import('@/lib/auth');
  const { __getCapturedConfig } = await import('next-auth') as unknown as {
    __getCapturedConfig: () => { callbacks: { signIn: (args: {
      user: { email?: string | null };
      profile?: { email?: string | null };
    }) => Promise<boolean | string> } };
  };
  const config = __getCapturedConfig();
  return config.callbacks.signIn;
}

describe('Waitlist Sign-Up Gate — signIn callback', () => {
  let signIn: Awaited<ReturnType<typeof getSignInCallback>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsAdminEmail.mockReturnValue(false);
    mockIsOpenSignup.mockResolvedValue(false);
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaWaitlist.findUnique.mockResolvedValue(null);
    signIn = await getSignInCallback();
  });

  it('allows existing users to sign in', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({ id: 'user-1' });

    const result = await signIn({
      user: { email: 'existing@example.com' },
      profile: { email: 'existing@example.com' },
    });

    expect(result).toBe(true);
  });

  it('allows admin emails to sign in (bypasses waitlist)', async () => {
    mockIsAdminEmail.mockReturnValue(true);

    const result = await signIn({
      user: { email: 'admin@sotto.fm' },
      profile: { email: 'admin@sotto.fm' },
    });

    expect(result).toBe(true);
  });

  it('redirects new user not on waitlist to waitlisted page and auto-adds to waitlist', async () => {
    const result = await signIn({
      user: { email: 'new@example.com' },
      profile: { email: 'new@example.com' },
    });

    expect(result).toBe('/auth/waitlisted?reason=not-on-list');
    expect(mockPrismaWaitlist.create).toHaveBeenCalledWith({
      data: { email: 'new@example.com', source: 'oauth-signin' },
    });
  });

  it('redirects new user on waitlist with PENDING status', async () => {
    mockPrismaWaitlist.findUnique.mockResolvedValue({
      email: 'pending@example.com',
      status: 'PENDING',
    });

    const result = await signIn({
      user: { email: 'pending@example.com' },
      profile: { email: 'pending@example.com' },
    });

    expect(result).toBe('/auth/waitlisted?reason=pending');
  });

  it('allows new user on waitlist with APPROVED status', async () => {
    mockPrismaWaitlist.findUnique.mockResolvedValue({
      email: 'approved@example.com',
      status: 'APPROVED',
    });

    const result = await signIn({
      user: { email: 'approved@example.com' },
      profile: { email: 'approved@example.com' },
    });

    expect(result).toBe(true);
  });

  it('redirects when no email is available from provider', async () => {
    const result = await signIn({
      user: { email: null },
      profile: { email: null },
    });

    expect(result).toBe('/auth/waitlisted?reason=no-email');
  });

  it('uses profile email over user email', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({ id: 'user-1' });

    const result = await signIn({
      user: { email: 'fallback@example.com' },
      profile: { email: 'profile@example.com' },
    });

    expect(result).toBe(true);
    expect(mockPrismaUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'profile@example.com' },
      select: { id: true },
    });
  });

  it('redirects REJECTED waitlist entry (not re-approvable without admin action)', async () => {
    mockPrismaWaitlist.findUnique.mockResolvedValue({
      email: 'rejected@example.com',
      status: 'REJECTED',
    });

    const result = await signIn({
      user: { email: 'rejected@example.com' },
      profile: { email: 'rejected@example.com' },
    });

    expect(result).toBe('/auth/waitlisted?reason=pending');
  });

  it('allows signup when openSignup=true even without waitlist entry', async () => {
    mockIsOpenSignup.mockResolvedValue(true);

    const result = await signIn({
      user: { email: 'new@example.com' },
      profile: { email: 'new@example.com' },
    });

    expect(result).toBe(true);
    expect(mockPrismaWaitlist.findUnique).not.toHaveBeenCalled();
  });

  it('still gates when openSignup=false', async () => {
    mockIsOpenSignup.mockResolvedValue(false);

    const result = await signIn({
      user: { email: 'new@example.com' },
      profile: { email: 'new@example.com' },
    });

    expect(result).toBe('/auth/waitlisted?reason=not-on-list');
  });
});
