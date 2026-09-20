// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccessService, HouseholdProfileService } from 'thesidedoor-core/access';
import { FileStateStore, type StateStore } from 'thesidedoor-core/storage';
import type { SidedoorState } from '@/lib/sidedoor/access/state/state';

interface StoredUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
}
const boundary = vi.hoisted(() => ({
  store: null as StateStore<SidedoorState> | null,
  users: new Map<string, StoredUser>(),
  cookies: new Map<string, string>(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      boundary.cookies.has(name) ? { value: boundary.cookies.get(name) } : undefined,
  }),
}));
vi.mock('@/lib/sidedoor/access/state/store', () => ({ sidedoorStateStore: () => boundary.store }));
vi.mock('@/lib/prisma', () => {
  const database = {
    $queryRawUnsafe: async () => [{ isolation: 'serializable' }],
    user: {
      findMany: async () => [...boundary.users.values()],
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const user = boundary.users.get(where.id);
        if (!user) throw new Error('Missing learner');
        return { ...user };
      },
      create: async ({ data }: { data: StoredUser }) => {
        boundary.users.set(data.id, { ...data, image: null });
        return { id: data.id };
      },
    },
  };
  const client = {
    ...database,
    $transaction: async (work: (tx: typeof database) => Promise<unknown>) => work(database),
  };
  return { prisma: client, prismaUnfiltered: client };
});

import { prismaUnfiltered } from '@/lib/prisma';
import { resolveSession } from '@/lib/auth';
import { initialSidedoorState, sidedoorStateSchema } from '@/lib/sidedoor/access/state/state';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';

describe('shared browser content identity', () => {
  let directory: string;
  let access: AccessService;
  let owner: string;
  beforeEach(async () => {
    boundary.cookies.clear();
    boundary.users.clear();
    boundary.users.set('household-reader', {
      id: 'household-reader',
      name: 'Learner',
      email: 'learner@localhost',
      image: null,
      role: 'ADMIN',
    });
    directory = await mkdtemp(join(tmpdir(), 'sotto-session-'));
    boundary.store = new FileStateStore({
      path: join(directory, 'state.json'),
      initial: initialSidedoorState,
      parse: (value) => sidedoorStateSchema.parse(value),
    });
    await boundary.store.transact((state) => {
      state.access.householdProfiles = [{ id: 'household-reader', name: 'Learner', epoch: 0 }];
    });
    access = new AccessService({
      store: new SottoAccessStore(prismaUnfiltered),
      allowOpenHousehold: true,
    });
    owner = await access.claimOwner(
      await access.issueOperatorToken(),
      'Owner',
      'owner password phrase',
      'household'
    );
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  it('does not authenticate or create an ambient owner from a profile cookie', async () => {
    boundary.cookies.set('sotto_profile', 'household-reader');
    const before = [...boundary.users.keys()];
    expect(await resolveSession()).toBeNull();
    expect([...boundary.users.keys()]).toEqual(before);
  });
  it('derives owner authority from the signed-in principal despite the informational database role', async () => {
    boundary.cookies.set('sotto_session', owner);
    const principal = (await access.authenticate(owner)).principal!;
    expect(boundary.users.get(principal.id)?.role).toBe('USER');
    expect(await resolveSession()).toMatchObject({
      user: { id: principal.id, role: 'ADMIN' },
      principalId: principal.id,
      isOwner: true,
    });
  });
  it('selects household content without inheriting the learner ADMIN flag', async () => {
    const token = await access.enterOpenHousehold();
    await new HouseholdProfileService(access).select(token, 'household-reader');
    boundary.cookies.set('sotto_session', token);
    expect(await resolveSession()).toMatchObject({
      user: { id: 'household-reader', role: 'USER' },
      principalId: null,
      isOwner: false,
    });
  });
  it('requires explicit profile selection after household admission', async () => {
    boundary.cookies.set('sotto_session', await access.enterOpenHousehold());
    boundary.cookies.set('sotto_profile', 'household-reader');
    expect(await resolveSession()).toBeNull();
  });
  it('rejects revoked and forged sessions', async () => {
    boundary.cookies.set('sotto_session', owner);
    await access.logout(owner);
    expect(await resolveSession()).toBeNull();
    boundary.cookies.set('sotto_session', 'forged-session');
    expect(await resolveSession()).toBeNull();
  });
  it('fails closed when the authenticated learner was removed instead of recreating it', async () => {
    boundary.cookies.set('sotto_session', owner);
    const id = (await access.authenticate(owner)).principal!.id;
    boundary.users.delete(id);
    await expect(resolveSession()).rejects.toMatchObject({ code: 'conflict' });
    expect(boundary.users.has(id)).toBe(false);
  });

  it.each(['', 'Basic credentials', 'Bearer', 'Bearer wrong, Bearer other', 'Bearer forged'])(
    'does not use a valid browser cookie when Authorization is %j',
    async (authorization) => {
      const request = new Request('https://sotto.example/api/v1/episodes', {
        headers: { authorization, cookie: `sotto_session=${owner}` },
      });
      expect(
        await prismaUnfiltered.$transaction((tx) => resolveSottoRequest(tx, request))
      ).toBeNull();
    }
  );

  it('keeps a principal device on its own learner and honors its delegated scope', async () => {
    const devices = sottoDeviceService(access);
    const device = await devices.redeemPairing(
      await devices.issuePairing(owner, ['app'], 'Tablet')
    );
    const request = new Request('https://sotto.example/api/v1/episodes', {
      headers: { authorization: `Bearer ${device}` },
    });
    const principal = (await access.authenticate(owner)).principal!;
    expect(
      await prismaUnfiltered.$transaction((tx) => resolveSottoRequest(tx, request))
    ).toMatchObject({
      kind: 'content',
      authentication: 'device',
      userId: principal.id,
      principalId: principal.id,
      isOwner: false,
    });
    request.headers.set('x-sotto-profile-id', 'household-reader');
    expect(
      await prismaUnfiltered.$transaction((tx) => resolveSottoRequest(tx, request))
    ).toBeNull();
  });
});
