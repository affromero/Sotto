import { AccessError, AccessService, type AccessState } from 'thesidedoor-core/access';
import { cookieValue } from 'thesidedoor-core/access/http';
import type { Prisma, PlayJoinRequest } from '@/generated/prisma/client';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import type { PlayActor } from '../storage/rooms';

export interface PlayBrowserContext {
  request: Request;
  expectedProfileId: string | null;
}

/** A profile assertion is a precondition, never a source of authority. */
export async function requirePlayBrowserContext(
  database: Prisma.TransactionClient,
  context: PlayBrowserContext | undefined
) {
  if (!context || context.request.headers.has('authorization')) throw new AccessError('invalid');
  const current = await resolveSottoRequest(database, context.request);
  const profileId = current?.kind === 'content' ? current.userId : null;
  if (profileId !== context.expectedProfileId)
    throw new AccessError('conflict', 'Your active profile changed. Check it before joining.');
}

/** Owner authority can differ from the household's selected content profile. */
export async function playSponsoringOwner(database: Prisma.TransactionClient, actor: PlayActor) {
  const access = new AccessService({ store: await sottoAccessStore(database) });
  if (actor.identity.authentication === 'session') {
    const authenticated = await access.authenticate(
      cookieValue(actor.request, SHARED_SESSION_COOKIE)!,
      true
    );
    if (authenticated.principal?.role !== 'owner') throw new AccessError('forbidden');
    return authenticated.principal.id;
  }
  const device = await sottoDeviceService(access).authenticate(
    actor.request.headers.get('authorization')!.slice(7),
    ['app', 'owner']
  );
  if (device.principal?.role !== 'owner') throw new AccessError('forbidden');
  return device.principal.id;
}

/** Existing approval never turns a promoted or pending-owner learner into a guest credential. */
export function requireOrdinaryPlayEnrollment(state: AccessState, request: PlayJoinRequest) {
  if (
    request.candidateKind !== 'NEW' ||
    !request.provisionedUserId ||
    request.plannedProfileId !== request.provisionedUserId ||
    !request.approvedByUserId ||
    !request.approvedAt
  )
    throw new AccessError('forbidden');
  const member = state.principals.find((principal) => principal.id === request.provisionedUserId);
  const owner = state.principals.find((principal) => principal.id === request.approvedByUserId);
  if (
    member?.role !== 'member' ||
    member.pendingRole ||
    owner?.role !== 'owner' ||
    owner.pendingRole
  )
    throw new AccessError('forbidden');
  return member;
}
