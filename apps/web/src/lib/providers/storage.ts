import type { Readable } from 'stream';
import { logger } from '../logger';

export interface StorageProvider {
  uploadFile(key: string, data: Buffer, contentType: string): Promise<string>;
  uploadStream(key: string, body: Readable, contentType: string): Promise<string>;
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>;
  deleteFile(key: string): Promise<void>;
}

/**
 * Cloudflare R2 provider — wraps existing r2.ts.
 */
class R2Provider implements StorageProvider {
  private async getClient() {
    return import('../r2');
  }

  async uploadFile(key: string, data: Buffer, contentType: string): Promise<string> {
    const r2 = await this.getClient();
    return r2.uploadFile(key, data, contentType);
  }

  async uploadStream(key: string, body: Readable, contentType: string): Promise<string> {
    const r2 = await this.getClient();
    return r2.uploadStream(key, body, contentType);
  }

  async getPresignedUrl(key: string, expiresIn?: number): Promise<string> {
    const r2 = await this.getClient();
    return r2.getPresignedUrl(key, expiresIn);
  }

  async deleteFile(key: string): Promise<void> {
    const r2 = await this.getClient();
    return r2.deleteFile(key);
  }
}

/**
 * AWS S3 provider — uses AWS S3 directly.
 */
class S3Provider implements StorageProvider {
  private async getS3Client() {
    const { S3Client: S3, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const client = new S3({
      region: process.env.AWS_S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });

    return { client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, getSignedUrl };
  }

  private get bucket() {
    return process.env.AWS_S3_BUCKET || 'sotto-storage';
  }

  async uploadFile(key: string, data: Buffer, contentType: string): Promise<string> {
    const { client, PutObjectCommand } = await this.getS3Client();
    await client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    }));
    const region = process.env.AWS_S3_REGION || 'us-east-1';
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  async uploadStream(key: string, body: Readable, contentType: string): Promise<string> {
    const { client } = await this.getS3Client();
    const { Upload } = await import('@aws-sdk/lib-storage');
    const upload = new Upload({
      client: client as any,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
    });
    await upload.done();
    const region = process.env.AWS_S3_REGION || 'us-east-1';
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const { client, GetObjectCommand, getSignedUrl } = await this.getS3Client();
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn }
    );
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
    return process.env.LOCAL_STORAGE_DIR || '/tmp/sotto-storage';
  }

  async uploadFile(key: string, data: Buffer, _contentType: string): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.join(this.baseDir, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return `file://${filePath}`;
  }

  async uploadStream(key: string, body: Readable, _contentType: string): Promise<string> {
    const fs = await import('fs');
    const fsPromises = await import('fs/promises');
    const path = await import('path');
    const { pipeline } = await import('stream/promises');
    const filePath = path.join(this.baseDir, key);
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(body, fs.createWriteStream(filePath));
    return `file://${filePath}`;
  }

  async getPresignedUrl(key: string): Promise<string> {
    const path = await import('path');
    return `file://${path.join(this.baseDir, key)}`;
  }

  async deleteFile(key: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.join(this.baseDir, key);
    try {
      await fs.unlink(filePath);
    } catch {
      // File may not exist
    }
  }
}

export function createStorageProvider(type?: string): StorageProvider {
  const providerType = type || process.env.STORAGE_PROVIDER || 'local';
  switch (providerType) {
    case 'r2':
      return new R2Provider();
    case 's3':
      return new S3Provider();
    case 'local':
      return new LocalProvider();
    default:
      logger.warn(`Unknown STORAGE_PROVIDER "${providerType}", falling back to local`);
      return new LocalProvider();
  }
}
