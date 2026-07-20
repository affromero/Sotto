import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { constants, createWriteStream } from 'fs';
import { access, copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from './logger';
import { infra } from './server-config';

type StorageProviderId = 'local' | 'r2' | 's3';

interface ObjectStorageConfig {
  provider: Exclude<StorageProviderId, 'local'>;
  client: S3Client;
  bucket: string;
  publicUrl: string | null;
}

function configuredStorageProvider(): StorageProviderId {
  const explicit = infra('storageProvider', 'STORAGE_PROVIDER')?.trim();
  if (explicit) {
    if (explicit === 'local' || explicit === 'r2' || explicit === 's3') return explicit;
    throw new Error(`Unknown storage provider "${explicit}". Expected one of: local, r2, s3.`);
  }

  // Legacy r2.ts callers historically meant R2 when no storage provider was
  // explicitly selected. Keep that behavior to avoid silently switching storage.
  return 'r2';
}

function requireEnv(name: string, message: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(message);
  return value;
}

function r2NotConfiguredMessage(): string {
  return 'R2 storage not configured — set R2_* environment variables';
}

function getObjectStorageConfig(): ObjectStorageConfig {
  const provider = configuredStorageProvider();
  if (provider === 'local') {
    throw new Error('Local storage does not use an object storage client.');
  }

  if (provider === 's3') {
    const accessKeyId = requireEnv(
      'AWS_ACCESS_KEY_ID',
      'STORAGE_PROVIDER=s3 requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. Set them in your environment.'
    );
    const secretAccessKey = requireEnv(
      'AWS_SECRET_ACCESS_KEY',
      'STORAGE_PROVIDER=s3 requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. Set them in your environment.'
    );
    const region = infra('s3Region', 'AWS_S3_REGION') || 'us-east-1';
    const bucket = infra('s3Bucket', 'AWS_S3_BUCKET') || 'sotto-storage';
    return {
      provider,
      client: new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
      }),
      bucket,
      publicUrl: `https://${bucket}.s3.${region}.amazonaws.com`,
    };
  }

  const message = r2NotConfiguredMessage();
  const accountId = requireEnv('R2_ACCOUNT_ID', message);
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID', message);
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY', message);
  return {
    provider,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket: process.env.R2_BUCKET_NAME || 'sotto-storage',
    publicUrl: process.env.R2_PUBLIC_URL || null,
  };
}

function localBaseDir(): string {
  const configured = process.env.LOCAL_STORAGE_DIR || '/tmp/sotto-storage';
  if (path.isAbsolute(configured)) return configured;
  return path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

function localPathForKey(keyOrUrl: string): string {
  if (keyOrUrl.startsWith('file://')) return fileURLToPath(keyOrUrl);
  const base = localBaseDir();
  const resolved = path.resolve(base, keyOrUrl);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Refusing to access local storage path outside ${base}`);
  }
  return resolved;
}

function localKeyForPath(filePath: string): string {
  return path.relative(localBaseDir(), filePath).split(path.sep).join('/');
}

function localUrlForKey(keyOrUrl: string): string {
  if (keyOrUrl.startsWith('file://')) return keyOrUrl;
  return pathToFileURL(localPathForKey(keyOrUrl)).href;
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

function publicUrlForKey(config: ObjectStorageConfig, key: string): string {
  return config.publicUrl ? `${config.publicUrl}/${key}` : key;
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

  const config = getObjectStorageConfig();
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
    return pathToFileURL(filePath).href;
  }

  const config = getObjectStorageConfig();
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
 * Upload a readable stream to R2 using multipart upload.
 * Streams data without buffering the entire payload in memory.
 */
export async function uploadStream(
  key: string,
  body: Readable,
  contentType: string
): Promise<string> {
  if (configuredStorageProvider() === 'local') {
    const filePath = localPathForKey(key);
    await mkdir(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
    await pipeline(body, createWriteStream(filePath));
    logger.info('Stream uploaded to local storage', { key });
    return pathToFileURL(filePath).href;
  }

  const config = getObjectStorageConfig();
  const upload = new Upload({
    client: config.client,
    params: { Bucket: config.bucket, Key: key, Body: body, ContentType: contentType },
    queueSize: 4,
    partSize: 5 * 1024 * 1024,
  });

  await upload.done();

  const url = publicUrlForKey(config, key);
  logger.info('Stream uploaded to object storage', { key, provider: config.provider });
  return url;
}

/**
 * Upload episode audio to R2
 */
export async function uploadEpisodeAudio(episodeId: string, audio: Buffer): Promise<string> {
  const key = `episodes/${episodeId}/audio.mp3`;
  return uploadFile(key, audio, 'audio/mpeg');
}

/**
 * Upload a segment audio file
 */
export async function uploadSegmentAudio(
  episodeId: string,
  segmentId: string,
  audio: Buffer
): Promise<string> {
  const key = `episodes/${episodeId}/segments/${segmentId}.mp3`;
  return uploadFile(key, audio, 'audio/mpeg');
}

/**
 * Get a presigned URL for private access
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  if (configuredStorageProvider() === 'local') {
    return localUrlForKey(key);
  }

  const config = getObjectStorageConfig();
  return getSignedUrl(config.client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
    expiresIn,
  });
}

/**
 * Extract the R2 object key from a public URL or pass through raw keys.
 */
export function extractR2Key(urlOrKey: string): string {
  if (urlOrKey.startsWith('file://')) {
    return localKeyForPath(fileURLToPath(urlOrKey));
  }
  const r2PublicUrl = process.env.R2_PUBLIC_URL;
  if (r2PublicUrl && urlOrKey.startsWith(r2PublicUrl)) {
    return urlOrKey.slice(r2PublicUrl.length + 1);
  }
  const s3Bucket = infra('s3Bucket', 'AWS_S3_BUCKET');
  const s3Region = infra('s3Region', 'AWS_S3_REGION') || 'us-east-1';
  if (s3Bucket) {
    const s3PublicUrl = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com`;
    if (urlOrKey.startsWith(s3PublicUrl)) return urlOrKey.slice(s3PublicUrl.length + 1);
  }
  return urlOrKey;
}

