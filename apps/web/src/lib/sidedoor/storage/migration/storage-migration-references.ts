import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import {
  StorageReferenceRegistry,
  StorageReferenceConsumerMismatchError,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { inspectStorageMigrationConsumer } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import { storageConsumerFields } from '@/lib/sidedoor/storage/core/storage-consumers';

// SQL identifiers come exclusively from this fixed application schema mapping.
const cursorSchema = z
  .object({
    model: z.string().min(1),
    id: z.string().min(1),
    field: z.string().min(1),
  })
  .strict();
export type StorageMigrationReferenceCursor = z.infer<typeof cursorSchema>;
const rowSchema = cursorSchema.extend({ reference: z.string(), consumer: z.string() });
const union = storageConsumerFields
  .map(
    ([model, field, kind, slot]) =>
      `SELECT '${model}'::text AS model, id, '${field}'::text AS field, "${field}" AS reference,
    '${kind}:' || id || ':${slot}' AS consumer FROM "${model}" WHERE "${field}" IS NOT NULL`
  )
  .join(' UNION ALL ');

/**
 * Discover application references even when no canonical asset exists.
 * Missing attribution is explicit, including external URLs. Inventory never
 * guesses a backend from today's configuration or treats a URL as proof of ownership.
 */
export async function readStorageMigrationReferencePage(options: {
  database: Prisma.TransactionClient;
  request: Request;
  admission: AuthenticatedRequest;
  after?: StorageMigrationReferenceCursor | null;
}) {
  const { database, request, admission } = options;
  const after = options.after ? cursorSchema.parse(options.after) : null;
  request.signal.throwIfAborted();
  if (!admission.isOwner) throw new AccessError('forbidden');
  await requireOriginalSottoAdmission(database, request, admission);
  const rows = z.array(rowSchema).parse(
    await database.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM (${union}) AS refs
     WHERE ($1::text IS NULL OR (model COLLATE "C", id COLLATE "C", field COLLATE "C") >
       ($1::text COLLATE "C", $2::text COLLATE "C", $3::text COLLATE "C"))
     ORDER BY model COLLATE "C", id COLLATE "C", field COLLATE "C" LIMIT 100`,
      after?.model ?? null,
      after?.id ?? null,
      after?.field ?? null
    )
  );
  const registry = new StorageReferenceRegistry(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const references = [];
  for (const row of rows) {
    request.signal.throwIfAborted();
    // Empty strings are present application values, never successful migrations.
    try {
      const resolved = row.reference
        ? await registry.resolve({ consumer: row.consumer, reference: row.reference })
        : null;
      const issue = resolved
        ? (await inspectStorageMigrationConsumer(database, row.consumer, resolved.prepared)).reason
        : null;
      references.push({
        ...row,
        assetId: resolved?.assetId ?? null,
        issue,
        attribution: resolved ? ('registered' as const) : ('unregistered' as const),
      });
    } catch (error) {
      if (!(error instanceof StorageReferenceConsumerMismatchError)) throw error;
      references.push({
        ...row,
        assetId: null,
        issue: null,
        attribution: 'mismatched-consumer' as const,
      });
    }
  }
  request.signal.throwIfAborted();
  const last = rows.at(-1);
  return {
    references,
    cursor:
      rows.length === 100 && last ? { model: last.model, id: last.id, field: last.field } : null,
  };
}
