import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';

// Set environment variables in hoisted block to ensure they're set before module evaluation
vi.hoisted(() => {
  process.env.R2_ACCOUNT_ID = 'test-account-id';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_PUBLIC_URL = 'https://cdn.example.com';
});

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  uploadFile,
  uploadStream,
  uploadPodcastAudio,
  uploadSegmentAudio,
  getPresignedUrl,
  downloadFile,
  downloadToFile,
  deleteFile,
  extractR2Key,
  resolveAudioUrl,
  listPrefixes,
  listObjectsDetailed,
} from '@/lib/r2';

// Mock AWS SDK and presigner
const { mockSend, MockPutObjectCommand, MockGetObjectCommand, MockDeleteObjectCommand, MockListObjectsV2Command } =
  vi.hoisted(() => ({
    mockSend: vi.fn(),
    MockPutObjectCommand: vi.fn(function (this: any, params: any) {
      this.params = params;
    }),
    MockGetObjectCommand: vi.fn(function (this: any, params: any) {
      this.params = params;
    }),
    MockDeleteObjectCommand: vi.fn(function (this: any, params: any) {
      this.params = params;
    }),
    MockListObjectsV2Command: vi.fn(function (this: any, params: any) {
      this.params = params;
    }),
  }));

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = mockSend;
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
    ListObjectsV2Command: MockListObjectsV2Command,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

const { mockUploadDone } = vi.hoisted(() => ({
  mockUploadDone: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn().mockImplementation(function () {
    return { done: mockUploadDone };
  }),
}));

