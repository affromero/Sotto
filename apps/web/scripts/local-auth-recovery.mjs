#!/usr/bin/env node
/*
 * Local sign-in recovery for self-hosted instances. Use this on the server when
 * nobody can sign in (forgotten owner password, or you want to fall back to OAuth).
 * Needs DATABASE_URL in the environment, for example through Infisical:
 *
 *   infisical run --projectId b1b8cc4c-b65d-4d63-8382-7c3d4ac9dcac --env dev -- node apps/web/scripts/local-auth-recovery.mjs list
 *   infisical run --projectId b1b8cc4c-b65d-4d63-8382-7c3d4ac9dcac --env dev -- node apps/web/scripts/local-auth-recovery.mjs reset <userId> <newPassword>
 *   infisical run --projectId b1b8cc4c-b65d-4d63-8382-7c3d4ac9dcac --env dev -- node apps/web/scripts/local-auth-recovery.mjs disable-local-auth
 *
 * reset re-hashes the password and bumps tokenVersion so old sessions are revoked.
 * disable-local-auth turns the profile picker off so OAuth sign-in is primary again.
 */
import { PrismaClient } from '@prisma/client';
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const COST = 16384;
const KEYLEN = 64;

async function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEYLEN, { N: COST });
  return `scrypt$${COST}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

const prisma = new PrismaClient();

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'list') {
    const users = await prisma.user.findMany({
      where: { passwordHash: { not: null } },
      select: { id: true, name: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    if (users.length === 0) {
      console.log('No local accounts. Sign-in uses OAuth or no owner exists yet.');
    }
    for (const u of users) {
      console.log(`${u.role.padEnd(6)} ${u.id}  ${u.name ?? '(no name)'}`);
    }
    return;
  }

  if (cmd === 'reset') {
    const [userId, newPassword] = args;
    if (!userId || !newPassword || newPassword.length < 8) {
      console.error('Usage: reset <userId> <newPassword (min 8 chars)>');
      process.exitCode = 1;
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, forcePasswordChange: false, tokenVersion: { increment: 1 } },
      select: { id: true, name: true },
    });
    console.log(`Password reset for ${user.name ?? user.id}. Active sessions revoked.`);
    return;
  }

  if (cmd === 'disable-local-auth') {
    await prisma.siteConfig.upsert({
      where: { id: 'singleton' },
      update: { localAuth: false },
      create: { id: 'singleton', localAuth: false },
    });
    console.log('Local auth disabled. The profile picker is off; OAuth sign-in is primary.');
    return;
  }

  console.error('Commands: list | reset <userId> <newPassword> | disable-local-auth');
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
