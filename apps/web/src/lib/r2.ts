import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { constants } from 'fs';
import { access, mkdir, open, readdir, stat, unlink, writeFile } from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  LocalStorageCleanup,
  copyOwnedReadableToFile,
  StorageReadCleanupError,
  ObjectStorageCleanup,
  validateStorageKey,
  storageBackendBinding,
  storageCleanupDescriptorSchema,
  StorageReferenceRegistry,
  type StorageCleanupDescriptor,
  type StorageCopyContent,
} from 'thesidedoor-core/storage';
import { logger } from './logger';
import { prismaUnfiltered } from './prisma';
import { infra } from './server-config';
import { getSiteConfig, type ServerInfraConfig } from './site-config';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import {
  configuredStorageProvider,
  configuredLocalStorageRoot,
  getObjectStorageConfig,
  historicalObjectStorageSnapshot,
  type ObjectStorageCredential,
  type ObjectStorageConfig,
} from '@/lib/storage/sidedoor/configuration';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

function localBaseDir(): string {
  return configuredLocalStorageRoot();
}

export type { StorageCleanupDescriptor } from 'thesidedoor-core/storage';

export interface CapturedStorageCleanup {
  descriptor: Readonly<StorageCleanupDescriptor>;
  normalize(reference: string): string;
  /** Finish and persist the complete manifest before deleting. Workers must serialize by backend. */
  list(prefix: string, signal?: AbortSignal): AsyncGenerator<string>;
  has(key: string, signal?: AbortSignal): Promise<boolean>;
  delete(key: string, options?: { force?: boolean; signal?: AbortSignal }): Promise<void>;
}

export interface CapturedStorageBackend extends CapturedStorageCleanup {
  /** Reads use this descriptor, never the current mutable storage configuration. */
  downloadToFile(
    reference: string,
    destination: string,
    signal?: AbortSignal
  ): Promise<StorageCopyContent>;
  /** Storage orchestration only: caller persists every erasure scope before I/O; cleanup drains them. */
  writeBuffer(
    key: string,
    body: Uint8Array,
    contentType: string,
    signal?: AbortSignal
  ): Promise<string>;
  /** Owns the source, including preflight failure. Remote errors remain uncertain until reconciled. */
  writeStream(
    key: string,
    body: Readable,
    contentType: string,
    signal?: AbortSignal
  ): Promise<string>;
}

export type RestoredStorageBackend = CapturedStorageCleanup &
  Pick<CapturedStorageBackend, 'downloadToFile'>;

/** Restore a registry-validated historical location without granting new writes. */
export async function restoreStorageBackend(
  descriptor: StorageCleanupDescriptor
): Promise<RestoredStorageBackend> {
  const saved = storageCleanupDescriptorSchema.parse(descriptor);
  const backend =
    saved.kind === 'local'
      ? await capturedLocalBackend(
          await LocalStorageCleanup.restore(saved.identity),
          saved.referenceRoot,
          LOCAL_STORAGE_URL_PREFIX,
          assertCleanupKey
        )
      : await captureConfiguredStorageBackend(
          historicalObjectStorageSnapshot(saved, await getSiteConfig()),
          saved
        );
  return {
    descriptor: backend.descriptor,
    normalize: backend.normalize,
    downloadToFile: backend.downloadToFile,
    list: backend.list,
    has: backend.has,
    delete: backend.delete,
  };
}

async function withOwnedStorageStream(
  body: Readable,
  write: () => Promise<string>
): Promise<string> {
  try {
    return await write();
  } finally {
    body.destroy();
  }
}

/** Restore a retained descriptor, or capture the current backend for a new cleanup. */
export async function captureStorageCleanup(
  expected?: StorageCleanupDescriptor
): Promise<CapturedStorageCleanup> {
  const backend = expected ? await restoreStorageBackend(expected) : await captureStorageBackend();
  return {
    descriptor: backend.descriptor,
    normalize: backend.normalize,
    list: backend.list,
    has: backend.has,
    delete: backend.delete,
  };
}

/** Captures one configuration snapshot for writes and their eventual cleanup. */
export async function captureStorageBackend(
  expected?: StorageCleanupDescriptor
): Promise<CapturedStorageBackend> {
  const saved = expected ? storageCleanupDescriptorSchema.parse(expected) : undefined;
  const snapshot = await getSiteConfig();
  return captureConfiguredStorageBackend(snapshot, saved);
}

