import type { Readable } from 'stream';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { infra } from '../server-config';
import { LOCAL_STORAGE_URL_PREFIX } from '../r2';

export interface StorageProvider {
  uploadFile(key: string, data: Buffer, contentType: string): Promise<string>;
  uploadStream(key: string, body: Readable, contentType: string): Promise<string>;
  downloadFile(key: string): Promise<Buffer>;
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>;
  deleteFile(key: string): Promise<void>;
}

interface StorageProviderOptions {
  s3Bucket?: string | null;
  s3Region?: string | null;
}

/**
 * Cloudflare R2 provider.
 */
class R2Provider implements StorageProvider {
  private get bucket() {
    return process.env.R2_BUCKET_NAME || 'sotto-storage';
  }

  private get publicUrl() {
    return process.env.R2_PUBLIC_URL?.trim() || null;
  }

  private async getR2Client() {
    const {
      S3Client: S3,
      PutObjectCommand,
      GetObjectCommand,
      DeleteObjectCommand,
    } = await import('@aws-sdk/client-s3');
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('R2 storage not configured — set R2_* environment variables');
    }
    const client = new S3({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    return { client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
  }

  private urlForKey(key: string): string {
    return this.publicUrl ? `${this.publicUrl}/${key}` : key;
  }

  async uploadFile(key: string, data: Buffer, contentType: string): Promise<string> {
    const { client, PutObjectCommand } = await this.getR2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
    return this.urlForKey(key);
  }

  async uploadStream(key: string, body: Readable, contentType: string): Promise<string> {
    const { client } = await this.getR2Client();
    const { Upload } = await import('@aws-sdk/lib-storage');
    const upload = new Upload({
      client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
    });
    await upload.done();
    return this.urlForKey(key);
  }

  async downloadFile(key: string): Promise<Buffer> {
    const { client, GetObjectCommand } = await this.getR2Client();
    const response = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error(`Empty response downloading ${key} from R2`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const { client, GetObjectCommand } = await this.getR2Client();
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn,
    });
  }

  async deleteFile(key: string): Promise<void> {
    const { client, DeleteObjectCommand } = await this.getR2Client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * AWS S3 provider — uses AWS S3 directly.
 */
class S3Provider implements StorageProvider {
  constructor(private readonly options: StorageProviderOptions = {}) {}

  private async getS3Client() {
    const {
      S3Client: S3,
      PutObjectCommand,
      GetObjectCommand,
      DeleteObjectCommand,
    } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    // Credentials are secrets — env-only, never sourced from DB config. When s3 is
    // the explicit choice but creds are missing, fail loudly rather than building a
    // broken client (no availability-based soft fallback).
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        'STORAGE_PROVIDER=s3 requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. Set them in your environment.'
      );
    }

    const client = new S3({
      region: this.region,
      credentials: { accessKeyId, secretAccessKey },
    });

    return { client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, getSignedUrl };
  }

  private get bucket() {
    return this.options.s3Bucket?.trim() || infra('s3Bucket', 'AWS_S3_BUCKET') || 'sotto-storage';
  }

  private get region() {
    return this.options.s3Region?.trim() || infra('s3Region', 'AWS_S3_REGION') || 'us-east-1';
  }

  async uploadFile(key: string, data: Buffer, contentType: string): Promise<string> {
    const { client, PutObjectCommand } = await this.getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async uploadStream(key: string, body: Readable, contentType: string): Promise<string> {
    const { client } = await this.getS3Client();
    const { Upload } = await import('@aws-sdk/lib-storage');
    const upload = new Upload({
      client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
    });
    await upload.done();
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async downloadFile(key: string): Promise<Buffer> {
    const { client, GetObjectCommand } = await this.getS3Client();
    const response = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error(`Empty response downloading ${key} from S3`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const { client, GetObjectCommand, getSignedUrl } = await this.getS3Client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn,
    });
  }

  async deleteFile(key: string): Promise<void> {
    const { client, DeleteObjectCommand } = await this.getS3Client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * Local filesystem provider — for development without cloud storage.
 */
class LocalProvider implements StorageProvider {
  private get baseDir() {
    return path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      process.env.LOCAL_STORAGE_DIR || '/tmp/sotto-storage'
    );
  }

  private pathForKey(key: string): string {
    if (key.startsWith('file://')) return fileURLToPath(key);
    const resolved = path.resolve(this.baseDir, key);
    if (resolved !== this.baseDir && !resolved.startsWith(`${this.baseDir}${path.sep}`)) {
      throw new Error(`Refusing to access local storage path outside ${this.baseDir}`);
    }
    return resolved;
  }

  /**
   * Local storage has no public origin, so objects are served back through the
   * app's own storage route. Must match `localUrlForKey` in `lib/r2.ts`.
   */
  private urlForKey(key: string): string {
    const relative = key.startsWith('file://')
      ? path.relative(this.baseDir, fileURLToPath(key)).split(path.sep).join('/')
      : key;
    return `${LOCAL_STORAGE_URL_PREFIX}/${relative.split('/').map(encodeURIComponent).join('/')}`;
  }

  async uploadFile(key: string, data: Buffer, _contentType: string): Promise<string> {
    const fs = await import('fs/promises');
    const filePath = this.pathForKey(key);
    await fs.mkdir(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
    await fs.writeFile(/* turbopackIgnore: true */ filePath, data);
    return this.urlForKey(key);
  }

  async uploadStream(key: string, body: Readable, _contentType: string): Promise<string> {
    const fs = await import('fs');
    const fsPromises = await import('fs/promises');
    const { pipeline } = await import('stream/promises');
    const filePath = this.pathForKey(key);
    await fsPromises.mkdir(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
    await pipeline(body, fs.createWriteStream(/* turbopackIgnore: true */ filePath));
    return this.urlForKey(key);
  }

  async downloadFile(key: string): Promise<Buffer> {
    const fs = await import('fs/promises');
    return fs.readFile(/* turbopackIgnore: true */ this.pathForKey(key));
  }

  async getPresignedUrl(key: string): Promise<string> {
    return this.urlForKey(key);
  }

  async deleteFile(key: string): Promise<void> {
    const fs = await import('fs/promises');
    try {
      await fs.unlink(/* turbopackIgnore: true */ this.pathForKey(key));
    } catch {
      // File may not exist
    }
  }
}

export type StorageProviderId = 'local' | 'r2' | 's3';

function resolveStorageProviderType(type?: string): StorageProviderId {
  const providerType = type || infra('storageProvider', 'STORAGE_PROVIDER') || 'local';
  if (providerType !== 'local' && providerType !== 'r2' && providerType !== 's3') {
    throw new Error(`Unknown storage provider "${providerType}". Expected one of: local, r2, s3.`);
  }
  return providerType;
}

export function createStorageProvider(
  type?: string,
  options: StorageProviderOptions = {}
): StorageProvider {
  const providerType = resolveStorageProviderType(type);
  switch (providerType) {
    case 'r2':
      return new R2Provider();
    case 's3':
      return new S3Provider(options);
    case 'local':
      return new LocalProvider();
  }
}
