import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { logger } from './logger';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sotto-storage';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const s3Client =
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
    ? new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
      })
    : null;

/**
 * Upload a file to R2
 */
export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  if (!s3Client) {
    throw new Error('R2 storage not configured — set R2_* environment variables');
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  const url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
  logger.info('File uploaded to R2', { key });
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
  if (!s3Client) {
    throw new Error('R2 storage not configured — set R2_* environment variables');
  }

  const upload = new Upload({
    client: s3Client,
    params: { Bucket: R2_BUCKET_NAME, Key: key, Body: body, ContentType: contentType },
    queueSize: 4,
    partSize: 5 * 1024 * 1024,
  });

  await upload.done();

  const url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
  logger.info('Stream uploaded to R2', { key });
  return url;
}

/**
 * Upload podcast audio to R2
 */
export async function uploadPodcastAudio(podcastId: string, audio: Buffer): Promise<string> {
  const key = `podcasts/${podcastId}/audio.mp3`;
  return uploadFile(key, audio, 'audio/mpeg');
}

/**
 * Upload a segment audio file
 */
export async function uploadSegmentAudio(
  podcastId: string,
  segmentId: string,
  audio: Buffer
): Promise<string> {
  const key = `podcasts/${podcastId}/segments/${segmentId}.mp3`;
  return uploadFile(key, audio, 'audio/mpeg');
}

/**
 * Get a presigned URL for private access
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  if (!s3Client) {
    throw new Error('R2 storage not configured');
  }

  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }),
    { expiresIn }
  );
}

/**
 * Extract the R2 object key from a public URL or pass through raw keys.
 */
export function extractR2Key(urlOrKey: string): string {
  if (R2_PUBLIC_URL && urlOrKey.startsWith(R2_PUBLIC_URL)) {
    return urlOrKey.slice(R2_PUBLIC_URL.length + 1);
  }
  return urlOrKey;
}

/**
 * Resolve an audio URL based on podcast visibility.
 * PUBLIC → return the CDN URL as-is.
 * PRIVATE/UNLISTED → return a presigned URL (1hr TTL).
 * null → return null.
 */
export async function resolveAudioUrl(
  audioUrl: string | null,
  visibility: string
): Promise<string | null> {
  if (!audioUrl) return null;
  if (visibility === 'PUBLIC') return audioUrl;
  const key = extractR2Key(audioUrl);
  return getPresignedUrl(key);
}

/**
 * Download a file from R2 by its public URL or key
 */
export async function downloadFile(urlOrKey: string): Promise<Buffer> {
  if (!s3Client) {
    throw new Error('R2 storage not configured — set R2_* environment variables');
  }

  const key = extractR2Key(urlOrKey);

  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
  );

  if (!response.Body) {
    throw new Error(`Empty response downloading ${key} from R2`);
  }

  const chunks: Uint8Array[] = [];
  const stream = response.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  logger.info('File downloaded from R2', { key });
  return Buffer.concat(chunks);
}

/**
 * Stream a file from R2 directly to disk without buffering in memory.
 */
export async function downloadToFile(urlOrKey: string, destPath: string): Promise<void> {
  if (!s3Client) {
    throw new Error('R2 storage not configured — set R2_* environment variables');
  }

  const key = extractR2Key(urlOrKey);

  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
  );

  if (!response.Body) {
    throw new Error(`Empty response downloading ${key} from R2`);
  }

  await pipeline(
    Readable.from(response.Body as AsyncIterable<Uint8Array>),
    createWriteStream(destPath)
  );

  logger.info('File streamed from R2 to disk', { key, destPath });
}

/**
 * Protected path patterns — these files must never be bulk-deleted.
 * Segment audio is needed by avatar generation, voice tracks, and future features.
 * Podcast audio is the final stitched output — irreplaceable without re-generation.
 */
const PROTECTED_PATH_PATTERNS = [
  /^podcasts\/[^/]+\/segments\/[^/]+\.mp3$/,  // segment audio
  /^podcasts\/[^/]+\/audio\.mp3$/,             // final podcast audio
];

/**
 * Delete a file from R2.
 *
 * Protected paths (segment audio, podcast audio) require `{ force: true }`.
 * This prevents accidental bulk deletion — the storage-cleanup incident of 2026-02.
 */
export async function deleteFile(urlOrKey: string, opts?: { force?: boolean }): Promise<void> {
  if (!s3Client) {
    throw new Error('R2 storage not configured');
  }

  const key = extractR2Key(urlOrKey);

  if (!opts?.force && PROTECTED_PATH_PATTERNS.some((p) => p.test(key))) {
    throw new Error(
      `Refusing to delete protected file: ${key}. ` +
      'Segment and podcast audio files must not be deleted. ' +
      'Pass { force: true } only if you are certain this is intentional.'
    );
  }

  await s3Client.send(
    new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
  );

  logger.info('File deleted from R2', { key });
}

/**
 * List top-level prefixes (folders) in the bucket using S3 Delimiter.
 * Single API call — no full bucket scan.
 */
export async function listPrefixes(): Promise<{ prefix: string }[]> {
  if (!s3Client) {
    throw new Error('R2 storage not configured');
  }

  const response = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Delimiter: '/',
    })
  );

  const prefixes = (response.CommonPrefixes ?? [])
    .filter((cp): cp is { Prefix: string } => !!cp.Prefix)
    .map((cp) => ({ prefix: cp.Prefix }));

  logger.info('Listed R2 prefixes', { count: String(prefixes.length) });
  return prefixes;
}

/**
 * List all objects under a prefix with full metadata (size, lastModified).
 * Handles pagination for large prefixes.
 */
export async function listObjectsDetailed(prefix: string): Promise<{
  key: string;
  sizeBytes: number;
  lastModified: Date | undefined;
}[]> {
  if (!s3Client) {
    throw new Error('R2 storage not configured');
  }

  const objects: { key: string; sizeBytes: number; lastModified: Date | undefined }[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
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

  logger.info('Listed detailed objects from R2', { prefix, count: String(objects.length) });
  return objects;
}

/**
 * List all object keys under a given prefix, handling pagination
 */
export async function listFiles(prefix: string): Promise<string[]> {
  if (!s3Client) {
    throw new Error('R2 storage not configured');
  }

  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
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

  logger.info('Listed files from R2', { prefix, count: String(keys.length) });
  return keys;
}