/** Capture an explicit destination without activating it in site configuration. */
export async function captureConfiguredStorageBackend(
  snapshot: ServerInfraConfig,
  saved?: StorageCleanupDescriptor,
  suppliedCredential?: ObjectStorageCredential
): Promise<CapturedStorageBackend> {
  if (configuredStorageProvider(snapshot) === 'local') {
    const configuredRoot = path.resolve(
      /* turbopackIgnore: true */ configuredLocalStorageRoot(snapshot)
    );
    let cleanup = await LocalStorageCleanup.capture(configuredRoot);
    if (saved) {
      if (saved.kind !== 'local' || saved.identity.binding !== cleanup.identity.binding)
        throw new Error('Storage backend changed since cleanup was scheduled');
      cleanup = await LocalStorageCleanup.restore(saved.identity);
    }
    const referenceRoot = saved?.kind === 'local' ? saved.referenceRoot : configuredRoot;
    return capturedLocalBackend(cleanup, referenceRoot, LOCAL_STORAGE_URL_PREFIX, assertCleanupKey);
  }
  if (saved?.kind === 'object' && !saved.access)
    throw new Error('Object storage attribution does not contain a captured credential revision');
  const config = await getObjectStorageConfig(
    snapshot,
    suppliedCredential,
    saved?.kind === 'object' ? (saved.access ?? undefined) : undefined
  );
  const location = Object.freeze({
    kind: 'object' as const,
    endpoint: config.endpoint,
    bucket: config.bucket,
  });
  const binding = storageBackendBinding(location);
  if (
    saved &&
    (saved.kind !== 'object' ||
      saved.binding !== binding ||
      storageBackendBinding(saved.location) !== binding)
  )
    throw new Error('Storage backend changed since cleanup was scheduled');
  const publicUrl = saved?.kind === 'object' ? saved.publicUrl : config.publicUrl;
  const referenceEncoding = saved?.kind === 'object' ? saved.referenceEncoding : 'raw';
  const cleanup = new ObjectStorageCleanup({
    location,
    publicUrl,
    publicUrlEncoding: referenceEncoding,
    multipart: {
      listMultipart: async (prefix, keyMarker, uploadIdMarker, limit, signal) => {
        const page = await config.client.send(
          new ListMultipartUploadsCommand({
            Bucket: config.bucket,
            Prefix: prefix,
            KeyMarker: keyMarker,
            UploadIdMarker: uploadIdMarker,
            MaxUploads: limit,
          }),
          { abortSignal: signal }
        );
        return {
          entries: (page.Uploads ?? []).map((entry) => ({
            key: entry.Key,
            uploadId: entry.UploadId,
          })),
          isTruncated: page.IsTruncated === true,
          nextKey: page.NextKeyMarker,
          nextUploadId: page.NextUploadIdMarker,
        };
      },
      abortMultipart: async (key, uploadId, signal) => {
        try {
          await config.client.send(
            new AbortMultipartUploadCommand({
              Bucket: config.bucket,
              Key: key,
              UploadId: uploadId,
            }),
            { abortSignal: signal }
          );
        } catch (error) {
          if (!(error instanceof Error && error.name === 'NoSuchUpload')) throw error;
        }
      },
    },
    port:
      config.provider === 's3'
        ? {
            kind: 'versioned',
            listVersions: async (prefix, keyMarker, versionMarker, limit, signal) => {
              const page = await config.client.send(
                new ListObjectVersionsCommand({
                  Bucket: config.bucket,
                  Prefix: prefix,
                  KeyMarker: keyMarker,
                  VersionIdMarker: versionMarker,
                  MaxKeys: limit,
                }),
                { abortSignal: signal }
              );
              return {
                entries: [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map((entry) => ({
                  key: entry.Key,
                  versionId: entry.VersionId,
                })),
                isTruncated: page.IsTruncated === true,
                nextKey: page.NextKeyMarker,
                nextVersion: page.NextVersionIdMarker,
              };
            },
            deleteVersion: async (key, versionId, signal) => {
              await config.client.send(
                new DeleteObjectCommand({
                  Bucket: config.bucket,
                  Key: key,
                  VersionId: versionId,
                }),
                { abortSignal: signal }
              );
            },
          }
        : {
            kind: 'unversioned',
            listObjects: async (prefix, token, limit, signal) => {
              const page = await config.client.send(
                new ListObjectsV2Command({
                  Bucket: config.bucket,
                  Prefix: prefix,
                  ContinuationToken: token,
                  MaxKeys: limit,
                }),
                { abortSignal: signal }
              );
              return {
                entries: (page.Contents ?? []).map((entry) => ({ key: entry.Key })),
                isTruncated: page.IsTruncated === true,
                nextToken: page.NextContinuationToken,
              };
            },
            deleteObject: async (key, signal) => {
              await config.client.send(
                new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
                { abortSignal: signal }
              );
            },
          },
  });
  return {
    descriptor: Object.freeze({
      kind: 'object',
      location,
      binding,
      access:
        saved?.kind === 'object'
          ? saved.access!
          : (config.access ?? {
              provider: config.provider,
              credentialRevision: randomUUID(),
              signingRegion: snapshot.objectStorageRegion?.trim() || 'us-east-1',
            }),
      publicUrl,
      referenceEncoding,
    }),
    normalize: (reference) => cleanup.normalize(reference),
    downloadToFile: async (reference, destination, signal) => {
      signal?.throwIfAborted();
      const key = cleanup.normalize(reference);
      return copyOwnedReadableToFile({
        destination,
        signal,
        openSource: async () => {
          const response = await config.client.send(
            new GetObjectCommand({ Bucket: config.bucket, Key: key }),
            { abortSignal: signal }
          );
          if (!response.Body) throw new Error(`Empty response downloading ${key} from storage`);
          if (!(response.Body instanceof Readable))
            throw new StorageReadCleanupError({
              cause: new Error('Object storage returned an unsupported body lifecycle'),
            });
          return response.Body;
        },
      });
    },
    list: (prefix, signal) => cleanup.list(prefix, signal),
    has: (key, signal) => cleanup.has(key, signal),
    writeBuffer: async (key, body, contentType, signal) => {
      validateStorageKey(key);
      if (!contentType.trim()) throw new Error('Storage content type is required');
      signal?.throwIfAborted();
      await config.client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          IfNoneMatch: '*',
        }),
        { abortSignal: signal }
      );
      return publicUrlForKey({ ...config, publicUrl }, key, referenceEncoding);
    },
    writeStream: (key, body, contentType, signal) =>
      withOwnedStorageStream(body, async () => {
        validateStorageKey(key);
        if (!contentType.trim()) throw new Error('Storage content type is required');
        signal?.throwIfAborted();
        const abortController = new AbortController();
        const upload = new Upload({
          client: config.client,
          params: {
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            // R2 multipart completion has no documented conditional-write contract.
            // Its destinations require exclusive journal allocation and immutable UUID keys.
            ...(config.provider === 's3' ? { IfNoneMatch: '*' } : {}),
          },
          abortController,
          leavePartsOnError: true,
          queueSize: 4,
          partSize: 5 * 1024 * 1024,
        });
        const abort = () => {
          abortController.abort();
          body.destroy();
        };
        signal?.addEventListener('abort', abort, { once: true });
        try {
          await upload.done();
          return publicUrlForKey({ ...config, publicUrl }, key, referenceEncoding);
        } catch (error) {
          abort();
          signal?.throwIfAborted();
          throw error;
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      }),
    delete: async (key, options) => {
      assertCleanupKey(key, options);
      await cleanup.delete(key, options?.signal);
    },
  };
}

