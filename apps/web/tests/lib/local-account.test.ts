/**
 * local-account: the security-critical local sign-in account operations.
 * Adversarial coverage: passwords are hashed not stored plaintext, a second owner
 * is refused, members must change a temp password, a wrong current password is
 * rejected, and removal plus reset bump tokenVersion to revoke sessions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCount = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      count: (...a: unknown[]) => mockCount(...a),
      create: (...a: unknown[]) => mockCreate(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      delete: (...a: unknown[]) => mockDelete(...a),
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
    },
  },
}));

import {
  createOwner,
  createMember,
  updateMember,
  removeMember,
  changeOwnPassword,
  OwnerExistsError,
  InvalidPasswordError,
} from '@/lib/local-account';
import { hashPassword, verifyPassword } from '@/lib/password';

describe('local-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 'u1' });
    mockUpdate.mockResolvedValue({});
    mockDelete.mockResolvedValue({});
  });

  it('createOwner makes an ADMIN with a hashed, not plaintext, password', async () => {
    mockCount.mockResolvedValue(0);
    await createOwner({ name: 'Andres', password: 'supersecret1', avatar: 'capybara' });
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.role).toBe('ADMIN');
    expect(data.image).toBe('/avatars/capybara.png');
    expect(data.passwordHash).not.toBe('supersecret1');
    expect(data.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('supersecret1', data.passwordHash)).toBe(true);
  });

  it('createOwner refuses a second owner', async () => {
    mockCount.mockResolvedValue(1);
    await expect(createOwner({ name: 'x', password: 'supersecret1' })).rejects.toBeInstanceOf(
      OwnerExistsError,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('createMember makes a USER who must change the temporary password', async () => {
    await createMember({ name: 'Kid', password: 'temppass12' });
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.role).toBe('USER');
    expect(data.forcePasswordChange).toBe(true);
    expect(data.passwordHash).not.toBe('temppass12');
  });

  it('changeOwnPassword rejects a wrong current password', async () => {
    const stored = await hashPassword('rightpass1');
    mockFindUnique.mockResolvedValue({ passwordHash: stored });
    await expect(
      changeOwnPassword({ userId: 'u1', currentPassword: 'wrong', newPassword: 'newpass1234' }),
    ).rejects.toBeInstanceOf(InvalidPasswordError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('changeOwnPassword sets a new hash and clears force-change on a correct current', async () => {
    const stored = await hashPassword('rightpass1');
    mockFindUnique.mockResolvedValue({ passwordHash: stored });
    await changeOwnPassword({ userId: 'u1', currentPassword: 'rightpass1', newPassword: 'newpass1234' });
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.forcePasswordChange).toBe(false);
    expect(data.passwordHash).not.toBe('newpass1234');
    expect(await verifyPassword('newpass1234', data.passwordHash)).toBe(true);
    // Self-change keeps the current session, so no tokenVersion bump.
    expect(data.tokenVersion).toBeUndefined();
  });

  it('removeMember bumps tokenVersion to revoke sessions, then deletes', async () => {
    await removeMember('m1');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1' }, data: { tokenVersion: { increment: 1 } } }),
    );
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('updateMember reset re-hashes, forces change, and bumps tokenVersion', async () => {
    await updateMember({ memberId: 'm1', resetPassword: 'reset12345' });
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.forcePasswordChange).toBe(true);
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data.passwordHash).not.toBe('reset12345');
  });
});
