export interface SystemUserConfig {
  email: string;
  handle: string;
  name: string;
  bio: string | null;
  image: string | null;
}

export interface SystemUserRecord {
  id: string;
  handle: string | null;
  name: string | null;
  image: string | null;
}

interface SystemUserClient {
  user: {
    findUnique(args: {
      where: { handle: string };
      select: { id: true; handle: true; name: true; image: true };
    }): Promise<SystemUserRecord | null>;
  };
}

export class SystemUserConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SystemUserConfigError';
  }
}

export class SystemUserNotFoundError extends Error {
  constructor(handle: string) {
    super(`Configured system owner @${handle} was not found. Run prisma db seed.`);
    this.name = 'SystemUserNotFoundError';
  }
}

export function getSystemUserErrorStatus(error: unknown): 404 | 500 {
  return error instanceof SystemUserNotFoundError ? 404 : 500;
}

export function getSystemUserErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'System owner account is not configured';
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new SystemUserConfigError(`${name} is required to resolve the system owner account`);
  }
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function normalizeSystemUserHandle(handle: string): string {
  const normalized = handle.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{3,30}$/.test(normalized)) {
    throw new SystemUserConfigError(
      'SYSTEM_USER_HANDLE must be 3-30 lowercase letters, numbers, or underscores',
    );
  }
  return normalized;
}

export function getSystemUserHandle(): string {
  return normalizeSystemUserHandle(requiredEnv('SYSTEM_USER_HANDLE'));
}

export function getSystemUserLabel(): string {
  return `@${getSystemUserHandle()}`;
}

export function getSystemUserConfig(): SystemUserConfig {
  return {
    email: requiredEnv('SYSTEM_USER_EMAIL').toLowerCase(),
    handle: getSystemUserHandle(),
    name: requiredEnv('SYSTEM_USER_NAME'),
    bio: optionalEnv('SYSTEM_USER_BIO'),
    image: optionalEnv('SYSTEM_USER_IMAGE'),
  };
}

export async function findSystemUser(prismaClient: SystemUserClient): Promise<SystemUserRecord | null> {
  const handle = getSystemUserHandle();
  return prismaClient.user.findUnique({
    where: { handle },
    select: { id: true, handle: true, name: true, image: true },
  });
}

export async function requireSystemUser(prismaClient: SystemUserClient): Promise<SystemUserRecord> {
  const handle = getSystemUserHandle();
  const user = await prismaClient.user.findUnique({
    where: { handle },
    select: { id: true, handle: true, name: true, image: true },
  });
  if (!user) {
    throw new SystemUserNotFoundError(handle);
  }
  return user;
}
