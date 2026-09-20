// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  config: {
    storageProvider: 'r2',
    localStorageRoot: null as string | null,
    objectStorageEndpoint: 'https://account.r2.cloudflarestorage.com',
    objectStorageBucket: 'media',
    objectStorageRegion: 'auto',
    objectStoragePublicUrl: 'https://media.example.com',
  },
  send: vi.fn(),
  signed: vi.fn(),
}));

vi.mock('@/lib/server-config', () => ({
  infra: (key: keyof typeof boundary.config) => boundary.config[key] ?? undefined,
}));
vi.mock('@/lib/site-config', () => ({ getSiteConfig: async () => boundary.config }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (run: (database: unknown) => unknown) => run({ $queryRawUnsafe: async () => [] }),
  },
  prismaUnfiltered: {
    $transaction: (run: (database: unknown) => unknown) => run({ $queryRawUnsafe: async () => [] }),
  },
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-credentials', () => ({
  resolveSottoInstanceStorageCredential: async () => ({
    credentialRevision: 'fixture-revision',
    values: { accessKeyId: 'access', secretAccessKey: 'secret' },
  }),
  resolveSottoInstanceStorageCredentialRevision: async () => ({
    credentialRevision: 'fixture-revision',
    values: { accessKeyId: 'access', secretAccessKey: 'secret' },
  }),
}));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: class {
      send = boundary.send;
    },
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...parameters: unknown[]) => boundary.signed(...parameters),
}));

import {
  deleteFile,
  extractR2Key,
  getPresignedUrl,
  readLocalObject,
  resolveAudioUrl,
  uploadFile,
} from '@/lib/r2';

describe('shared storage runtime', () => {
  let directory: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'sotto-storage-'));
    Object.assign(boundary.config, {
      storageProvider: 'r2',
      localStorageRoot: null,
      objectStorageEndpoint: 'https://account.r2.cloudflarestorage.com',
      objectStorageBucket: 'media',
      objectStorageRegion: 'auto',
      objectStoragePublicUrl: 'https://media.example.com',
    });
    boundary.send.mockResolvedValue({});
    boundary.signed.mockResolvedValue('https://signed.example.com/object');
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it('writes object bytes to the configured shared destination', async () => {
    expect(await uploadFile('episodes/one/audio.mp3', Buffer.from('audio'), 'audio/mpeg')).toBe(
      'https://media.example.com/episodes/one/audio.mp3'
    );
    expect(boundary.send).toHaveBeenCalledOnce();
    expect(boundary.send.mock.calls[0]![0].input).toMatchObject({
      Bucket: 'media',
      Key: 'episodes/one/audio.mp3',
      ContentType: 'audio/mpeg',
    });
  });

  it('writes and serves local bytes through the browser route', async () => {
    Object.assign(boundary.config, { storageProvider: 'local', localStorageRoot: directory });
    const url = await uploadFile('episodes/one/audio.mp3', Buffer.from('audio'), 'audio/mpeg');
    expect(url).toBe('/api/v1/storage/episodes/one/audio.mp3');
    expect(await readFile(join(directory, 'episodes/one/audio.mp3'), 'utf8')).toBe('audio');
    expect(await readLocalObject('episodes/one/audio.mp3')).toMatchObject({
      body: Buffer.from('audio'),
      size: 5,
      start: 0,
      end: 4,
    });
    expect(await resolveAudioUrl(url)).toBe(url);
  });

  it('presigns private object references from shared configuration', async () => {
    expect(await getPresignedUrl('episodes/one/audio.mp3', 120)).toBe(
      'https://signed.example.com/object'
    );
    expect(boundary.signed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ input: { Bucket: 'media', Key: 'episodes/one/audio.mp3' } }),
      { expiresIn: 120 }
    );
  });

  it('normalizes local routes and configured public URLs', () => {
    expect(extractR2Key('/api/v1/storage/worksheets/a%20b/notes.pdf')).toBe(
      'worksheets/a b/notes.pdf'
    );
    expect(extractR2Key('https://media.example.com/episodes/one/audio.mp3')).toBe(
      'episodes/one/audio.mp3'
    );
  });

  it('requires explicit authorization before deleting protected audio', async () => {
    await expect(deleteFile('episodes/one/audio.mp3')).rejects.toThrow(
      'Refusing to delete protected file'
    );
    await deleteFile('episodes/one/audio.mp3', { force: true });
    expect(boundary.send).toHaveBeenCalledOnce();
  });
});
