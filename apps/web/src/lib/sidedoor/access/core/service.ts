import { AccessService, HouseholdProfileService } from 'thesidedoor-core/access';
import { prismaUnfiltered } from '@/lib/prisma';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import type { AccessHttpOptions } from 'thesidedoor-core/access/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { issueSottoPairing } from '@/lib/sidedoor/access/core/pairing';

export { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
export const sharedAccessStore = new SottoAccessStore(prismaUnfiltered);
export const sharedAccess = new AccessService({
  store: sharedAccessStore,
});
export const sharedProfiles = new HouseholdProfileService(sharedAccess);
export const sharedDevices: NonNullable<AccessHttpOptions['devices']> = {
  list: (token) =>
    sottoTransaction(prismaUnfiltered, async (database) => {
      const access = new AccessService({
        store: await sottoAccessStore(database),
      });
      return sottoDeviceService(access).list(token);
    }),
  issuePairing: (token, scopes, name, options) =>
    sottoTransaction(prismaUnfiltered, async (database) => {
      const issued = await issueSottoPairing(database, token, name, { scopes, ...options });
      return issued.token;
    }),
  revoke: (token, id) =>
    sottoTransaction(prismaUnfiltered, async (database) => {
      const access = new AccessService({
        store: await sottoAccessStore(database),
      });
      const devices = sottoDeviceService(access);
      const exists = (await access.store.read()).deviceTokens.some((device) => device.id === id);
      await devices.revoke(token, id);
      if (!exists) return;
      await database.apiKey.updateMany({
        where: { keyHash: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }),
};