/**
 * Resolve an audio URL. All non-null audio is served via a presigned URL
 * (1hr TTL); private and unlisted lessons are never exposed as a raw CDN URL.
 * null → return null.
 */
export async function resolveAudioUrl(audioUrl: string | null): Promise<string | null> {
  if (!audioUrl) return null;
  const key = extractR2Key(audioUrl);
  return getPresignedUrl(key);
}

/**
 * Download a file from R2 by its public URL or key
 */
export async function downloadFile(urlOrKey: string): Promise<Buffer> {
  if (configuredStorageProvider() === 'local') {
    return readFile(/* turbopackIgnore: true */ localPathForKey(extractR2Key(urlOrKey)));
  }

  const config = getObjectStorageConfig();
  const key = extractR2Key(urlOrKey);

  const response = await config.client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key })
  );

  if (!response.Body) {
    throw new Error(`Empty response downloading ${key} from R2`);
  }

  const chunks: Uint8Array[] = [];
  const stream = response.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  logger.info('File downloaded from object storage', { key, provider: config.provider });
  return Buffer.concat(chunks);
}

/**
 * Stream a file from R2 directly to disk without buffering in memory.
 */
export async function downloadToFile(urlOrKey: string, destPath: string): Promise<void> {
  if (configuredStorageProvider() === 'local') {
    await copyFile(/* turbopackIgnore: true */ localPathForKey(extractR2Key(urlOrKey)), destPath);
    logger.info('File copied from local storage', { destPath });
    return;
  }

  const config = getObjectStorageConfig();
  const key = extractR2Key(urlOrKey);

  const response = await config.client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key })
  );

  if (!response.Body) {
    throw new Error(`Empty response downloading ${key} from R2`);
  }

  await pipeline(
    Readable.from(response.Body as AsyncIterable<Uint8Array>),
    createWriteStream(destPath)
  );

  logger.info('File streamed from object storage to disk', {
    key,
    destPath,
    provider: config.provider,
  });
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

  const config = getObjectStorageConfig();
  await config.client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));

  logger.info('File deleted from object storage', { key, provider: config.provider });
}

/**
 * List top-level prefixes (folders) in the bucket using S3 Delimiter.
 * Single API call — no full bucket scan.
 */
export async function listPrefixes(): Promise<{ prefix: string }[]> {
  if (configuredStorageProvider() === 'local') {
    const entries = await readdir(/* turbopackIgnore: true */ localBaseDir(), {
      withFileTypes: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ prefix: `${entry.name}/` }));
  }

  const config = getObjectStorageConfig();
  const response = await config.client.send(
    new ListObjectsV2Command({
      Bucket: config.bucket,
      Delimiter: '/',
    })
  );

  const prefixes = (response.CommonPrefixes ?? [])
    .filter((cp): cp is { Prefix: string } => !!cp.Prefix)
    .map((cp) => ({ prefix: cp.Prefix }));

  logger.info('Listed object storage prefixes', {
    count: String(prefixes.length),
    provider: config.provider,
  });
  return prefixes;
}

/**
 * List all objects under a prefix with full metadata (size, lastModified).
 * Handles pagination for large prefixes.
 */
export async function listObjectsDetailed(prefix: string): Promise<
  {
    key: string;
    sizeBytes: number;
    lastModified: Date | undefined;
  }[]
> {
  if (configuredStorageProvider() === 'local') {
    const keys = await listLocalFiles(prefix);
    return Promise.all(
      keys.map(async (key) => {
        const info = await stat(/* turbopackIgnore: true */ localPathForKey(key));
        return {
          key,
          sizeBytes: info.size,
          lastModified: info.mtime,
        };
      })
    );
  }

  const config = getObjectStorageConfig();
  const objects: { key: string; sizeBytes: number; lastModified: Date | undefined }[] = [];
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
      for (const obj of response.Contents) {
        if (obj.Key) {
          objects.push({
            key: obj.Key,
            sizeBytes: obj.Size ?? 0,
            lastModified: obj.LastModified,
          });
        }
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  logger.info('Listed detailed objects from object storage', {
    prefix,
    count: String(objects.length),
    provider: config.provider,
  });
  return objects;
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

  const config = getObjectStorageConfig();
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
