// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccessService, HouseholdProfileService, tokenHash } from 'thesidedoor-core/access';
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
  keys: new Map<string, { revokedAt: Date | null; lastUsedAt: Date | null }>(),
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
    apiKey: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { keyHash: string; OR?: Array<{ lastUsedAt: null | { lt: Date } }> };
        data: { revokedAt?: Date; lastUsedAt?: Date };
      }) => {
        const key = boundary.keys.get(where.keyHash);
        if (!key || key.revokedAt) return { count: 0 };
        if (
          where.OR &&
          !where.OR.some(({ lastUsedAt }) =>
            lastUsedAt === null
              ? key.lastUsedAt === null
              : key.lastUsedAt !== null && key.lastUsedAt < lastUsedAt.lt
          )
        )
          return { count: 0 };
        Object.assign(key, data);
        return { count: 1 };
      },
    },
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
import { authenticateRequest, validateApiKey } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { initialSidedoorState, sidedoorStateSchema } from '@/lib/sidedoor/access/state/state';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import { issueSottoPairing } from '@/lib/sidedoor/access/core/pairing';
import { sharedDevices } from '@/lib/sidedoor/access/core/service';

describe('native shared access authority', () => {
  let directory: string;
  let access: AccessService;
  let owner: string;
  beforeEach(async () => {
    boundary.cookies.clear();
    boundary.users.clear();
    boundary.keys.clear();
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

  function request(token?: string, profile?: string) {
    const headers = new Headers();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (profile) headers.set('x-sotto-profile-id', profile);
    return new Request('https://sotto.example/api/v1/episodes', { headers });
  }

  it('does not grant ambient access to anonymous clients', async () => {
    expect(await authenticateRequest(request())).toBeNull();
  });

  it('keeps device usage and shared revocation metadata consistent with authority', async () => {
    const devices = sottoDeviceService(access);
    const token = await devices.redeemPairing(await devices.issuePairing(owner, ['app'], 'Tablet'));
    const id = tokenHash(token);
    boundary.keys.set(id, { revokedAt: null, lastUsedAt: null });
    expect(await authenticateRequest(request(token))).not.toBeNull();
    const lastUsedAt = boundary.keys.get(id)!.lastUsedAt;
    expect(lastUsedAt).toBeInstanceOf(Date);
    await authenticateRequest(request(token));
    expect(boundary.keys.get(id)!.lastUsedAt).toEqual(lastUsedAt);
    const household = await access.enterOpenHousehold();
    await expect(sharedDevices.revoke(household, id)).rejects.toMatchObject({ code: 'forbidden' });
    expect(boundary.keys.get(id)!.revokedAt).toBeNull();
    await sharedDevices.revoke(owner, id);
    const revokedAt = boundary.keys.get(id)!.revokedAt;
    expect(revokedAt).toBeInstanceOf(Date);
    expect(await authenticateRequest(request(token))).toBeNull();
    await sharedDevices.revoke(owner, id);
    expect(boundary.keys.get(id)!.revokedAt).toEqual(revokedAt);
  });

  it('rejects shared pairing requests that cannot identify an authorized Sotto learner', async () => {
    const issue = (session: string, delegation: { scopes?: string[]; defaultProfileId?: string }) =>
      prismaUnfiltered.$transaction((tx) => issueSottoPairing(tx, session, 'Tablet', delegation));
    await expect(issue(owner, { scopes: ['owner'] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      issue(owner, { scopes: ['app'], defaultProfileId: 'household-reader' })
    ).rejects.toMatchObject({ code: 'forbidden' });
    const household = await access.enterOpenHousehold();
    await expect(issue(household, { scopes: ['app'] })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await new HouseholdProfileService(access).select(household, 'household-reader');
    const code = await issue(household, { scopes: ['app'] });
    const token = await sottoDeviceService(access).redeemPairing(code.token);
    expect(await authenticateRequest(request(token))).toMatchObject({
      userId: 'household-reader',
      isOwner: false,
    });
  });

  it('requires profile selection for household browser content', async () => {
    const session = await access.enterOpenHousehold();
    const browser = request();
    browser.headers.set('cookie', `sotto_session=${session}`);
    expect(await authenticateRequest(browser)).toBeNull();
    await new HouseholdProfileService(access).select(session, 'household-reader');
    const identity = await authenticateRequest(browser);
    expect(identity).toMatchObject({ userId: 'household-reader', isOwner: false });
    expect(isUserAdmin(identity!)).toBe(false);
  });

  it.each([false, true])(
    'honors owner delegation scope %s independently of the learner role',
    async (delegated) => {
      const devices = sottoDeviceService(access);
      const token = await devices.redeemPairing(
        await devices.issuePairing(owner, delegated ? ['app', 'owner'] : ['app'], 'Tablet')
      );
      const identity = await validateApiKey(token);
      expect(identity).toMatchObject({ authentication: 'device', isOwner: delegated });
      expect(boundary.users.get(identity!.userId)?.role).toBe('USER');
      expect(isUserAdmin(identity!)).toBe(delegated);
      expect(await authenticateRequest(request(token, 'household-reader'))).toBeNull();
    }
  );

  it.each(['', 'Basic credentials', 'Bearer', 'Bearer wrong, Bearer other', 'Bearer forged'])(
    'never uses owner cookies with supplied Authorization %j',
    async (authorization) => {
      const browser = request();
      browser.headers.set('cookie', `sotto_session=${owner}`);
      browser.headers.set('authorization', authorization);
      expect(await authenticateRequest(browser)).toBeNull();
    }
  );

  it('keeps revoked device requests revoked despite a valid owner cookie', async () => {
    const devices = sottoDeviceService(access);
    const token = await devices.redeemPairing(
      await devices.issuePairing(owner, ['app', 'owner'], 'Tablet')
    );
    const device = await devices.authenticate(token, ['app']);
    await devices.revoke(owner, device.id);
    const browser = request(token);
    browser.headers.set('cookie', `sotto_session=${owner}`);
    expect(await authenticateRequest(browser)).toBeNull();
  });
});
