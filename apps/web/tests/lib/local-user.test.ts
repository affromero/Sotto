// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUserCreate = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      create: (...args: unknown[]) => mockUserCreate(...args),
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
  },
}));

import {
  createProfile,
  hasCompletedInitialOnboarding,
  listProfiles,
  LOCAL_USER_ID,
} from '@/lib/local-user';

describe('createProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'new-id',
      ...data,
    }));
  });

  it('creates a regular (USER) learner with a unique placeholder email', async () => {
    await createProfile({ name: 'Lena' });

    const { data } = mockUserCreate.mock.calls[0][0];
    expect(data.role).toBe('USER');
    expect(data.name).toBe('Lena');
    expect(data.hasCompletedOnboarding).toBe(false);
    expect(data.email).toMatch(/^profile-[0-9a-f-]+@localhost$/);
  });

  it('seeds a preset animal avatar when a slug is given, null otherwise', async () => {
    await createProfile({ name: 'Theo', avatarSlug: 'toucan' });
    expect(mockUserCreate.mock.calls[0][0].data.image).toBe('/avatars/toucan.png');

    await createProfile({ name: 'Sofia' });
    expect(mockUserCreate.mock.calls[1][0].data.image).toBeNull();
  });

  it('gives each profile a distinct email', async () => {
    await createProfile({ name: 'A' });
    await createProfile({ name: 'B' });
    const emailA = mockUserCreate.mock.calls[0][0].data.email;
    const emailB = mockUserCreate.mock.calls[1][0].data.email;
    expect(emailA).not.toBe(emailB);
  });
});

describe('listProfiles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the owner first regardless of creation order', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'member-1', name: 'Lena' },
      { id: LOCAL_USER_ID, name: 'Owner' },
      { id: 'member-2', name: 'Theo' },
    ]);

    const profiles = await listProfiles();

    expect(profiles[0].id).toBe(LOCAL_USER_ID);
    expect(profiles).toHaveLength(3);
  });
});

describe('hasCompletedInitialOnboarding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is false before the owner exists', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    await expect(hasCompletedInitialOnboarding()).resolves.toBe(false);
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: LOCAL_USER_ID },
      select: { hasCompletedOnboarding: true },
    });
  });

  it('reflects the owner completion flag', async () => {
    mockUserFindUnique.mockResolvedValue({ hasCompletedOnboarding: true });

    await expect(hasCompletedInitialOnboarding()).resolves.toBe(true);
  });
});
