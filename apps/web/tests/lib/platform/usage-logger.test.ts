import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return boundary.database;
  },
}));
import { logUsage } from '@/lib/usage-logger';
import {
  getUsageHeadline,
  getSpendByService,
  getSpendByCategory,
  getSpendByDay,
  getCostByUser,
} from '@/lib/admin/usage-stats';
import AdminUsagePage from '@/app/(admin)/admin/usage/page';
import { renderToStaticMarkup } from 'react-dom/server';

const databaseUrl = process.env.SIDEDOOR_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('usage persistence in PostgreSQL', () => {
  const schema = `usage_${randomUUID().replaceAll('-', '')}`;
  let database: PrismaClient;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sidedoor_test')
      throw new Error('Usage tests require the isolated local sidedoor_test database');
    database = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, options: `-c search_path=${schema}` },
        { schema }
      ),
    });
    boundary.database = database;
    await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await database.$executeRawUnsafe(
      'CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "name" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    );
    await database.$executeRawUnsafe(`CREATE TABLE "ApiUsageLog" (
      "id" TEXT PRIMARY KEY, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "episodeId" TEXT, "userId" TEXT, "service" TEXT NOT NULL, "modelId" TEXT,
      "category" TEXT NOT NULL, "inputTokens" INTEGER, "outputTokens" INTEGER,
      "totalCost" DOUBLE PRECISION NOT NULL, "durationMs" INTEGER, "metadata" JSONB NOT NULL DEFAULT '{}'
    )`);
    await database.$executeRawUnsafe(
      `INSERT INTO "ApiUsageLog" ("id","service","category","totalCost") VALUES ('historical-cli','claude-code','fixture',0),('measured-free','moderation','fixture',0),('measured-cli','codex','fixture',1.5)`
    );
    const sql = await readFile(
      'prisma/migrations/20260912195000_unknown_usage_cost/migration.sql',
      'utf8'
    );
    for (const statement of sql
      .replace(/^--.*$/gm, '')
      .split(';')
      .filter((part) => part.trim()))
      await database.$executeRawUnsafe(statement);
    for (const [table, input, output] of [
      ['ResearchDossier', 'totalInputTokens', 'totalOutputTokens'],
      ['CreativeOutline', 'inputTokens', 'outputTokens'],
    ]) {
      await database.$executeRawUnsafe(`CREATE TABLE "${table}" (
        "id" TEXT PRIMARY KEY, "${input}" INTEGER NOT NULL DEFAULT 0,
        "${output}" INTEGER NOT NULL DEFAULT 0
      )`);
      await database.$executeRawUnsafe(
        `INSERT INTO "${table}" ("id", "${input}", "${output}") VALUES ('historical', 0, 17)`
      );
    }
    const pipelineSql = await readFile(
      'prisma/migrations/20260913001000_unknown_pipeline_usage/migration.sql',
      'utf8'
    );
    for (const statement of pipelineSql
      .replace(/^--.*$/gm, '')
      .split(';')
      .filter((part) => part.trim()))
      await database.$executeRawUnsafe(statement);
  });
  afterAll(async () => {
    if (!database) return;
    await database.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await database.$disconnect();
  });

  it('migrates fabricated CLI costs without changing explicit free-service history', async () => {
    expect(
      await database.apiUsageLog.findUnique({ where: { id: 'historical-cli' } })
    ).toMatchObject({ totalCost: null });
    expect(await database.apiUsageLog.findUnique({ where: { id: 'measured-free' } })).toMatchObject(
      { totalCost: 0 }
    );
    expect(await database.apiUsageLog.findUnique({ where: { id: 'measured-cli' } })).toMatchObject({
      totalCost: 1.5,
    });
  });

  it('persists unknown measurements and cost before the logger returns', async () => {
    await logUsage({ service: 'openai', model: 'gpt-5-nano', category: 'unknown' });
    expect(await database.apiUsageLog.findFirst({ where: { category: 'unknown' } })).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalCost: null,
    });
  });

  it.each([
    ['ResearchDossier', 'totalInputTokens', 'totalOutputTokens'],
    ['CreativeOutline', 'inputTokens', 'outputTokens'],
  ])(
    'preserves history and independent unknown measurements in %s',
    async (table, input, output) => {
      await database.$executeRawUnsafe(`INSERT INTO "${table}" ("id") VALUES ('omitted')`);
      await database.$executeRawUnsafe(
        `INSERT INTO "${table}" ("id", "${input}", "${output}") VALUES
       ('unknown-input', NULL, 0), ('unknown-output', 23, NULL), ('unknown-both', NULL, NULL)`
      );
      expect(
        await database.$queryRawUnsafe(
          `SELECT "id", "${input}" AS "input", "${output}" AS "output" FROM "${table}" ORDER BY "id"`
        )
      ).toEqual([
        { id: 'historical', input: 0, output: 17 },
        { id: 'omitted', input: null, output: null },
        { id: 'unknown-both', input: null, output: null },
        { id: 'unknown-input', input: null, output: 0 },
        { id: 'unknown-output', input: 23, output: null },
      ]);
    }
  );

  it('keeps measured usage on a subscription without assigning hosted API prices', async () => {
    await logUsage({
      service: 'claude-code',
      model: 'claude-sonnet-4-6',
      category: 'subscription',
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(
      await database.apiUsageLog.findFirst({ where: { category: 'subscription' } })
    ).toMatchObject({ inputTokens: 100, outputTokens: 50, totalCost: null });
  });

  it('retains explicit costs and computes known API token estimates', async () => {
    await logUsage({
      service: 'openai',
      model: 'gpt-5-nano',
      category: 'known',
      inputTokens: 500000,
      outputTokens: 200000,
    });
    await logUsage({ service: 'moderation', category: 'free', totalCost: 0 });
    expect(
      (await database.apiUsageLog.findFirst({ where: { category: 'known' } }))?.totalCost
    ).toBeCloseTo(0.105);
    expect((await database.apiUsageLog.findFirst({ where: { category: 'free' } }))?.totalCost).toBe(
      0
    );
  });

  it('rejects invalid measurements before persistence', async () => {
    for (const inputTokens of [-1, 0.5, Infinity])
      await expect(
        logUsage({ service: 'openai', category: 'invalid', inputTokens })
      ).rejects.toThrow('token counts');
    for (const totalCost of [-1, NaN, Infinity])
      await expect(logUsage({ service: 'openai', category: 'invalid', totalCost })).rejects.toThrow(
        'cost'
      );
    expect(await database.apiUsageLog.count({ where: { category: 'invalid' } })).toBe(0);
  });

  it('keeps partial totals, unknown-only days and asymmetric token coverage visible', async () => {
    const now = new Date('2036-04-15T12:00:00Z').getTime();
    await database.$executeRawUnsafe(
      `INSERT INTO "User" ("id","name") VALUES ('partial','Partial learner')`
    );
    await database.apiUsageLog.createMany({
      data: [
        {
          id: 'partial-cost',
          createdAt: new Date(now - 1000),
          service: 'openai',
          category: 'mixed',
          userId: 'partial',
          inputTokens: 10,
          outputTokens: null,
          totalCost: 2,
        },
        {
          id: 'unknown-cost',
          createdAt: new Date(now - 86400000),
          service: 'openai',
          category: 'mixed',
          userId: 'partial',
          totalCost: null,
        },
        {
          id: 'free-cost',
          createdAt: new Date(now - 1000),
          service: 'moderation',
          category: 'free-service',
          totalCost: 0,
        },
        {
          id: 'subscription-cost',
          createdAt: new Date(now - 1000),
          service: 'claude-code',
          category: 'subscription',
          inputTokens: 0,
          outputTokens: 0,
          totalCost: null,
        },
      ],
    });
    expect(await getUsageHeadline(3, now)).toMatchObject({
      spend: 2,
      requests: 4,
      unknownCosts: 2,
      tokenRequests: 3,
      tokensIn: 10,
      tokensOut: 0,
      unknownInputTokens: 1,
      unknownOutputTokens: 2,
    });
    expect(await getSpendByService(3, now)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'openai', usd: 2, requests: 2, unknownCosts: 1 }),
        expect.objectContaining({ service: 'claude-code', usd: 0, requests: 1, unknownCosts: 1 }),
        expect.objectContaining({ service: 'moderation', usd: 0, requests: 1, unknownCosts: 0 }),
      ])
    );
    expect(await getSpendByCategory(3, now)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'mixed', usd: 2, unknownCosts: 1 }),
      ])
    );
    expect(await getSpendByDay(3, now)).toEqual([
      { day: '2036-04-12', usd: 0, requests: 0, unknownCosts: 0 },
      { day: '2036-04-13', usd: 0, requests: 0, unknownCosts: 0 },
      { day: '2036-04-14', usd: 0, requests: 1, unknownCosts: 1 },
      { day: '2036-04-15', usd: 2, requests: 3, unknownCosts: 1 },
    ]);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const html = renderToStaticMarkup(await AdminUsagePage());
      expect(html).toContain('$2.00 (partial)');
      expect(html).toContain('Unknown');
      expect(html).toContain('requests have unknown costs');
      expect(html).toContain('of known spend');
      expect(html).not.toContain('% vs prior');
    } finally {
      clock.mockRestore();
    }
  });

  it('identifies limited learner coverage when unknown-only learners fall below the top eight', async () => {
    const now = new Date('2037-04-15T12:00:00Z').getTime();
    for (let index = 0; index < 9; index++) {
      const userId = `ranking-${index}`;
      await database.$executeRawUnsafe(
        'INSERT INTO "User" ("id","name") VALUES ($1,$2)',
        userId,
        `Learner ${index}`
      );
      await database.apiUsageLog.create({
        data: {
          createdAt: new Date(now - 1000),
          service: 'openai',
          category: 'ranking',
          userId,
          totalCost: index === 8 ? null : index + 1,
        },
      });
    }
    expect(await getCostByUser(30, 9, now)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'ranking-8', usd: 0, unknownCosts: 1 }),
      ])
    );
    expect(await getCostByUser(30, 8, now)).toHaveLength(8);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const html = renderToStaticMarkup(await AdminUsagePage());
      expect(html).toContain('Unknown costs may occur outside this list');
      expect(html).toContain('requests have unknown costs');
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps the earliest partial day and excludes records at or after the shared upper boundary', async () => {
    const now = new Date('2038-04-15T12:00:00Z').getTime();
    await database.apiUsageLog.createMany({
      data: [
        {
          id: 'lower-partial',
          createdAt: new Date(now - 3 * 86400000 + 1),
          service: 'openai',
          category: 'boundary',
          totalCost: null,
        },
        {
          id: 'at-upper',
          createdAt: new Date(now),
          service: 'openai',
          category: 'boundary',
          totalCost: 10,
        },
        {
          id: 'after-upper',
          createdAt: new Date(now + 1000),
          service: 'openai',
          category: 'boundary',
          totalCost: 20,
        },
      ],
    });
    const days = await getSpendByDay(3, now);
    expect(days[0]).toEqual({ day: '2038-04-12', usd: 0, requests: 1, unknownCosts: 1 });
    expect(days.reduce((sum, day) => sum + day.requests, 0)).toBe(1);
    expect(await getUsageHeadline(3, now)).toMatchObject({
      requests: 1,
      unknownCosts: 1,
      spend: 0,
    });
    expect(await getSpendByService(3, now)).toEqual([
      expect.objectContaining({ requests: 1, unknownCosts: 1, usd: 0 }),
    ]);
    expect(await getSpendByCategory(3, now)).toEqual([
      expect.objectContaining({ requests: 1, unknownCosts: 1, usd: 0 }),
    ]);
  });
});
