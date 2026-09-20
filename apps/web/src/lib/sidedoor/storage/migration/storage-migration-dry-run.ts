import type { PrismaClient } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import type { ServerInfraConfig } from '@/lib/site-config';
import {
  configuredStorageProvider,
  planStorageDestination,
} from '@/lib/storage/sidedoor/configuration';
import {
  readStorageMigrationAssetPage,
  type StorageMigrationIssue,
} from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import {
  readStorageMigrationReferencePage,
  type StorageMigrationReferenceCursor,
} from '@/lib/sidedoor/storage/migration/storage-migration-references';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';

/**
 * Observational dry run. Memory is bounded to one page and ten diagnostics.
 * migrated counts individually eligible reference candidates; hasBlockers covers the whole plan.
 * Actual publication must recapture authority and atomically validate every consumer of an asset.
 */
export async function planSottoStorageMigration(options: {
  database: PrismaClient;
  request: Request;
  admission: AuthenticatedRequest;
  configuration: ServerInfraConfig;
  target: ServerInfraConfig;
}) {
  const { database, request, admission } = options;
  const configuration = { ...options.configuration };
  const selection = { ...options.target };
  const sourceProvider = configuredStorageProvider(configuration);
  const target = planStorageDestination(selection);
  let inventoryIssueCount = 0;
  const inventoryIssues: StorageMigrationIssue[] = [];
  let assetCursor: string | null = null;
  do {
    const page = await sottoTransaction(
      database,
      (tx) =>
        readStorageMigrationAssetPage({
          database: tx,
          request,
          admission,
          after: assetCursor,
        }),
      { signal: request.signal }
    );
    for (const issue of page.issues) {
      inventoryIssueCount++;
      if (inventoryIssues.length < 10) inventoryIssues.push(issue);
    }
    assetCursor = page.cursor;
  } while (assetCursor !== null);

  const result = {
    sourceProvider,
    targetProvider: configuredStorageProvider(selection),
    scanned: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    switched: false,
    errors: [] as Array<{ id: string; field: string; error: string }>,
    target,
    inventoryIssueCount,
    inventoryIssues,
    hasBlockers: true,
  };
  let referenceCursor: StorageMigrationReferenceCursor | null = null;
  do {
    const page = await sottoTransaction(
      database,
      (tx) =>
        readStorageMigrationReferencePage({
          database: tx,
          request,
          admission,
          after: referenceCursor,
        }),
      { signal: request.signal }
    );
    for (const reference of page.references) {
      result.scanned++;
      if (reference.assetId && !reference.issue) {
        result.migrated++;
        continue;
      }
      result.failed++;
      if (result.errors.length < 10)
        result.errors.push({
          id: reference.id,
          field: `${reference.model}.${reference.field}`,
          error: reference.issue ?? reference.attribution,
        });
    }
    referenceCursor = page.cursor;
  } while (referenceCursor !== null);
  await sottoTransaction(database, (tx) => requireOriginalSottoAdmission(tx, request, admission), {
    signal: request.signal,
  });
  request.signal.throwIfAborted();
  result.hasBlockers = result.failed !== 0 || result.inventoryIssueCount !== 0;
  return result;
}
