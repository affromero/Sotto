import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSystemUserConfig,
  getSystemUserHandle,
  normalizeSystemUserHandle,
  requireSystemUser,
  SystemUserConfigError,
  SystemUserNotFoundError,
} from '@/lib/system-user';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('system user identity', () => {
  it('normalizes explicit handles', () => {
    expect(normalizeSystemUserHandle('@Team_Bot')).toBe('team_bot');
    expect(normalizeSystemUserHandle('system123')).toBe('system123');
  });

  it('rejects missing or invalid handles', () => {
    expect(() => getSystemUserHandle()).toThrow(SystemUserConfigError);
    expect(() => normalizeSystemUserHandle('x')).toThrow(SystemUserConfigError);
    expect(() => normalizeSystemUserHandle('bad-handle')).toThrow(SystemUserConfigError);
  });

  it('reads required seed configuration from explicit env vars', () => {
    vi.stubEnv('SYSTEM_USER_EMAIL', 'System@Example.com');
    vi.stubEnv('SYSTEM_USER_HANDLE', '@Team_Bot');
    vi.stubEnv('SYSTEM_USER_NAME', 'Team Bot');
    vi.stubEnv('SYSTEM_USER_BIO', 'Local system owner');
    vi.stubEnv('SYSTEM_USER_IMAGE', '/brand/profile?v=amber');

    expect(getSystemUserConfig()).toEqual({
      email: 'system@example.com',
      handle: 'team_bot',
      name: 'Team Bot',
      bio: 'Local system owner',
      image: '/brand/profile?v=amber',
    });
  });

  it('requires the configured user to exist', async () => {
    vi.stubEnv('SYSTEM_USER_HANDLE', 'system');
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(requireSystemUser(prisma)).rejects.toThrow(SystemUserNotFoundError);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { handle: 'system' },
      select: { id: true, handle: true, name: true, image: true },
    });
  });
});
