// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockGet })),
}));

const mockUserFindUnique = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) } },
}));

const mockEnsureLocalUser = vi.fn();
vi.mock('@/lib/local-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/local-user')>();
  return {
    LOCAL_USER_ID: actual.LOCAL_USER_ID,
    ACTIVE_PROFILE_COOKIE: actual.ACTIVE_PROFILE_COOKIE,
    ensureLocalUser: (...args: unknown[]) => mockEnsureLocalUser(...args),
  };
});

import { resolveSession } from '@/lib/auth';
import { LOCAL_USER_ID } from '@/lib/local-user';
import { ACTIVE_PROFILE_COOKIE } from '@/lib/local-user';
import { createGateToken, GATE_COOKIE } from '@/lib/access/gate';

const owner = {
  id: LOCAL_USER_ID,
  name: 'Learner',
  email: 'learner@localhost',
  image: null,
  role: 'ADMIN' as const,
};

const member = {
  id: 'member-1',
  name: 'Lena',
  email: 'profile-abc@localhost',
  image: '/avatars/toucan.png',
  role: 'USER' as const,
};

describe('resolveSession (cookie-driven household identity)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SOTTO_ACCESS_PASSWORD;
    mockUserFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === member.id) return member;
      if (where.id === LOCAL_USER_ID) return owner;
      return null;
    });
  });

  afterEach(() => {
    delete process.env.SOTTO_ACCESS_PASSWORD;
    delete process.env.BYOK_ENCRYPTION_KEY;
  });

  it('falls back to the owner (ADMIN) when no profile cookie is set', async () => {
    mockGet.mockReturnValue(undefined);

    const session = await resolveSession();

    expect(session?.user.id).toBe(LOCAL_USER_ID);
    expect(session?.user.role).toBe('ADMIN');
    expect(mockEnsureLocalUser).not.toHaveBeenCalled();
  });

  it('resolves the active profile from the cookie with its real (USER) role', async () => {
    mockGet.mockReturnValue({ value: member.id });

    const session = await resolveSession();

    expect(session?.user.id).toBe('member-1');
    expect(session?.user.name).toBe('Lena');
    expect(session?.user.role).toBe('USER');
  });

  it('falls back to the owner when the cookie points at a deleted profile', async () => {
    mockGet.mockReturnValue({ value: 'deleted-profile' });

    const session = await resolveSession();

    expect(session?.user.id).toBe(LOCAL_USER_ID);
    expect(session?.user.role).toBe('ADMIN');
  });

  it('provisions the owner on a fresh install when no row exists yet', async () => {
    mockGet.mockReturnValue(undefined);
    mockUserFindUnique.mockResolvedValue(null);
    mockEnsureLocalUser.mockResolvedValue(owner);

    const session = await resolveSession();

    expect(mockEnsureLocalUser).toHaveBeenCalledOnce();
    expect(session?.user.id).toBe(LOCAL_USER_ID);
    expect(session?.user.role).toBe('ADMIN');
  });

  it('does not resolve the owner when the configured access gate cookie is missing', async () => {
    process.env.SOTTO_ACCESS_PASSWORD = 'family-secret';
    mockGet.mockReturnValue(undefined);

    const session = await resolveSession();

    expect(session).toBeNull();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockEnsureLocalUser).not.toHaveBeenCalled();
  });

  it('does not resolve the owner when the access gate cookie is forged', async () => {
    process.env.SOTTO_ACCESS_PASSWORD = 'family-secret';
    process.env.BYOK_ENCRYPTION_KEY = 'a'.repeat(32);
    mockGet.mockImplementation((name: string) =>
      name === GATE_COOKIE ? { value: '123.forged' } : undefined
    );

    const session = await resolveSession();

    expect(session).toBeNull();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('resolves the selected profile after validating the access gate cookie', async () => {
    process.env.SOTTO_ACCESS_PASSWORD = 'family-secret';
    process.env.BYOK_ENCRYPTION_KEY = 'a'.repeat(32);
    const gateToken = await createGateToken();
    expect(gateToken).not.toBeNull();
    mockGet.mockImplementation((name: string) => {
      if (name === GATE_COOKIE) return { value: gateToken };
      if (name === ACTIVE_PROFILE_COOKIE) return { value: member.id };
      return undefined;
    });

    const session = await resolveSession();

    expect(session?.user.id).toBe(member.id);
    expect(session?.user.role).toBe('USER');
  });
});
