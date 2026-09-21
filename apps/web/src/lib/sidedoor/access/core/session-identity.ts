import { AccessService, HouseholdProfileService } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';

export const SHARED_SESSION_COOKIE = 'sotto_session';

export type SottoSessionIdentity =
  | { kind: 'household'; sessionId: string; userId: null; principalId: null; isOwner: false }
  | {
      kind: 'content';
      sessionId: string;
      userId: string;
      principalId: string | null;
      isOwner: boolean;
    };

/** Admission, content selection and authority share one transaction snapshot. */
export async function resolveSottoSession(
  database: Prisma.TransactionClient,
  token: string
): Promise<SottoSessionIdentity> {
  const access = new AccessService({
    store: await sottoAccessStore(database),
  });
  const state = await access.store.read();
  const { session, principal } = access.sessionFromState(state, token);
  if (principal)
    return {
      kind: 'content',
      sessionId: session.id,
      userId: principal.id,
      principalId: principal.id,
      isOwner: principal.role === 'owner',
    };
  const profile = new HouseholdProfileService(access).selectedFromState(state, token);
  if (!profile)
    return {
      kind: 'household',
      sessionId: session.id,
      userId: null,
      principalId: null,
      isOwner: false,
    };
  return {
    kind: 'content',
    sessionId: session.id,
    userId: profile.id,
    principalId: null,
    isOwner: false,
  };
}
