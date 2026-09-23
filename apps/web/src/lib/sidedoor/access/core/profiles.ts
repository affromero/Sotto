import { randomUUID } from 'node:crypto';
import { StorageReferenceRegistry } from 'thesidedoor-core/storage';
import {
  AccessError,
  AccessService,
  HouseholdProfileService,
  HouseholdProfileManagement,
  type PreparedProfileCreation,
  type PreparedProfileUpdate,
} from 'thesidedoor-core/access';
import { cookieValue } from 'thesidedoor-core/access/http';
import type { Prisma } from '@/generated/prisma/client';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { sharedAccess } from '@/lib/sidedoor/access/core/service';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import { avatarImagePath, isBundledAvatarImage, resolveProfileAvatar } from '@/lib/avatars';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

function profileManagement() {
  return new HouseholdProfileManagement(sharedAccess, {
    allowHouseholdManagement: true,
    devices: sottoDeviceService(sharedAccess),
    requiredDeviceScopes: ['app'],
    ownerDeviceScope: 'owner',
  });
}

export function prepareSottoProfile(name: string): PreparedProfileCreation {
  return profileManagement().prepareCreate(name);
}

type PreparedSottoProfileUpdate = PreparedProfileUpdate & { storageOperationId: string };

export function prepareSottoProfileUpdate(id: string, name?: string): PreparedSottoProfileUpdate {
  return { ...profileManagement().prepareUpdate(id, name), storageOperationId: randomUUID() };
}

export async function updateSottoProfile(
  database: Prisma.TransactionClient,
  request: Request,
  prepared: PreparedSottoProfileUpdate,
  avatarSlug: string | null | undefined
) {
  const identity = await resolveSottoRequest(database, request);
  if (!identity) throw new AccessError('unauthorized');
  const store = await sottoAccessStore(database);
  const state = await store.read();
  if (state.householdProfiles?.some((profile) => profile.id === prepared.id)) {
    const credential =
      identity.authentication === 'device'
        ? { kind: 'device' as const, token: request.headers.get('authorization')!.slice(7) }
        : { kind: 'session' as const, token: cookieValue(request, SHARED_SESSION_COOKIE)! };
    await store.transact((current) => prepared.apply(current, credential));
  } else if (identity.principalId !== prepared.id) throw new AccessError('forbidden');
  if (avatarSlug !== undefined) {
    const previous = await database.user.findUniqueOrThrow({
      where: { id: prepared.id },
      select: { image: true },
    });
    const nextImage = avatarSlug ? avatarImagePath(avatarSlug) : null;
    if (previous.image && previous.image !== nextImage && !isBundledAvatarImage(previous.image)) {
      await new StorageReferenceRegistry(
        {
          query: (sql, values) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        },
        'postgres',
        SIDEDOOR_STATE_ID
      ).retire({
        operationId: prepared.storageOperationId,
        consumer: `profile:${prepared.id}:avatar`,
        previousReference: previous.image,
      });
    }
  }
  const user = await database.user.update({
    where: { id: prepared.id },
    data: {
      ...(prepared.name !== undefined ? { name: prepared.name } : {}),
      ...(avatarSlug !== undefined
        ? { image: avatarSlug ? avatarImagePath(avatarSlug) : null }
        : {}),
    },
    select: { id: true, name: true, image: true, role: true },
  });
  const isOwner = user.role === 'ADMIN';
  return {
    id: user.id,
    name: user.name,
    avatarUrl: resolveProfileAvatar(user.id, user.image).image,
    isOwner,
    role: isOwner ? ('ADMIN' as const) : ('USER' as const),
  };
}

export async function createSottoProfile(
  database: Prisma.TransactionClient,
  request: Request,
  prepared: PreparedProfileCreation,
  avatarSlug: string | null | undefined
) {
  const identity = await resolveSottoRequest(database, request);
  if (!identity) throw new AccessError('unauthorized');
  const store = await sottoAccessStore(database);
  const credential =
    identity.authentication === 'device'
      ? { kind: 'device' as const, token: request.headers.get('authorization')!.slice(7) }
      : { kind: 'session' as const, token: cookieValue(request, SHARED_SESSION_COOKIE)! };
  const id = await store.transact((state) => prepared.apply(state, credential));
  const user = await database.user.update({
    where: { id },
    data: {
      name: prepared.name,
      image: avatarSlug ? avatarImagePath(avatarSlug) : null,
    },
    select: { id: true, name: true, image: true },
  });
  return {
    id: user.id,
    name: user.name,
    avatarUrl: resolveProfileAvatar(user.id, user.image).image,
    isOwner: false,
    role: 'USER' as const,
  };
}

/** Select household content and its appearance from one authorized transaction. */
export async function selectSottoProfile(
  database: Prisma.TransactionClient,
  request: Request,
  profileId: string | null
) {
  const headers = new Headers(request.headers);
  if (headers.has('authorization') && profileId !== null)
    headers.set('x-sotto-profile-id', profileId);
  const identity = await resolveSottoRequest(database, new Request(request.url, { headers }));
  if (!identity) throw new AccessError('unauthorized');
  if (identity.authentication === 'session') {
    const access = new AccessService({ store: await sottoAccessStore(database) });
    await new HouseholdProfileService(access).select(
      cookieValue(request, SHARED_SESSION_COOKIE)!,
      profileId
    );
  }
  if (profileId === null) return null;
  return database.user.findUniqueOrThrow({
    where: { id: profileId },
    select: {
      id: true,
      themeMode: true,
      themePalette: true,
      themeAccent: true,
      reducedMotion: true,
    },
  });
}
