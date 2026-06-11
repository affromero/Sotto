import { randomUUID } from 'crypto';
import { prisma } from './prisma';
import { hashPassword, verifyPassword } from './password';
import { isAnimalSlug, avatarImagePath } from './avatars';

/**
 * Local (password) account operations for the self-hosted profile sign-in. The
 * first account becomes the owner (ADMIN); the owner adds members (USER). All
 * password handling goes through scrypt (lib/password.ts), and no plaintext is
 * ever stored or returned. tokenVersion is bumped to invalidate active JWT
 * sessions on password reset or member removal.
 */

export class OwnerExistsError extends Error {
  constructor() {
    super('An owner already exists');
    this.name = 'OwnerExistsError';
  }
}

export class InvalidPasswordError extends Error {
  constructor() {
    super('Current password is incorrect');
    this.name = 'InvalidPasswordError';
  }
}

/** A synthesized unique email for a local account that has no real email. */
function localEmail(): string {
  return `${randomUUID()}@local.sotto`;
}

function avatarToImage(avatar?: string): string | null {
  return avatar && isAnimalSlug(avatar) ? avatarImagePath(avatar) : null;
}

/** Create the first owner. Refuses (OwnerExistsError) if any account exists. */
export async function createOwner(input: {
  name: string;
  password: string;
  avatar?: string;
}): Promise<{ id: string }> {
  const count = await prisma.user.count();
  if (count > 0) throw new OwnerExistsError();

  const passwordHash = await hashPassword(input.password);
  return prisma.user.create({
    data: {
      name: input.name,
      email: localEmail(),
      image: avatarToImage(input.avatar),
      role: 'ADMIN',
      passwordHash,
      hasCompletedOnboarding: false,
    },
    select: { id: true },
  });
}

/**
 * Create a household member (USER). With a password they must change it on first
 * sign-in; with no password they become a passwordless member who taps to sign in.
 */
export async function createMember(input: {
  name: string;
  password?: string;
  avatar?: string;
}): Promise<{ id: string }> {
  const hasPassword = typeof input.password === 'string' && input.password.length > 0;
  const passwordHash = hasPassword ? await hashPassword(input.password as string) : null;
  return prisma.user.create({
    data: {
      name: input.name,
      email: localEmail(),
      image: avatarToImage(input.avatar),
      role: 'USER',
      passwordHash,
      passwordless: !hasPassword,
      forcePasswordChange: hasPassword,
      hasCompletedOnboarding: false,
    },
    select: { id: true },
  });
}

/** Admin updates a member: rename, re-avatar, or reset the password. */
export async function updateMember(input: {
  memberId: string;
  name?: string;
  avatar?: string;
  resetPassword?: string;
}): Promise<void> {
  const data: {
    name?: string;
    image?: string | null;
    passwordHash?: string;
    forcePasswordChange?: boolean;
    tokenVersion?: { increment: number };
  } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.avatar !== undefined) data.image = avatarToImage(input.avatar);
  if (input.resetPassword !== undefined) {
    data.passwordHash = await hashPassword(input.resetPassword);
    data.forcePasswordChange = true;
    // Reset invalidates the member's active sessions.
    data.tokenVersion = { increment: 1 };
  }
  await prisma.user.update({ where: { id: input.memberId }, data });
}

/** Remove a member and invalidate their sessions. Owners cannot be removed here. */
export async function removeMember(memberId: string): Promise<void> {
  // Bump tokenVersion first so any in-flight session is invalidated, then delete.
  await prisma.user.update({
    where: { id: memberId },
    data: { tokenVersion: { increment: 1 } },
  });
  await prisma.user.delete({ where: { id: memberId } });
}

/** Self-service password change. Verifies the current password first. */
export async function changeOwnPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { passwordHash: true },
  });
  if (!user || !user.passwordHash) throw new InvalidPasswordError();
  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw new InvalidPasswordError();

  // The user knows the new password, so keep their current session valid (no
  // tokenVersion bump). Admin reset and member removal invalidate sessions.
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({
    where: { id: input.userId },
    data: { passwordHash, forcePasswordChange: false },
  });
}