function assertCleanupKey(key: string, options?: { force?: boolean }): void {
  if (!options?.force && PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(key)))
    throw new Error('Deleting protected episode audio requires explicit force');
}

function localPathForKey(keyOrUrl: string): string {
  const base = localBaseDir();
  const resolved = path.resolve(base, keyOrUrl);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Refusing to access local storage path outside ${base}`);
  }
  return resolved;
}

function pathInsideRoot(root: string, key: string): string {
  validateStorageKey(key);
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    throw new Error(`Refusing to access local storage path outside ${root}`);
  return resolved;
}

async function attributedStorageReference(reference: string) {
  return sottoTransaction(prismaUnfiltered, async (database) =>
    new StorageReferenceRegistry(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      SIDEDOOR_STATE_ID
    ).readReference(reference)
  );
}

async function attributedLocalPath(key: string): Promise<string | null> {
  const attributed = await attributedStorageReference(localUrlForKey(key));
  if (!attributed || attributed.backend.descriptor.kind !== 'local') return null;
  if (attributed.asset.prepared.target.key !== key)
    throw new Error('Local storage route attribution changed');
  return pathInsideRoot(attributed.backend.descriptor.referenceRoot, key);
}

function localKeyForPath(filePath: string): string {
  return path.relative(localBaseDir(), filePath).split(path.sep).join('/');
}

/**
 * Browser-reachable URL for a locally stored object. Local storage has no
 * public origin, so it is served back through `GET /api/v1/storage/<key>`
 * through an authenticated application route.
 */
export const LOCAL_STORAGE_URL_PREFIX = '/api/v1/storage';

function localUrlForKey(keyOrUrl: string): string {
  const encoded = keyOrUrl.split('/').map(encodeURIComponent).join('/');
  return `${LOCAL_STORAGE_URL_PREFIX}/${encoded}`;
}

/** Content type for a storage key, by extension. */
export function contentTypeForKey(key: string): string {
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.m4a')) return 'audio/mp4';
  if (key.endsWith('.wav')) return 'audio/wav';
  if (key.endsWith('.webm')) return 'audio/webm';
  if (key.endsWith('.pdf')) return 'application/pdf';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

async function listLocalFiles(prefix: string): Promise<string[]> {
  const root = localPathForKey(prefix);
  const keys: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        keys.push(localKeyForPath(fullPath));
      }
    }
  }

  const rootStat = await stat(/* turbopackIgnore: true */ root).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  );
  if (!rootStat) return [];
  if (rootStat.isFile()) return [localKeyForPath(root)];
  await walk(root);
  return keys;
}

function publicUrlForKey(
  config: ObjectStorageConfig,
  key: string,
  encoding: 'raw' | 'percent' = 'raw'
): string {
  if (!config.publicUrl) return key;
  const suffix = encoding === 'percent' ? key.split('/').map(encodeURIComponent).join('/') : key;
  return `${config.publicUrl.replace(/\/$/, '')}/${suffix}`;
}

/**
 * Cheap write preflight for workers before they call paid TTS providers.
 * This catches missing or unwritable storage before generating audio.
 */
export async function assertStorageWritable(): Promise<void> {
  const provider = configuredStorageProvider();
  const key = `__sotto-preflight/${randomUUID()}.txt`;
  if (provider === 'local') {
    const filePath = localPathForKey(key);
    await mkdir(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
    await access(/* turbopackIgnore: true */ path.dirname(filePath), constants.W_OK);
    await writeFile(/* turbopackIgnore: true */ filePath, 'ok');
    await unlink(/* turbopackIgnore: true */ filePath).catch((error: NodeJS.ErrnoException) => {
      logger.warn('Storage preflight cleanup failed', { key, error: error.message });
    });
    return;
  }

  const config = await getObjectStorageConfig();
  await config.client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: Buffer.from('ok'),
      ContentType: 'text/plain',
    })
  );
  await config.client
    .send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
    .catch((error: Error) => {
      logger.warn('Storage preflight cleanup failed', {
        key,
        provider: config.provider,
        error: error.message,
      });
    });
}

/**
 * Upload a file to R2
 */
export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  if (configuredStorageProvider() === 'local') {
    const filePath = localPathForKey(key);
    await mkdir(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
    await writeFile(/* turbopackIgnore: true */ filePath, body);
    logger.info('File uploaded to local storage', { key });
    return localUrlForKey(key);
  }

  const config = await getObjectStorageConfig();
  await config.client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  const url = publicUrlForKey(config, key);
  logger.info('File uploaded to object storage', { key, provider: config.provider });
  return url;
}

/**
 * Get a presigned URL for private access
 */
export async function getPresignedUrl(reference: string, expiresIn = 3600): Promise<string> {
  const attributed = await attributedStorageReference(reference);
  if (attributed) {
    const { descriptor } = attributed.backend;
    const key = attributed.asset.prepared.target.key;
    if (descriptor.kind === 'local') return localUrlForKey(key);
    if (!descriptor.access)
      throw new Error('Object storage attribution does not contain a captured credential revision');
    const snapshot = historicalObjectStorageSnapshot(descriptor, await getSiteConfig());
    const config = await getObjectStorageConfig(snapshot, undefined, descriptor.access);
    return getSignedUrl(config.client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
      expiresIn,
    });
  }

  const key = extractR2Key(reference);
  if (configuredStorageProvider() === 'local') return localUrlForKey(key);
  const config = await getObjectStorageConfig();
  return getSignedUrl(config.client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
    expiresIn,
  });
}

/**
 * Read an attributed local object using its immutable captured root.
 * An optional HTTP Range yields the requested slice.
 * Returns null when local storage is not the configured provider, the key does
 * not exist, or the range is unsatisfiable.
 */
export async function readLocalObject(
  key: string,
  range?: string | null
): Promise<{ body: Buffer; size: number; contentType: string; start: number; end: number } | null> {
  let size: number;
  const filePath =
    (await attributedLocalPath(key)) ??
    (configuredStorageProvider() === 'local' ? localPathForKey(key) : null);
  if (!filePath) return null;
  try {
    size = (await stat(/* turbopackIgnore: true */ filePath)).size;
  } catch {
    return null;
  }

  let start = 0;
  let end = size - 1;
  if (range) {
    // Only the single `bytes=a-b` form media elements actually send.
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) return null;
    const [, rawStart, rawEnd] = match;
    if (rawStart === '') {
      // Suffix range: the last N bytes.
      const suffix = Number(rawEnd);
      if (!Number.isFinite(suffix) || suffix <= 0) return null;
      start = Math.max(0, size - suffix);
    } else {
      start = Number(rawStart);
      if (rawEnd !== '') end = Math.min(end, Number(rawEnd));
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size)
      return null;
  }

  const handle = await open(/* turbopackIgnore: true */ filePath, 'r');
  try {
    const body = Buffer.alloc(end - start + 1);
    await handle.read(body, 0, body.length, start);
    return { body, size, contentType: contentTypeForKey(key), start, end };
  } finally {
    await handle.close();
  }
}

/**
 * Extract the R2 object key from a public URL or pass through raw keys.
 */
export function extractR2Key(urlOrKey: string): string {
  if (urlOrKey.startsWith('file://'))
    throw new Error('Local storage references must use the authenticated storage route');
  if (urlOrKey.startsWith(`${LOCAL_STORAGE_URL_PREFIX}/`)) {
    return urlOrKey
      .slice(LOCAL_STORAGE_URL_PREFIX.length + 1)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
  }
  const publicUrl = infra('objectStoragePublicUrl');
  if (publicUrl && urlOrKey.startsWith(`${publicUrl.replace(/\/$/, '')}/`))
    return urlOrKey.slice(publicUrl.replace(/\/$/, '').length + 1);
  return urlOrKey;
}

/**
 * Resolve an audio URL. All non-null audio is served via a presigned URL
 * (1hr TTL); private and unlisted lessons are never exposed as a raw CDN URL.
 * null → return null.
 */
export async function resolveAudioUrl(audioUrl: string | null): Promise<string | null> {
  if (!audioUrl) return null;
  if (audioUrl.startsWith(`${LOCAL_STORAGE_URL_PREFIX}/`)) return audioUrl;
  return getPresignedUrl(audioUrl);
}

/**
 * Protected path patterns — these files must never be bulk-deleted.
 * Segment audio is needed by voice tracks, re-stitching, and future features.
 * Episode audio is the final stitched output — irreplaceable without re-generation.
 */
const PROTECTED_PATH_PATTERNS = [
  /^episodes\/[^/]+\/segments\/[^/]+\.mp3$/, // segment audio
  /^episodes\/[^/]+\/audio\.mp3$/, // final episode audio
];

/**
 * Delete a file from R2.
 *
 * Protected paths (segment audio, episode audio) require `{ force: true }`.
 * This prevents accidental bulk deletion — the storage-cleanup incident of 2026-02.
 */
export async function deleteFile(urlOrKey: string, opts?: { force?: boolean }): Promise<void> {
  const key = extractR2Key(urlOrKey);

  if (!opts?.force && PROTECTED_PATH_PATTERNS.some((p) => p.test(key))) {
    throw new Error(
      `Refusing to delete protected file: ${key}. ` +
        'Segment and episode audio files must not be deleted. ' +
        'Pass { force: true } only if you are certain this is intentional.'
    );
  }

  if (configuredStorageProvider() === 'local') {
    await unlink(/* turbopackIgnore: true */ localPathForKey(key)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      }
    );
    logger.info('File deleted from local storage', { key });
    return;
  }

  const config = await getObjectStorageConfig();
  await config.client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));

  logger.info('File deleted from object storage', { key, provider: config.provider });
}

/**
 * List all object keys under a given prefix, handling pagination
 */
export async function listFiles(prefix: string): Promise<string[]> {
  if (configuredStorageProvider() === 'local') {
    const keys = await listLocalFiles(prefix);
    logger.info('Listed files from local storage', { prefix, count: String(keys.length) });
    return keys;
  }

  const config = await getObjectStorageConfig();
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await config.client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key) {
          keys.push(object.Key);
        }
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  logger.info('Listed files from object storage', {
    prefix,
    count: String(keys.length),
    provider: config.provider,
  });
  return keys;
}
