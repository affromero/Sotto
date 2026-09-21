// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  resolveSottoRequest,
  requireOriginalSottoAdmission,
} from '@/lib/sidedoor/access/core/request-identity';
import {
  getCodexUsageProvider,
  resetCodexUsageCacheForTests,
} from '@/lib/agent-usage/providers/codex';

const boundary = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  started: false,
  stalled: false,
  token: 'synthetic-token',
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) =>
      String(args[0]).endsWith('/auth.json')
        ? JSON.stringify({
            tokens: { access_token: boundary.token, account_id: 'fixture-account' },
          })
        : actual.readFile(...args),
    stat: (...args: Parameters<typeof actual.stat>) => {
      if (!String(args[0]).endsWith('/auth.json')) return actual.stat(...args);
      boundary.started = true;
      return boundary.stalled ? new Promise(() => {}) : Promise.resolve({ mtimeMs: 1 });
    },
  };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Codex usage canonical account admission', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('codex_usage');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    boundary.started = false;
    boundary.stalled = false;
    boundary.token = 'synthetic-token';
    resetCodexUsageCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });

  async function execution(signal?: AbortSignal) {
    const request = new Request('http://localhost/api/v1/agent-usage', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const original = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!original || original.kind !== 'content')
      throw new Error('Expected fixture content admission');
    return {
      userId: original.userId,
      signal,
      authorize: async (tx: Parameters<typeof requireOriginalSottoAdmission>[0]) => {
        await requireOriginalSottoAdmission(tx, request, original);
        return { userId: original.userId };
      },
    };
  }

  it('cancels account loading while filesystem metadata is stalled', async () => {
    boundary.stalled = true;
    const controller = new AbortController();
    const failure = new Error('Metadata lookup canceled');
    const pending = getCodexUsageProvider(await execution(controller.signal));
    const rejection = expect(pending).rejects.toBe(failure);
    try {
      await expect.poll(() => boundary.started).toBe(true);
    } finally {
      controller.abort(failure);
      await rejection;
    }
  });

  it('uses captured OAuth credentials and refuses revoked cached results before reading local files', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const outgoing = new Request(input, init);
      expect(outgoing.headers.get('authorization')).toBe('Bearer synthetic-token');
      return Response.json({
        plan_type: 'plus',
        rate_limit: { primary_window: { used_percent: 25 } },
      });
    });
    const captured = await execution();
    expect(await getCodexUsageProvider(captured)).toMatchObject({ status: 'ready' });
    boundary.started = false;
    await identity.access.logout(identity.ownerToken);
    await expect(getCodexUsageProvider(captured)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(boundary.started).toBe(false);
  });

  it('rejects usage publication when access is revoked during HTTP', async () => {
    vi.stubGlobal('fetch', async () => {
      await identity.access.logout(identity.ownerToken);
      return Response.json({ plan_type: 'plus', rate_limit: {} });
    });
    await expect(getCodexUsageProvider(await execution())).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('isolates cached DTOs and queries a replacement OAuth account', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = new Request(input, init).headers.get('authorization');
      return Response.json({
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: key === 'Bearer synthetic-token' ? 25 : 60 },
        },
      });
    });
    const captured = await execution();
    const first = await getCodexUsageProvider(captured);
    expect(first.windows[0]?.usedPercent).toBe(25);
    first.windows[0]!.usedPercent = 99;
    expect((await getCodexUsageProvider(captured)).windows[0]?.usedPercent).toBe(25);
    boundary.token = 'replacement-token';
    expect((await getCodexUsageProvider(captured)).windows[0]?.usedPercent).toBe(60);
  });
});