const { mockCreateWriteStream, mockPipeline } = vi.hoisted(() => ({
  mockCreateWriteStream: vi.fn().mockReturnValue({
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }),
  mockPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock(import('fs'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual, createWriteStream: mockCreateWriteStream }, createWriteStream: mockCreateWriteStream };
});

vi.mock(import('stream/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual, pipeline: mockPipeline }, pipeline: mockPipeline };
});

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('r2.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadFile', () => {
    it('uploads a file with correct parameters', async () => {
      mockSend.mockResolvedValue({});

      const key = 'test/file.mp3';
      const body = Buffer.from('test audio data');
      const contentType = 'audio/mpeg';

      const result = await uploadFile(key, body, contentType);

      expect(result).toBe('https://cdn.example.com/test/file.mp3');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: key,
        Body: body,
        ContentType: contentType,
      });
    });

    it('returns key only when R2_PUBLIC_URL is not set', async () => {
      delete process.env.R2_PUBLIC_URL;
      mockSend.mockResolvedValue({});

      const key = 'test/file.mp3';
      const body = Buffer.from('test audio data');
      const contentType = 'audio/mpeg';

      // Need to re-import to pick up new env var
      vi.resetModules();
      const { uploadFile: uploadFileReimport } = await import('@/lib/r2');

      const result = await uploadFileReimport(key, body, contentType);

      expect(result).toBe(key);
    });

    it('throws error when R2 is not configured', async () => {
      delete process.env.R2_ACCOUNT_ID;

      vi.resetModules();
      const { uploadFile: uploadFileReimport } = await import('@/lib/r2');

      await expect(
        uploadFileReimport('test/file.mp3', Buffer.from('data'), 'audio/mpeg')
      ).rejects.toThrow('R2 storage not configured');
    });

    it('handles upload errors properly', async () => {
      mockSend.mockRejectedValue(new Error('S3 upload failed'));

      await expect(uploadFile('test/file.mp3', Buffer.from('data'), 'audio/mpeg')).rejects.toThrow(
        'S3 upload failed'
      );
    });

    it('uploads files with different content types', async () => {
      mockSend.mockResolvedValue({});

      await uploadFile('test/doc.pdf', Buffer.from('pdf data'), 'application/pdf');

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/doc.pdf',
        Body: expect.any(Buffer),
        ContentType: 'application/pdf',
      });
    });
  });

  describe('uploadPodcastAudio', () => {
    it('uploads podcast audio with correct key format', async () => {
      mockSend.mockResolvedValue({});

      const podcastId = 'podcast-123';
      const audio = Buffer.from('audio data');

      const result = await uploadPodcastAudio(podcastId, audio);

      expect(result).toBe('https://cdn.example.com/podcasts/podcast-123/audio.mp3');
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'podcasts/podcast-123/audio.mp3',
        Body: audio,
        ContentType: 'audio/mpeg',
      });
    });

  });

  describe('uploadSegmentAudio', () => {
    it('uploads segment audio with correct key format', async () => {
      mockSend.mockResolvedValue({});

      const podcastId = 'podcast-123';
      const segmentId = 'segment-456';
      const audio = Buffer.from('segment audio data');

      const result = await uploadSegmentAudio(podcastId, segmentId, audio);

      expect(result).toBe('https://cdn.example.com/podcasts/podcast-123/segments/segment-456.mp3');
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'podcasts/podcast-123/segments/segment-456.mp3',
        Body: audio,
        ContentType: 'audio/mpeg',
      });
    });

    it('handles multiple segments for same podcast', async () => {
      mockSend.mockResolvedValue({});

      const podcastId = 'podcast-123';

      await uploadSegmentAudio(podcastId, 'segment-1', Buffer.from('audio 1'));
      await uploadSegmentAudio(podcastId, 'segment-2', Buffer.from('audio 2'));

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(PutObjectCommand).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          Key: 'podcasts/podcast-123/segments/segment-1.mp3',
        })
      );
      expect(PutObjectCommand).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          Key: 'podcasts/podcast-123/segments/segment-2.mp3',
        })
      );
    });
  });

  describe('getPresignedUrl', () => {
    it('generates presigned URL with default expiration', async () => {
      (getSignedUrl as Mock).mockResolvedValue(
        'https://signed-url.example.com/file.mp3?signature=xyz'
      );

      const key = 'test/file.mp3';
      const result = await getPresignedUrl(key);

      expect(result).toBe('https://signed-url.example.com/file.mp3?signature=xyz');
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          params: expect.objectContaining({
            Bucket: 'test-bucket',
            Key: key,
          }),
        }),
        { expiresIn: 3600 }
      );
    });

    it('generates presigned URL with custom expiration', async () => {
      (getSignedUrl as Mock).mockResolvedValue(
        'https://signed-url.example.com/file.mp3?signature=abc'
      );

      const key = 'test/file.mp3';
      const expiresIn = 7200;
      const result = await getPresignedUrl(key, expiresIn);

      expect(result).toBe('https://signed-url.example.com/file.mp3?signature=abc');
      expect(getSignedUrl).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), {
        expiresIn: 7200,
      });
    });

    it('throws error when R2 is not configured', async () => {
      delete process.env.R2_ACCOUNT_ID;

      vi.resetModules();
      const { getPresignedUrl: getPresignedUrlReimport } = await import('@/lib/r2');

      await expect(getPresignedUrlReimport('test/file.mp3')).rejects.toThrow(
        'R2 storage not configured'
      );
    });

    it('handles presigning errors', async () => {
      (getSignedUrl as Mock).mockRejectedValue(new Error('Failed to generate signed URL'));

      await expect(getPresignedUrl('test/file.mp3')).rejects.toThrow(
        'Failed to generate signed URL'
      );
    });
  });

  describe('downloadFile', () => {
    it('downloads file by key', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([1, 2, 3]);
          yield new Uint8Array([4, 5, 6]);
        },
      };

      mockSend.mockResolvedValue({
        Body: mockStream,
      });

      const key = 'test/file.mp3';
      const result = await downloadFile(key);

      expect(result).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: key,
      });
    });

    it('downloads file by full URL (extracts key)', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([1, 2, 3]);
        },
      };

      mockSend.mockResolvedValue({
        Body: mockStream,
      });

      const fullUrl = 'https://cdn.example.com/test/file.mp3';
      const result = await downloadFile(fullUrl);

      expect(result).toEqual(Buffer.from([1, 2, 3]));
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/file.mp3',
      });
    });

    it('throws error when response body is empty', async () => {
      mockSend.mockResolvedValue({
        Body: undefined,
      });

      await expect(downloadFile('test/file.mp3')).rejects.toThrow(
        'Empty response downloading test/file.mp3 from R2'
      );
    });

    it('throws error when R2 is not configured', async () => {
      delete process.env.R2_ACCESS_KEY_ID;

      vi.resetModules();
      const { downloadFile: downloadFileReimport } = await import('@/lib/r2');

      await expect(downloadFileReimport('test/file.mp3')).rejects.toThrow(
        'R2 storage not configured'
      );
    });

    it('handles download errors', async () => {
      mockSend.mockRejectedValue(new Error('File not found'));

      await expect(downloadFile('test/file.mp3')).rejects.toThrow('File not found');
    });

    it('downloads large files in chunks', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(1024).fill(1);
          yield new Uint8Array(1024).fill(2);
          yield new Uint8Array(1024).fill(3);
        },
      };

      mockSend.mockResolvedValue({
        Body: mockStream,
      });

      const result = await downloadFile('test/large-file.mp3');

      expect(result.length).toBe(3072);
      expect(result.slice(0, 1024).every((byte) => byte === 1)).toBe(true);
      expect(result.slice(1024, 2048).every((byte) => byte === 2)).toBe(true);
      expect(result.slice(2048).every((byte) => byte === 3)).toBe(true);
    });
  });

  describe('deleteFile', () => {
    it('deletes file by key', async () => {
      mockSend.mockResolvedValue({});

      const key = 'test/file.mp3';
      await deleteFile(key);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: key,
      });
    });

    it('throws error when R2 is not configured', async () => {
      delete process.env.R2_SECRET_ACCESS_KEY;

      vi.resetModules();
      const { deleteFile: deleteFileReimport } = await import('@/lib/r2');

      await expect(deleteFileReimport('test/file.mp3')).rejects.toThrow(
        'R2 storage not configured'
      );
    });

    it('handles deletion errors', async () => {
      mockSend.mockRejectedValue(new Error('Access denied'));

      await expect(deleteFile('test/file.mp3')).rejects.toThrow('Access denied');
    });

  });

  describe('extractR2Key', () => {
    it('extracts key from public URL', () => {
      const url = 'https://cdn.example.com/podcasts/abc/audio.mp3';
      expect(extractR2Key(url)).toBe('podcasts/abc/audio.mp3');
    });

    it('passes through raw keys unchanged', () => {
      const key = 'podcasts/abc/audio.mp3';
      expect(extractR2Key(key)).toBe('podcasts/abc/audio.mp3');
    });
  });

  describe('resolveAudioUrl', () => {
    it('returns public URL as-is for PUBLIC visibility', async () => {
      const url = 'https://cdn.example.com/podcasts/abc/audio.mp3';
      const result = await resolveAudioUrl(url, 'PUBLIC');
      expect(result).toBe(url);
    });

    it('returns presigned URL for PRIVATE visibility', async () => {
      (getSignedUrl as Mock).mockResolvedValue(
        'https://signed.example.com/podcasts/abc/audio.mp3?X-Amz-Signature=xyz'
      );

      const url = 'https://cdn.example.com/podcasts/abc/audio.mp3';
      const result = await resolveAudioUrl(url, 'PRIVATE');

      expect(result).toBe('https://signed.example.com/podcasts/abc/audio.mp3?X-Amz-Signature=xyz');
      expect(getSignedUrl).toHaveBeenCalled();
    });

    it('returns presigned URL for UNLISTED visibility', async () => {
      (getSignedUrl as Mock).mockResolvedValue(
        'https://signed.example.com/file.mp3?sig=abc'
      );

      const url = 'https://cdn.example.com/podcasts/abc/audio.mp3';
      const result = await resolveAudioUrl(url, 'UNLISTED');

      expect(result).toContain('sig=abc');
    });

    it('returns null for null input', async () => {
      const result = await resolveAudioUrl(null, 'PRIVATE');
      expect(result).toBeNull();
    });
  });

  describe('listPrefixes', () => {
    it('returns prefixes from CommonPrefixes', async () => {
      mockSend.mockResolvedValue({
        CommonPrefixes: [
          { Prefix: 'podcasts/' },
          { Prefix: 'avatars/' },
          { Prefix: 'recordings/' },
        ],
      });

      const result = await listPrefixes();

      expect(result).toEqual([
        { prefix: 'podcasts/' },
        { prefix: 'avatars/' },
        { prefix: 'recordings/' },
      ]);
      expect(ListObjectsV2Command).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Delimiter: '/',
      });
    });

    it('returns empty array when no prefixes exist', async () => {
      mockSend.mockResolvedValue({});

      const result = await listPrefixes();

      expect(result).toEqual([]);
    });

    it('filters out entries without Prefix', async () => {
      mockSend.mockResolvedValue({
        CommonPrefixes: [
          { Prefix: 'podcasts/' },
          { Prefix: undefined },
          { Prefix: 'avatars/' },
        ],
      });

      const result = await listPrefixes();

      expect(result).toEqual([
        { prefix: 'podcasts/' },
        { prefix: 'avatars/' },
      ]);
    });
  });

  describe('uploadStream', () => {
    it('uploads a readable stream via multipart upload', async () => {
      const { Readable } = await import('stream');
      const body = Readable.from(['chunk1', 'chunk2']);

      const result = await uploadStream('test/stream.jsonl', body, 'text/plain');

      expect(result).toBe('https://cdn.example.com/test/stream.jsonl');
      expect(mockUploadDone).toHaveBeenCalled();
    });

    it('throws when R2 is not configured', async () => {
      delete process.env.R2_ACCOUNT_ID;

      vi.resetModules();
      const { uploadStream: uploadStreamReimport } = await import('@/lib/r2');
      const { Readable } = await import('stream');
      const body = Readable.from(['data']);

      await expect(uploadStreamReimport('test/file', body, 'text/plain')).rejects.toThrow(
        'R2 storage not configured'
      );
    });
  });

  describe('downloadToFile', () => {
    it('streams file from R2 to disk', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([1, 2, 3]);
        },
      };

      mockSend.mockResolvedValue({ Body: mockStream });

      await downloadToFile('test/file.mp3', '/tmp/dest.mp3');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/file.mp3',
      });
    });

    it('extracts key from full URL', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array([1]);
        },
      };

      mockSend.mockResolvedValue({ Body: mockStream });

      await downloadToFile('https://cdn.example.com/test/file.mp3', '/tmp/dest.mp3');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test/file.mp3',
      });
    });

    it('throws when response body is empty', async () => {
      mockSend.mockResolvedValue({ Body: undefined });

      await expect(downloadToFile('test/file.mp3', '/tmp/dest.mp3')).rejects.toThrow(
        'Empty response downloading test/file.mp3 from R2'
      );
    });
  });

  describe('listObjectsDetailed', () => {
    it('returns objects with metadata', async () => {
      const lastMod = new Date('2025-01-15T10:00:00Z');
      mockSend.mockResolvedValue({
        Contents: [
          { Key: 'podcasts/abc/audio.mp3', Size: 1048576, LastModified: lastMod },
          { Key: 'podcasts/abc/segments/s1.mp3', Size: 524288, LastModified: lastMod },
        ],
        IsTruncated: false,
      });

      const result = await listObjectsDetailed('podcasts/abc/');

      expect(result).toEqual([
        { key: 'podcasts/abc/audio.mp3', sizeBytes: 1048576, lastModified: lastMod },
        { key: 'podcasts/abc/segments/s1.mp3', sizeBytes: 524288, lastModified: lastMod },
      ]);
      expect(ListObjectsV2Command).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Prefix: 'podcasts/abc/',
        ContinuationToken: undefined,
      });
    });

    it('handles pagination', async () => {
      mockSend
        .mockResolvedValueOnce({
          Contents: [{ Key: 'podcasts/a/audio.mp3', Size: 100, LastModified: undefined }],
          IsTruncated: true,
          NextContinuationToken: 'token-1',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'podcasts/b/audio.mp3', Size: 200, LastModified: undefined }],
          IsTruncated: false,
        });

      const result = await listObjectsDetailed('podcasts/');

      expect(result).toHaveLength(2);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when no contents', async () => {
      mockSend.mockResolvedValue({ IsTruncated: false });

      const result = await listObjectsDetailed('empty-prefix/');

      expect(result).toEqual([]);
    });

    it('defaults Size to 0 when missing', async () => {
      mockSend.mockResolvedValue({
        Contents: [{ Key: 'podcasts/abc/audio.mp3' }],
        IsTruncated: false,
      });

      const result = await listObjectsDetailed('podcasts/abc/');

      expect(result[0].sizeBytes).toBe(0);
    });
  });
});
