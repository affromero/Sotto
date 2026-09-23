import { AccessError, accessStateSchema, type AccessState } from 'thesidedoor-core/access';
import type { StateStore } from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { INSTALLED_PROFILE_INITIALIZATION } from '@/lib/sidedoor/access/state/state';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { revokeSottoCredentialSharing } from '@/lib/sidedoor/credentials/config/credential-sharing';

/** Runtime operations open fresh transactions against canonical shared state. */
export class SottoAccessStore implements StateStore<AccessState> {
  constructor(private readonly database: PrismaClient) {}

  read(): Promise<AccessState> {
    return sottoTransaction(this.database, async (database) =>
      (await sottoAccessStore(database)).read()
    );
  }

  transact<Result>(operation: (state: AccessState) => Result): Promise<Result> {
    return sottoTransaction(this.database, async (database) =>
      (await sottoAccessStore(database)).transact(operation)
    );
  }
}

/**
 * The caller commits application changes and authority in one Serializable transaction.
 * A rejected mutation must abort that transaction, including earlier application writes.
 */
export async function sottoAccessStore(
  database: Prisma.TransactionClient
): Promise<StateStore<AccessState>> {
  const isolation = await database.$queryRawUnsafe<{ isolation: string }[]>(
    "SELECT current_setting('transaction_isolation') AS isolation"
  );
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Shared access requires a Serializable transaction');
  const store = sidedoorStateStore(database);
  async function load() {
    const state = await store.read();
    const users = await database.user.findMany({ select: { id: true } });
    const ids = new Set(users.map((user) => user.id));
    if (
      state.access.principals.some((principal) => !ids.has(principal.id)) ||
      state.access.householdProfiles?.some((profile) => !ids.has(profile.id))
    )
      throw new AccessError(
        'conflict',
        'A shared profile is missing its learner record. Run local access repair.'
      );
    return state;
  }
  return {
    read: async () => structuredClone((await load()).access),
    transact: async (operation) => {
      const envelope = await load();
      const previous = new Set(envelope.access.principals.map((principal) => principal.id));
      const previousHousehold = new Set(
        envelope.access.householdProfiles?.map((profile) => profile.id)
      );
      const result = operation(envelope.access);
      if (result instanceof Promise) throw new Error('Access mutations must be synchronous');
      const detached = structuredClone(result);
      const added = envelope.access.principals.filter((principal) => !previous.has(principal.id));
      const rebound = new Set<string>();
      if (
        envelope.access.initializations.includes(INSTALLED_PROFILE_INITIALIZATION) &&
        ![...previous].some((id) =>
          envelope.access.principals.some(
            (principal) => principal.id === id && principal.role === 'owner'
          )
        ) &&
        added.length === 1 &&
        added[0]?.role === 'owner'
      ) {
        const installedOwner = await database.user.findFirst({
          where: { role: 'ADMIN' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, createdAt: true },
        });
        if (installedOwner) {
          const generatedId = added[0].id;
          if (
            envelope.access.principals.some(
              (principal) => principal.id === installedOwner.id && principal !== added[0]
            )
          )
            throw new AccessError('conflict', 'The installed owner is already bound');
          added[0].id = installedOwner.id;
          added[0].createdAt = installedOwner.createdAt.getTime();
          for (const session of envelope.access.sessions)
            if (session.principalId === generatedId) session.principalId = installedOwner.id;
          for (const passkey of envelope.access.passkeys)
            if (passkey.principalId === generatedId) passkey.principalId = installedOwner.id;
          for (const challenge of envelope.access.challenges)
            if (challenge.principalId === generatedId) challenge.principalId = installedOwner.id;
          for (const token of envelope.access.tokens)
            if (token.principalId === generatedId) token.principalId = installedOwner.id;
          for (const device of envelope.access.deviceTokens)
            if (device.principalId === generatedId) device.principalId = installedOwner.id;
          for (const invitation of envelope.access.invitations)
            if (invitation.issuerPrincipalId === generatedId)
              invitation.issuerPrincipalId = installedOwner.id;
          for (const recovery of envelope.access.recoveryCodes)
            if (recovery.principalId === generatedId) recovery.principalId = installedOwner.id;
          const ownerProfile = envelope.access.householdProfiles?.find(
            (profile) => profile.id === installedOwner.id
          );
          if (ownerProfile) ownerProfile.ownerPrincipalId = installedOwner.id;
          rebound.add(installedOwner.id);
        }
      }
      envelope.access = accessStateSchema.parse(envelope.access);
      if (
        [...previous].some(
          (id) => !envelope.access.principals.some((principal) => principal.id === id)
        )
      )
        throw new AccessError(
          'conflict',
          'Remove learner data through the explicit profile deletion workflow'
        );
      for (const principal of envelope.access.principals) {
        if (principal.role === 'owner' && envelope.access.mode === 'household') {
          const profile = envelope.access.householdProfiles?.find(
            (entry) => entry.id === principal.id
          );
          if (profile) profile.ownerPrincipalId = principal.id;
          else {
            envelope.access.householdProfiles ??= [];
            envelope.access.householdProfiles.push({
              id: principal.id,
              name: principal.name,
              epoch: principal.epoch,
              ownerPrincipalId: principal.id,
            });
          }
        }
        if (!previous.has(principal.id) && rebound.has(principal.id)) {
          await database.user.update({
            where: { id: principal.id },
            data: { name: principal.name, role: 'ADMIN' },
            select: { id: true },
          });
        } else if (!previous.has(principal.id)) {
          await database.user.create({
            select: { id: true },
            data: {
              id: principal.id,
              name: principal.name,
              email: `sidedoor+${principal.id}@localhost.invalid`,
              role: principal.role === 'owner' ? 'ADMIN' : 'USER',
              createdAt: new Date(principal.createdAt),
            },
          });
        }
      }
      const privateIds = new Set(
        envelope.access.principals
          .filter(
            (principal) =>
              principal.passwordHash !== null ||
              envelope.access.passkeys.some((key) => key.principalId === principal.id)
          )
          .map((principal) => principal.id)
      );
      if (envelope.access.mode === 'individual') {
        await revokeSottoCredentialSharing(
          database,
          [...privateIds].filter((id) => previousHousehold.has(id) && !rebound.has(id))
        );
        envelope.access.householdProfiles = envelope.access.householdProfiles?.filter(
          (profile) => !privateIds.has(profile.id)
        );
      }
      envelope.access.deviceTokens = envelope.access.deviceTokens.filter(
        (device) =>
          !device.defaultProfileId ||
          envelope.access.householdProfiles?.some(
            (profile) => profile.id === device.defaultProfileId
          )
      );
      const revision = envelope.revision;
      envelope.revision++;
      await store.transact((current) => {
        if (current.revision !== revision) throw new AccessError('conflict');
        Object.assign(current, envelope);
      });
      return detached;
    },
  };
}
