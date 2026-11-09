import { JobExecutionJournal } from 'thesidedoor-core/runtime/outbox';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const gateSchema = z
  .object({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), settled: z.boolean() })
  .strict();
const bindingSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  executorId: z.uuid(),
});
const pointRead = 'SELECT "revision", "state" FROM "SidedoorState" WHERE "id" = $1';

/** A missing journal is not proof that a paid execution drained. */
export async function hasSettledSottoExecution(
  database: Prisma.TransactionClient,
  identity: { id: string; fingerprint: string }
) {
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Execution verification requires a Serializable transaction');
  const observed: unknown[] = [];
  let gateKey = '';
  const journal = new JobExecutionJournal(
    {
      query: async (sql, values) => {
        if (sql !== pointRead || values.length !== 1 || typeof values[0] !== 'string')
          throw new Error('Execution verification used an unsupported journal query');
        if (observed.length === 0) gateKey = values[0];
        const rows = await database.$queryRawUnsafe<{ revision: string; state: unknown }[]>(
          `${sql} FOR SHARE`,
          ...values
        );
        observed.push(rows[0]?.state);
        return rows;
      },
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const blocker = await journal.blockingStatus(identity.id, identity.fingerprint);
  const gate = gateSchema.safeParse(observed[0]);
  if (!gate.success || !gate.data.settled || blocker !== null) return false;
  // The installed journal exposes no settled-gate reader. Derive its matching
  // execution key from the observed gate key and validate through journal.read.
  // An unsupported SDK key format fails closed.
  const key = /^sd-jeg:1:([a-f0-9]{64}):[0-9a-f-]{36}$/.exec(gateKey);
  if (!key) throw new Error('Execution verification used an unsupported journal key');
  const executionKey = `sd-je:1:${key[1]}:${gate.data.id}`;
  const rows = await database.$queryRaw<{ state: unknown }[]>`
    SELECT state FROM "SidedoorState" WHERE id = ${executionKey} FOR SHARE`;
  if (rows.length !== 1) return false;
  const binding = bindingSchema.safeParse(rows[0]?.state);
  if (
    !binding.success ||
    binding.data.id !== gate.data.id ||
    binding.data.parentId !== identity.id ||
    binding.data.fingerprint !== identity.fingerprint
  )
    return false;
  const execution = await journal.read(binding.data);
  return execution.status === 'settled' && execution.workspace === undefined;
}
