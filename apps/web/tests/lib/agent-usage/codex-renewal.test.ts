// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('managed Codex usage renewal', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('codex_renewal');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    directory = await mkdtemp(join(tmpdir(), 'codex-renewal-'));
    vi.stubEnv('CODEX_HOME', directory);
    vi.stubEnv('PATH', directory + ':' + process.env.PATH);
    vi.stubEnv('SOTTO_CREDENTIAL_SYNC_DIR', '');
    resetCodexUsageCacheForTests();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });

  const token = (expiresAt: number) =>
    'fixture.' + Buffer.from(JSON.stringify({ exp: expiresAt })).toString('base64url') + '.fixture';
  async function auth(expiresAt: number) {
    await writeFile(
      join(directory, 'auth.json'),
      JSON.stringify({
        tokens: { access_token: token(expiresAt), account_id: 'fixture-account' },
      })
    );
  }
  async function exists(name: string) {
    try {
      await access(join(directory, name));
      return true;
    } catch {
      return false;
    }
  }
  async function fixture(mode: 'renew' | 'block' | 'switch' | 'reject' = 'renew') {
    await writeFile(
      join(directory, 'codex'),
      '#!' +
        process.execPath +
        '\n' +
        `
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline');
const home = process.env.CODEX_HOME;
if (process.argv[2] !== 'app-server') process.exit(4);
const ready = path.join(home, 'started');
if (fs.existsSync(ready)) process.exit(5);
fs.writeFileSync(ready, JSON.stringify({pid:process.pid, database:process.env.DATABASE_URL}));
setInterval(() => {}, 1000);
readline.createInterface({input:process.stdin}).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') { console.log(JSON.stringify({id:0,result:{}})); return; }
  if (msg.method === 'initialized') return;
  if (msg.method !== 'account/read' || msg.params.refreshToken !== false) process.exit(6);
  if (${JSON.stringify(mode)} === 'block') return;
  if (${JSON.stringify(mode)} === 'reject') {
    console.log(JSON.stringify({id:1,error:{code:-1,message:'refresh_token_expired'}})); return;
  }
  const value = JSON.parse(fs.readFileSync(path.join(home,'auth.json')));
  value.tokens.access_token = ${JSON.stringify(token(4_000_000_000))};
  value.tokens.account_id = ${JSON.stringify(mode === 'switch' ? 'other-account' : 'fixture-account')};
  value.last_refresh = new Date().toISOString();
  fs.writeFileSync(path.join(home,'auth.json'),JSON.stringify(value));
  console.log(JSON.stringify({id:1,result:{account:{type:'chatgpt'}}}));
});
`,
      { mode: 0o700 }
    );
  }
  async function execution(signal?: AbortSignal) {
    const request = new Request('http://localhost/api/v1/agent-usage', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const original = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!original || original.kind !== 'content') throw new Error('Expected content admission');
    return {
      userId: original.userId,
      signal,
      authorize: async (tx: Parameters<typeof requireOriginalSottoAdmission>[0]) => {
        await requireOriginalSottoAdmission(tx, request, original);
        return { userId: original.userId };
      },
    };
  }
  function readyUsage() {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Request(input, init).headers.get('authorization')).toBe(
        'Bearer ' + token(4_000_000_000)
      );
      return Response.json({
        plan_type: 'pro',
        rate_limit: { primary_window: { used_percent: 12 } },
      });
    });
  }

  it('renews expired credentials without a paid turn and publishes current usage after process drain', async () => {
    await auth(1);
    await fixture();
    readyUsage();
    expect(await getCodexUsageProvider(await execution())).toMatchObject({
      status: 'ready',
      planLabel: 'Pro',
    });
    const started = JSON.parse(await readFile(join(directory, 'started'), 'utf8'));
    expect(started.database).toBeUndefined();
    expect(() => process.kill(started.pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
  });

  it('shares a renewal across simultaneous status readers', async () => {
    await auth(1);
    await fixture();
    readyUsage();
    const context = await execution();
    const results = await Promise.all([
      getCodexUsageProvider(context),
      getCodexUsageProvider(context),
    ]);
    expect(results.map((result) => result.status)).toEqual(['ready', 'ready']);
  });

  it('does not call access denied an expired login or start renewal', async () => {
    await auth(4_000_000_000);
    await fixture();
    vi.stubGlobal('fetch', async () => Response.json({ error: 'access_denied' }, { status: 403 }));
    expect(await getCodexUsageProvider(await execution())).toMatchObject({ status: 'unavailable' });
    expect(await exists('started')).toBe(false);
  });

  it('stops after one renewal when the usage service still rejects the session', async () => {
    await auth(4_000_000_000);
    await fixture();
    vi.stubGlobal('fetch', async () => Response.json({ error: 'token_expired' }, { status: 401 }));
    expect(await getCodexUsageProvider(await execution())).toMatchObject({
      status: 'action_required',
    });
    expect(await exists('started')).toBe(true);
  });

  it('never sends a replacement accounts token to the usage service', async () => {
    await auth(1);
    await fixture('switch');
    const outgoing: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      outgoing.push(new Request(input, init).headers.get('authorization') ?? '');
      return Response.json({ plan_type: 'pro', rate_limit: {} });
    });
    expect(await getCodexUsageProvider(await execution())).toMatchObject({ status: 'unavailable' });
    expect(outgoing).toEqual([]);
  });

  it('surfaces revoked managed sign-in instead of retrying login', async () => {
    await auth(1);
    await fixture('reject');
    expect(await getCodexUsageProvider(await execution())).toMatchObject({
      status: 'action_required',
    });
  });

  it('cancels and drains a stalled renewal before returning', async () => {
    await auth(1);
    await fixture('block');
    const controller = new AbortController();
    const failure = new Error('Status reader canceled');
    const pending = getCodexUsageProvider(await execution(controller.signal));
    const rejected = expect(pending).rejects.toBe(failure);
    await expect.poll(() => exists('started')).toBe(true);
    const started = JSON.parse(await readFile(join(directory, 'started'), 'utf8'));
    controller.abort(failure);
    await rejected;
    expect(() => process.kill(started.pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
  });
});
