import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { SIDEDOOR_STATE_ID } from './store';
import { sottoTransaction } from './transaction';
import { openSottoStorageConnection } from '../../storage/core/storage-connection';

const bindingSchema = z.object({
  database: z.string().min(1),
  schema: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  relation: z.string().regex(/^\d+$/),
  address: z.string().nullable(),
  port: z.number().int().nullable(),
});

const BINDING_SQL = `
  SELECT current_database() AS database, namespace.nspname AS schema,
         relation.oid::text AS relation, inet_server_addr()::text AS address,
         inet_server_port() AS port
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE relation.oid = to_regclass('"SidedoorState"')
`;

function parseBinding(rows: readonly Record<string, unknown>[]) {
  if (rows.length !== 1) throw new Error('Storage state relation could not be identified');
  return bindingSchema.parse(rows[0]);
}

/** Serialize shared Sidedoor-state writes before they take a Serializable snapshot. */
export async function sottoStateWriteTransaction<Result>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  callerSignal: AbortSignal
): Promise<Result> {
  callerSignal.throwIfAborted();
  const binding = parseBinding(
    await database.$queryRawUnsafe<Record<string, unknown>[]>(BINDING_SQL)
  );
  callerSignal.throwIfAborted();
  const connection = await openSottoStorageConnection(undefined, binding.schema);
  const lost = new AbortController();
  const unsubscribe = connection.onLoss((error) => lost.abort(error));
  const signal = AbortSignal.any([callerSignal, lost.signal]);
  let failed = false;
  let primary: unknown;
  try {
    signal.throwIfAborted();
    if (!isDeepStrictEqual(binding, parseBinding(await connection.query(BINDING_SQL, []))))
      throw new Error('Storage admission connection targets a different state relation');
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          'sotto-storage-write-admission-v1',
          binding.database,
          binding.schema,
          binding.relation,
          SIDEDOOR_STATE_ID,
        ])
      )
      .digest()
      .readBigInt64BE()
      .toString();
    const acquisitionSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    for (;;) {
      acquisitionSignal.throwIfAborted();
      const rows = await connection.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [
        key,
      ]);
      acquisitionSignal.throwIfAborted();
      if (rows.length !== 1 || typeof rows[0]?.acquired !== 'boolean')
        throw new Error('Storage admission lock returned an invalid result');
      if (rows[0].acquired) break;
      await delay(25, undefined, { signal: acquisitionSignal });
    }
    return await sottoTransaction(
      database,
      async (transaction) => {
        signal.throwIfAborted();
        const current = parseBinding(
          await transaction.$queryRawUnsafe<Record<string, unknown>[]>(BINDING_SQL)
        );
        if (!isDeepStrictEqual(binding, current))
          throw new Error('Storage state relation changed during admission');
        signal.throwIfAborted();
        const result = await operation(transaction);
        signal.throwIfAborted();
        return result;
      },
      { signal }
    );
  } catch (error) {
    failed = true;
    primary = error;
    throw error;
  } finally {
    try {
      await connection.close();
    } catch (error) {
      if (failed)
        throw new AggregateError(
          [primary, error],
          'Storage admission and connection cleanup failed'
        );
      throw error;
    } finally {
      unsubscribe();
    }
  }
}
