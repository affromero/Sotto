import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;

  if (!url) {
    // During build time (next build), DATABASE_URL may not be set.
    // Prisma client will fail at query time, not import time.
    return new PrismaClient();
  }

  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error(
      `DATABASE_URL has invalid format: ${url.substring(0, 20)}...\n\n` +
        `Must start with 'postgresql://' or 'postgres://'\n` +
        `Example: DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sotto?schema=public"\n`
    );
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
