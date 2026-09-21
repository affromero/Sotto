import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PrismaClient } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { captureConfiguredStorageBackend, type CapturedStorageBackend } from '@/lib/r2';
import { setSiteConfig, type ServerInfraConfig } from '@/lib/site-config';
import type { ObjectStorageCredential } from '@/lib/storage/sidedoor/configuration';
import { setSottoInstanceStorageCredential } from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { planSottoStorageMigration } from '@/lib/sidedoor/storage/migration/storage-migration-dry-run';
import {
  admitSottoStorageCopy,
  executeSottoStorageCopy,
} from '@/lib/sidedoor/storage/migration/storage-migration-copy';
import { readStorageMigrationAssetPage } from '@/lib/sidedoor/storage/migration/storage-migration-plan';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export interface SottoStorageMigrationResult {
  sourceProvider: string;
  targetProvider: string;
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  switched: boolean;
  errors: Array<{ id: string; field: string; error: string }>;
  inventoryIssueCount: number;
  inventoryIssues: Array<{ assetId: string; consumer: string; reason: string }>;
  hasBlockers: boolean;
}

async function persistTargetCredential(options: {
  database: PrismaClient;
  request: Request;
  admission: AuthenticatedRequest;
  target: ServerInfraConfig;
  credential?: ObjectStorageCredential;
}) {
  const provider = options.target.storageProvider;
  if (provider === 'local') return;
  if (provider !== 'r2' && provider !== 's3') throw new Error('Select local, r2, or s3 storage');
  if (!options.credential) return;
  const endpoint = options.target.objectStorageEndpoint?.trim();
  if (!endpoint) throw new Error(`Enter the ${provider} endpoint`);
  await sottoTransaction(
    options.database,
    async (database) => {
      await requireOriginalSottoAdmission(database, options.request, options.admission);
      await setSottoInstanceStorageCredential(
        database,
        provider,
        {
          accessKeyId: options.credential!.accessKeyId,
          secretAccessKey: options.credential!.secretAccessKey,
        },
        endpoint
      );
    },
    { signal: options.request.signal }
  );
}

async function copyAssets(options: {
  database: PrismaClient;
  request: Request;
  admission: AuthenticatedRequest;
  target: CapturedStorageBackend;
}) {
  let cursor: string | null = null;
  let migrated = 0;
  let skipped = 0;
  do {
    const page = await sottoTransaction(
      options.database,
      (database) =>
        readStorageMigrationAssetPage({
          database,
          request: options.request,
          admission: options.admission,
          after: cursor,
        }),
      { signal: options.request.signal }
    );
    for (const entry of page.entries) {
      options.request.signal.throwIfAborted();
      if (isDeepStrictEqual(entry.source.backend.descriptor, options.target.descriptor)) {
        skipped++;
        continue;
      }
      const operationId = randomUUID();
      const admitted = await sottoTransaction(
        options.database,
        (database) =>
          admitSottoStorageCopy(database, {
            request: options.request,
            admission: options.admission,
            operationId,
            entry,
            target: options.target.descriptor,
            timeoutMs: 5 * 60_000,
          }),
        { signal: options.request.signal }
      );
      await executeSottoStorageCopy({
        database: options.database,
        request: options.request,
        admission: options.admission,
        operationId,
        fingerprint: admitted.fingerprint,
        target: options.target,
      });
      migrated++;
    }
    cursor = page.cursor;
  } while (cursor !== null);
  return { migrated, skipped };
}

/** Copy every canonical asset, prove readback, then activate the captured destination. */
export async function migrateSottoStorage(options: {
  database: PrismaClient;
  request: Request;
  admission: AuthenticatedRequest;
  current: ServerInfraConfig;
  target: ServerInfraConfig;
  credential?: ObjectStorageCredential;
  dryRun?: boolean;
}): Promise<SottoStorageMigrationResult> {
  const initial = await planSottoStorageMigration({
    database: options.database,
    request: options.request,
    admission: options.admission,
    configuration: options.current,
    target: options.target,
  });
  if (options.dryRun || initial.hasBlockers) return initial;
  await persistTargetCredential(options);
  const target = await captureConfiguredStorageBackend(options.target);
  const copied = await copyAssets({ ...options, target });
  const verified = await planSottoStorageMigration({
    database: options.database,
    request: options.request,
    admission: options.admission,
    configuration: options.current,
    target: options.target,
  });
  if (verified.hasBlockers) return { ...verified, ...copied, switched: false };
  await sottoTransaction(
    options.database,
    async (database) => {
      await requireOriginalSottoAdmission(database, options.request, options.admission);
      await setSiteConfig(options.target, options.admission.userId, database);
    },
    { signal: options.request.signal }
  );
  return { ...verified, ...copied, switched: true };
}
