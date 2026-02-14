import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
 * Download a file from R2 by its public URL or key
 */
export async function downloadFile(urlOrKey: string): Promise<Buffer> {
  if (!s3Client) {
    throw new Error('R2 storage not configured — set R2_* environment variables');
  }

  // If it's a full URL, extract the key
  const key =
    R2_PUBLIC_URL && urlOrKey.startsWith(R2_PUBLIC_URL)
      ? urlOrKey.slice(R2_PUBLIC_URL.length + 1)
      : urlOrKey;

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
 * Delete a file from R2
 */
export async function deleteFile(key: string): Promise<void> {
  if (!s3Client) {
    throw new Error('R2 storage not configured');
  }

  await s3Client.send(
    new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
  );

  logger.info('File deleted from R2', { key });
}
