/**
 * Unit tests for the first-user-becomes-owner bootstrap. On a self-host with no
 * ADMIN_EMAILS, the first account is promoted to ADMIN (household owner); it is a
 * no-op on hosted installs and once an owner already exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUserCount = vi.fn();
const mockUserUpdate = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      count: (...args: unknown[]) => mockUserCount(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}));

const mockHasConfiguredAdminEmails = vi.fn();
vi.mock('@/lib/admin-emails', () => ({
  hasConfiguredAdminEmails: () => mockHasConfiguredAdminEmails(),
}));

import { bootstrapFirstUserAsOwner } from '@/lib/owner-bootstrap';

describe('bootstrapFirstUserAsOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('promotes the first account to ADMIN on a fresh self-host', async () => {
    mockHasConfiguredAdminEmails.mockReturnValue(false);
    mockUserCount.mockResolvedValue(0); // no other admin exists

    const promoted = await bootstrapFirstUserAsOwner('owner-1');

    expect(promoted).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'owner-1' },
      data: { role: 'ADMIN' },
    });
  });

  it('is a no-op on hosted installs that configure ADMIN_EMAILS', async () => {
    mockHasConfiguredAdminEmails.mockReturnValue(true);

    const promoted = await bootstrapFirstUserAsOwner('user-2');

    expect(promoted).toBe(false);
    expect(mockUserCount).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('does not grant ownership once an owner already exists', async () => {
    mockHasConfiguredAdminEmails.mockReturnValue(false);
    mockUserCount.mockResolvedValue(1); // an ADMIN already exists

    const promoted = await bootstrapFirstUserAsOwner('user-3');

    expect(promoted).toBe(false);
    expect(mockUserUpdate).not.toHaveBeenCalled();
    // counts admins OTHER than the new user, so the owner is never re-derived
    expect(mockUserCount).toHaveBeenCalledWith({
      where: { role: 'ADMIN', id: { not: 'user-3' } },
    });
  });
});
