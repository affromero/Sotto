import { AccessError, accessStateSchema, type AccessState } from 'thesidedoor-core/access';
import type { StateStore } from 'thesidedoor-core/storage';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
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
        if (!previous.has(principal.id))
          await database.user.create({
            select: { id: true },
            data: {
              id: principal.id,
              name: principal.name,
              email: `sidedoor+${principal.id}@localhost.invalid`,
              role: 'USER',
              createdAt: new Date(principal.createdAt),
            },
          });
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
      await revokeSottoCredentialSharing(
        database,
        [...privateIds].filter((id) => previousHousehold.has(id))
      );
      envelope.access.householdProfiles = envelope.access.householdProfiles?.filter(
        (profile) => !privateIds.has(profile.id)
      );
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
