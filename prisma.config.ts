import { defineConfig } from 'prisma/config';

// Prisma 7 removed `url`/`directUrl` from the schema datasource block. Migration
// commands (`prisma db push`, `prisma migrate`) read the connection from here,
// using the direct (non-pooler) URL. Runtime queries go through the node-postgres
// driver adapter wired in apps/web/src/lib/prisma.ts; `prisma generate` needs no
// database, so it ignores the datasource entirely.
export default defineConfig({
  schema: 'apps/web/prisma/schema.prisma',
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  },
});
