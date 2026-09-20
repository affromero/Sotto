import { S3Client } from '@aws-sdk/client-s3';
import * as path from 'node:path';
import { storageBackendBinding, type StorageCleanupDescriptor } from 'thesidedoor-core/storage';
import { prismaUnfiltered } from '@/lib/prisma';
import { infra } from '@/lib/server-config';
import type { ServerInfraConfig } from '@/lib/site-config';
import {
  resolveSottoInstanceStorageCredential,
  resolveSottoInstanceStorageCredentialRevision,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

type StorageProviderId = 'local' | 'r2' | 's3';

function storageSetting(key: keyof ServerInfraConfig, snapshot?: ServerInfraConfig) {
  const value = snapshot ? snapshot[key] : infra(key);
  return value?.trim() || undefined;
}

export function configuredLocalStorageRoot(snapshot?: ServerInfraConfig): string {
  const configured = storageSetting('localStorageRoot', snapshot) ?? '.sotto/storage';
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

export interface ObjectStorageConfig {
  provider: Exclude<StorageProviderId, 'local'>;
  client: S3Client;
  bucket: string;
  endpoint: string;
  publicUrl: string | null;
  access: {
    provider: 'r2' | 's3';
    credentialRevision: string;
    signingRegion: string;
  } | null;
}

export interface ObjectStorageCredential {
  accessKeyId: string;
  secretAccessKey: string;
}

export function configuredStorageProvider(snapshot?: ServerInfraConfig): StorageProviderId {
  const explicit = storageSetting('storageProvider', snapshot);
  if (explicit === 'local' || explicit === 'r2' || explicit === 's3') return explicit;
  if (explicit)
    throw new Error(`Unknown storage provider "${explicit}". Expected one of: local, r2, s3.`);
  throw new Error('Select a storage provider in shared Sidedoor configuration');
}

function objectLocation(provider: 's3' | 'r2', snapshot?: ServerInfraConfig) {
  const endpoint = storageSetting('objectStorageEndpoint', snapshot);
  const bucket = storageSetting('objectStorageBucket', snapshot);
  const region = storageSetting('objectStorageRegion', snapshot);
  if (!endpoint || !bucket || !region)
    throw new Error(`The selected ${provider} storage location is incomplete`);
  return {
    region,
    bucket,
    endpoint: new URL(endpoint).href.replace(/\/+$/, ''),
    publicUrl: storageSetting('objectStoragePublicUrl', snapshot) ?? null,
  };
}

/** Capture location only. Credential selection happens separately inside the async boundary. */
export function planStorageDestination(snapshot: ServerInfraConfig) {
  const provider = configuredStorageProvider(snapshot);
  if (provider === 'local') {
    const root = configuredLocalStorageRoot(snapshot);
    return {
      provider,
      kind: 'local' as const,
      root,
      binding: storageBackendBinding({ kind: 'local', root }),
    };
  }
  const configured = objectLocation(provider, snapshot);
  const location = {
    kind: 'object' as const,
    endpoint: configured.endpoint,
    bucket: configured.bucket,
  };
  return {
    provider,
    kind: 'object' as const,
    location,
    binding: storageBackendBinding(location),
    publicUrl: configured.publicUrl,
  };
}

export function historicalObjectStorageSnapshot(
  saved: Extract<StorageCleanupDescriptor, { kind: 'object' }>,
  snapshot: ServerInfraConfig
): ServerInfraConfig {
  if (!saved.access)
    throw new Error('Object storage attribution does not contain a captured credential revision');
  return {
    ...snapshot,
    storageProvider: saved.access.provider,
    objectStorageEndpoint: saved.location.endpoint,
    objectStorageBucket: saved.location.bucket,
    objectStorageRegion: saved.access.signingRegion,
    objectStoragePublicUrl: saved.publicUrl,
  };
}

/** Resolve one exact instance credential revision and construct its object client. */
export async function getObjectStorageConfig(
  snapshot?: ServerInfraConfig,
  suppliedCredential?: ObjectStorageCredential,
  captured?: NonNullable<Extract<StorageCleanupDescriptor, { kind: 'object' }>['access']>
): Promise<ObjectStorageConfig> {
  const provider = captured?.provider ?? configuredStorageProvider(snapshot);
  if (provider !== 'r2' && provider !== 's3')
    throw new Error('Unsupported captured storage provider');
  const location = captured
    ? {
        endpoint: snapshot?.objectStorageEndpoint?.trim() ?? '',
        bucket: snapshot?.objectStorageBucket?.trim() ?? '',
        region: captured.signingRegion,
        publicUrl: snapshot?.objectStoragePublicUrl?.trim() || null,
      }
    : objectLocation(provider, snapshot);
  const saved = suppliedCredential
    ? null
    : await sottoTransaction(prismaUnfiltered, (database) =>
        captured
          ? resolveSottoInstanceStorageCredentialRevision(
              database,
              provider,
              captured.credentialRevision
            )
          : resolveSottoInstanceStorageCredential(database, provider)
      );
  const accessKeyId = suppliedCredential?.accessKeyId ?? saved?.values.accessKeyId;
  const secretAccessKey = suppliedCredential?.secretAccessKey ?? saved?.values.secretAccessKey;
  if (
    typeof accessKeyId !== 'string' ||
    !accessKeyId.trim() ||
    typeof secretAccessKey !== 'string' ||
    !secretAccessKey.trim()
  )
    throw new Error(`The ${provider} storage credential is incomplete`);
  return {
    provider,
    client: new S3Client({
      region: location.region,
      endpoint: location.endpoint,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket: location.bucket,
    endpoint: location.endpoint,
    publicUrl: location.publicUrl,
    access: saved
      ? {
          provider,
          credentialRevision: saved.credentialRevision,
          signingRegion: location.region,
        }
      : null,
  };
}
