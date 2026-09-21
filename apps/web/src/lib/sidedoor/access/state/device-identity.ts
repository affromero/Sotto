import { AccessError, AccessService, DeviceService } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';

export interface SottoDeviceIdentity {
  userId: string;
  principalId: string | null;
  deviceId: string;
  isOwner: boolean;
}

export function sottoDeviceService(access: AccessService): DeviceService {
  return new DeviceService({
    access,
    tokenPrefix: 'sk_sotto_',
    maxDevicesPerProfile: 10,
    managementScope: 'owner',
    scopesFor: (principal) => (principal?.role === 'owner' ? ['app', 'owner'] : ['app']),
  });
}

/** The selected learner controls content ownership, never administrative authority. */
export async function resolveSottoDevice(
  database: Prisma.TransactionClient,
  token: string,
  requestedProfileId: string | null
): Promise<SottoDeviceIdentity> {
  if (requestedProfileId !== null && !requestedProfileId.trim()) throw new AccessError('invalid');
  const access = new AccessService({
    store: await sottoAccessStore(database),
  });
  const devices = sottoDeviceService(access);
  const device = await devices.authenticate(token, ['app']);
  const requested = requestedProfileId?.trim();
  if (device.principal) {
    if (requested !== undefined && requested !== device.principal.id)
      throw new AccessError('forbidden');
    return {
      userId: device.principal.id,
      principalId: device.principal.id,
      deviceId: device.id,
      isOwner: device.principal.role === 'owner' && device.scopes.includes('owner'),
    };
  }
  const selectedId = requested ?? device.defaultProfileId;
  const state = await access.store.read();
  if (!selectedId || !state.householdProfiles?.some((profile) => profile.id === selectedId))
    throw new AccessError('forbidden', 'Choose an available household profile');
  return { userId: selectedId, principalId: null, deviceId: device.id, isOwner: false };
}
