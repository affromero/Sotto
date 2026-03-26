import { Prisma, PrismaClient } from '@prisma/client';

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

  const isPooler = url.includes('-pooler.') || url.includes('pgbouncer=true');
  const poolUrl = url.includes('connection_limit')
    ? url
    : isPooler
      ? `${url}${url.includes('?') ? '&' : '?'}connection_limit=1&pgbouncer=true`
      : `${url}${url.includes('?') ? '&' : '?'}connection_limit=5&pool_timeout=10`;

  return new PrismaClient({
    datasources: { db: { url: poolUrl } },
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

const basePrisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma;

/** Raw Prisma client — no soft-delete filtering. Use in workers, pipeline code, and admin. */
export const prismaUnfiltered = basePrisma;

/** Prisma client with automatic soft-delete filtering on the Podcast model. */
export const prisma = basePrisma.$extends({
  query: {
    podcast: {
      async findMany({ args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
      async count({ args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
      async groupBy({ args, query }) {
        (args as { where?: Prisma.PodcastWhereInput }).where = {
          ...(args as { where?: Prisma.PodcastWhereInput }).where,
          deletedAt: null,
        };
        return query(args);
      },
      async aggregate({ args, query }) {
        args.where = { ...args.where, deletedAt: null };
        return query(args);
      },
      async findUnique({ args, query }) {
        // findUnique doesn't support arbitrary where filters, so we run the
        // query and check deletedAt on the result.
        if (args.select) {
          // Temporarily inject deletedAt into select so we can check it.
          const originalSelect = args.select;
          args.select = { ...originalSelect, deletedAt: true };
          const result = await query(args) as Record<string, unknown> | null;
          if (!result || result.deletedAt != null) return null;
          // Strip the injected field from the result.
          delete result.deletedAt;
          return result;
        }
        const result = await query(args) as Record<string, unknown> | null;
        if (!result || result.deletedAt != null) return null;
        return result;
      },
      async findUniqueOrThrow({ args, query }) {
        if (args.select) {
          const originalSelect = args.select;
          args.select = { ...originalSelect, deletedAt: true };
          const result = await query(args) as Record<string, unknown>;
          if (result.deletedAt != null) {
            throw new Prisma.PrismaClientKnownRequestError('No Podcast found', {
              code: 'P2025',
              clientVersion: Prisma.prismaVersion.client,
            });
          }
          delete result.deletedAt;
          return result;
        }
        const result = await query(args) as Record<string, unknown>;
        if (result.deletedAt != null) {
          throw new Prisma.PrismaClientKnownRequestError('No Podcast found', {
            code: 'P2025',
            clientVersion: Prisma.prismaVersion.client,
          });
        }
        return result;
      },
    },
  },
});
