import { JobOutbox } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const pointRead = 'SELECT "revision", "state" FROM "SidedoorState" WHERE "id" = $1';

/** Lock the SDK's exact outbox row before trusting its retained receipt. */
export function readLockedPracticeOutbox(database: Prisma.TransactionClient, id: string) {
  return new JobOutbox(
    {
      query: async (sql, values) => {
        if (sql !== pointRead || values.length !== 1 || typeof values[0] !== 'string')
          throw new Error('Practice receipt used an unsupported outbox query');
        return database.$queryRawUnsafe<Record<string, unknown>[]>(`${sql} FOR SHARE`, ...values);
      },
    },
    'postgres',
    SIDEDOOR_STATE_ID
  ).read(id);
}

export async function lockPracticeGrant(
  database: Prisma.TransactionClient,
  id: string,
  kind: 'writing' | 'speaking'
) {
  const grantId = `${SIDEDOOR_STATE_ID}:${kind}-grant:${id}`;
  const rows = await database.$queryRaw<{ id: string }[]>`
    SELECT id FROM "SidedoorState" WHERE id = ${grantId} FOR SHARE`;
  return rows.length === 1;
}
