// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSiteConfig } from '@/lib/site-config';
import { captureSottoStorageWriter } from '@/lib/sidedoor/storage/core/storage-write';
import {
  captureConfiguredStorageBackend,
  captureStorageBackend,
  captureStorageCleanup,
  restoreStorageBackend,
} from '@/lib/r2';

const storage = vi.hoisted(() => ({
  destinations: [] as Array<{ endpoint?: string; region: string }>,
  versions: [] as Array<{ bucket: string; key: string; version: string; marker?: boolean }>,
  objects: [] as Array<{ bucket: string; key: string; body?: string; contentType?: string }>,
  uploads: [] as Array<{ bucket: string; key: string; uploadId: string }>,
  parts: new Map<string, Map<number, Buffer>>(),
  partGate: null as { started(): void; completed?(): void; wait: Promise<void> } | null,
  fault: '' as '' | 'denied' | 'repeated' | 'missing' | 'outside' | 'empty_versions',
  missingCredentialProvider: null as 's3' | 'r2' | null,
  config: {
    aiProvider: null,
    aiModel: null,
    aiBaseUrl: null,
    liveModel: null,
    sttProvider: null,
    sttBaseUrl: null,
    sttModel: null,
    ttsProvider: null,
    ttsBaseUrl: null,
    storageProvider: 's3',
    localStorageRoot: '.sotto/storage',
    objectStorageEndpoint: 'https://s3.us-east-1.amazonaws.com',
    objectStorageBucket: 'media',
    objectStorageRegion: 'us-east-1',
    objectStoragePublicUrl: 'https://media.s3.us-east-1.amazonaws.com',
  },
}));
vi.mock('@/lib/prisma', () => ({
  prismaUnfiltered: { $transaction: (operation: (database: object) => unknown) => operation({}) },
}));
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: async () => ({ ...storage.config }),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-credentials', () => ({
  resolveSottoInstanceStorageCredential: async (_database: unknown, provider: 'r2' | 's3') => {
    if (storage.missingCredentialProvider === provider)
      throw new Error(`No ${provider} credential`);
    return {
      credentialRevision:
        provider === 's3'
          ? '11111111-1111-4111-8111-111111111111'
          : '22222222-2222-4222-8222-222222222222',
      values: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
    };
  },
  resolveSottoInstanceStorageCredentialRevision: async (
    _database: unknown,
    provider: 'r2' | 's3'
  ) => {
    if (storage.missingCredentialProvider === provider)
      throw new Error(`No ${provider} credential`);
    return { values: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' } };
  },
}));
vi.mock('@aws-sdk/client-s3', async (original) => {
  const sdk = await original<typeof import('@aws-sdk/client-s3')>();
  return {
    ...sdk,
    S3Client: class {
      constructor(options: { endpoint?: string; region: string }) {
        storage.destinations.push({ endpoint: options.endpoint, region: options.region });
      }
      config = {
        requestChecksumCalculation: async () => 'WHEN_REQUIRED',
        endpoint: async () => ({ protocol: 'https:', hostname: 'storage.example' }),
        requestHandler: {},
      };
      async send(command: unknown) {
        if (command instanceof sdk.GetObjectCommand) {
          const object = storage.objects.find(
            (entry) => entry.bucket === command.input.Bucket && entry.key === command.input.Key
          );
          if (!object) throw new Error('Object does not exist');
          return { Body: Readable.from([Buffer.from(object.body ?? '')]) };
        }
        if (command instanceof sdk.CreateMultipartUploadCommand) {
          const { Bucket, Key } = command.input;
          if (!Bucket || !Key) throw new Error('Missing multipart destination');
          const uploadId = crypto.randomUUID();
          storage.uploads.push({ bucket: Bucket, key: Key, uploadId });
          storage.parts.set(uploadId, new Map());
          return { UploadId: uploadId };
        }
        if (command instanceof sdk.UploadPartCommand) {
          const { UploadId, PartNumber, Body } = command.input;
          if (PartNumber === 2 && storage.partGate) {
            storage.partGate.started();
            await storage.partGate.wait;
          }
          if (storage.fault === 'denied') throw new Error('Upload part denied');
          if (!UploadId || !PartNumber || !(Body instanceof Uint8Array))
            throw new Error('Invalid upload part');
          const parts = storage.parts.get(UploadId);
          if (!parts) throw new Error('Missing upload');
          parts.set(PartNumber, Buffer.from(Body));
          if (PartNumber === 2) storage.partGate?.completed?.();
          return { ETag: `part-${PartNumber}` };
        }
        if (command instanceof sdk.CompleteMultipartUploadCommand) {
          const { Bucket, Key, UploadId, MultipartUpload, IfNoneMatch } = command.input;
          if (!Bucket || !Key || !UploadId) throw new Error('Missing completion destination');
          if (
            IfNoneMatch === '*' &&
            storage.objects.some((entry) => entry.bucket === Bucket && entry.key === Key)
          )
            throw Object.assign(new Error('Object already exists'), { name: 'PreconditionFailed' });
          const parts = storage.parts.get(UploadId);
          const body = Buffer.concat(
            (MultipartUpload?.Parts ?? []).map((part) => {
              const content = parts?.get(part.PartNumber!);
              if (!content) throw new Error('Missing completed part');
              return content;
            })
          );
          storage.objects.push({ bucket: Bucket, key: Key, body: body.toString() });
          storage.uploads = storage.uploads.filter((entry) => entry.uploadId !== UploadId);
          storage.parts.delete(UploadId);
          return { Location: `https://storage.example/${Bucket}/${Key}` };
        }
        if (command instanceof sdk.ListMultipartUploadsCommand) {
          const { Bucket, Prefix = '', KeyMarker, UploadIdMarker } = command.input;
          const entries = storage.uploads.filter(
            (entry) => entry.bucket === Bucket && entry.key.startsWith(Prefix)
          );
          const start = KeyMarker
            ? entries.findIndex(
                (entry) => entry.key === KeyMarker && entry.uploadId === UploadIdMarker
              ) + 1
            : 0;
          const page = entries.slice(start, start + 1);
          const last = page.at(-1);
          return {
            Uploads: page.map((entry) => ({ Key: entry.key, UploadId: entry.uploadId })),
            IsTruncated: start + page.length < entries.length,
            NextKeyMarker: last?.key,
            NextUploadIdMarker: last?.uploadId,
          };
        }
        if (command instanceof sdk.AbortMultipartUploadCommand) {
          if (storage.fault === 'denied') throw new Error('Multipart abort denied');
          const { Bucket, Key, UploadId } = command.input;
          storage.uploads = storage.uploads.filter(
            (entry) => entry.bucket !== Bucket || entry.key !== Key || entry.uploadId !== UploadId
          );
          if (UploadId) storage.parts.delete(UploadId);
          return {};
        }
        if (command instanceof sdk.PutObjectCommand) {
          const { Bucket, Key, Body, ContentType, IfNoneMatch } = command.input;
          if (!Bucket || !Key || !(Body instanceof Uint8Array)) throw new Error('Invalid upload');
          if (storage.fault === 'denied') throw new Error('Object writes denied');
          if (IfNoneMatch !== '*') throw new Error('Immutable upload requires a condition');
          if (storage.objects.some((entry) => entry.bucket === Bucket && entry.key === Key))
            throw Object.assign(new Error('Object already exists'), { name: 'PreconditionFailed' });
          storage.objects.push({
            bucket: Bucket,
            key: Key,
            body: Buffer.from(Body).toString(),
            contentType: ContentType,
          });
          return {};
        }
        if (command instanceof sdk.DeleteObjectCommand) {
          if (storage.fault === 'denied') throw new Error('Object retention forbids deletion');
          const { Bucket, Key, VersionId } = command.input;
          if (VersionId !== undefined) {
            storage.versions = storage.versions.filter(
              (entry) => entry.bucket !== Bucket || entry.key !== Key || entry.version !== VersionId
            );
          } else
            storage.objects = storage.objects.filter(
              (entry) => entry.bucket !== Bucket || entry.key !== Key
            );
          return {};
        }
        if (command instanceof sdk.ListObjectVersionsCommand) {
          if (storage.fault === 'empty_versions')
            return { Versions: [], IsTruncated: true, NextKeyMarker: 'recordings/owned.wav' };
          const { Bucket, Prefix = '', KeyMarker, VersionIdMarker } = command.input;
          const entries = storage.versions
            .filter((entry) => entry.bucket === Bucket && entry.key.startsWith(Prefix))
            .sort((a, b) => a.key.localeCompare(b.key) || a.version.localeCompare(b.version));
          const start = KeyMarker
            ? entries.findIndex(
                (entry) => entry.key === KeyMarker && entry.version === VersionIdMarker
              ) + 1
            : 0;
          const page = entries.slice(start, start + 2);
          const last = page.at(-1);
          return {
            Versions: page
              .filter((entry) => !entry.marker)
              .map((entry) => ({ Key: entry.key, VersionId: entry.version })),
            DeleteMarkers: page
              .filter((entry) => entry.marker)
              .map((entry) => ({ Key: entry.key, VersionId: entry.version })),
            IsTruncated: start + page.length < entries.length,
            NextKeyMarker: last?.key,
            NextVersionIdMarker: last?.version,
          };
        }
        if (command instanceof sdk.ListObjectsV2Command) {
          const { Bucket, Prefix = '', ContinuationToken } = command.input;
          if (storage.fault === 'outside' && ContinuationToken)
            return { Contents: [{ Key: 'other/private' }] };
          const entries = storage.objects.filter(
            (entry) => entry.bucket === Bucket && entry.key.startsWith(Prefix)
          );
          const start = Number(ContinuationToken || 0);
          const next = start + 1;
          return {
            Contents: entries.slice(start, next).map((entry) => ({ Key: entry.key })),
            IsTruncated:
              storage.fault === 'repeated' || storage.fault === 'missing' || next < entries.length,
            NextContinuationToken:
              storage.fault === 'missing'
                ? undefined
                : storage.fault === 'repeated'
                  ? '1'
                  : String(next),
          };
        }
        throw new Error('Unexpected storage operation');
      }
    },
  };
});

beforeEach(() => {
  storage.destinations = [];
  storage.versions = [];
  storage.objects = [];
  storage.uploads = [];
  storage.parts.clear();
  storage.partGate = null;
  storage.fault = '';
  storage.missingCredentialProvider = null;
  Object.assign(storage.config, {
    storageProvider: 's3',
    localStorageRoot: '.sotto/storage',
    objectStorageEndpoint: 'https://s3.us-east-1.amazonaws.com',
    objectStorageBucket: 'media',
    objectStorageRegion: 'us-east-1',
    objectStoragePublicUrl: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

function selectProvider(provider: 's3' | 'r2' | 'local') {
  Object.assign(storage.config, {
    storageProvider: provider,
    objectStorageEndpoint:
      provider === 'r2'
        ? 'https://test-account.r2.cloudflarestorage.com'
        : provider === 's3'
          ? 'https://s3.us-east-1.amazonaws.com'
          : null,
    objectStorageBucket: provider === 'local' ? null : 'media',
    objectStorageRegion: provider === 'r2' ? 'auto' : provider === 's3' ? 'us-east-1' : null,
    objectStoragePublicUrl:
      provider === 'r2'
        ? 'https://cdn.example/media'
        : provider === 's3'
          ? 'https://media.s3.us-east-1.amazonaws.com'
          : null,
  });
}

it('captures a migration destination without changing the active storage backend', async () => {
  const snapshot = {
    ...(await getSiteConfig({ strict: true })),
    storageProvider: 's3',
    objectStorageEndpoint: 'https://s3.eu-west-1.amazonaws.com',
    objectStorageBucket: 'migration-target',
    objectStorageRegion: 'eu-west-1',
    objectStoragePublicUrl: 'https://migration-target.s3.eu-west-1.amazonaws.com',
  };
  const target = await captureConfiguredStorageBackend(snapshot);
  snapshot.objectStorageBucket = 'changed-after-capture';
  await target.writeBuffer('migration/unique.txt', Buffer.from('copied'), 'text/plain');
  const active = await captureStorageBackend();
  await active.writeBuffer('active/unique.txt', Buffer.from('current'), 'text/plain');
  expect(storage.objects).toEqual([
    expect.objectContaining({
      bucket: 'migration-target',
      key: 'migration/unique.txt',
      body: 'copied',
    }),
    expect.objectContaining({ bucket: 'media', key: 'active/unique.txt', body: 'current' }),
  ]);
  expect(target.descriptor).not.toEqual(active.descriptor);
});

it('uses an explicit captured destination through the shared reference writer port', async () => {
  const configuration = {
    ...(await getSiteConfig({ strict: true })),
    storageProvider: 's3',
    objectStorageEndpoint: 'https://s3.eu-west-1.amazonaws.com',
    objectStorageBucket: 'probe-target',
    objectStorageRegion: 'eu-west-1',
    objectStoragePublicUrl: 'https://probe-target.s3.eu-west-1.amazonaws.com',
  };
  const writer = await captureSottoStorageWriter(configuration);
  configuration.objectStorageBucket = 'changed';
  const signal = new AbortController().signal;
  const url = await writer.write('probe/unique.txt', Buffer.from('probe'), 'text/plain', signal);
  expect(url).toBe('https://probe-target.s3.eu-west-1.amazonaws.com/probe/unique.txt');
  expect(storage.objects).toEqual([
    expect.objectContaining({ bucket: 'probe-target', key: 'probe/unique.txt', body: 'probe' }),
  ]);
});

it.each(['s3', 'r2'] as const)(
  'restores the configured historical %s slot when local storage is selected',
  async (provider) => {
    selectProvider(provider);
    const original = await captureStorageBackend();
    selectProvider('local');
    const restored = await restoreStorageBackend(original.descriptor);
    expect(storage.destinations.at(-1)).toEqual(
      provider === 's3'
        ? { endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1' }
        : { endpoint: 'https://test-account.r2.cloudflarestorage.com', region: 'auto' }
    );
    expect('writeBuffer' in restored).toBe(false);
    storage.objects = [{ bucket: 'media', key: 'recordings/history.wav', body: 'historical' }];
    storage.versions = [
      { bucket: 'media', key: 'recordings/history.wav', version: 'old' },
      { bucket: 'media', key: 'recordings/history.wav', version: 'marker', marker: true },
      { bucket: 'other', key: 'recordings/history.wav', version: 'keep' },
    ];
    const directory = await mkdtemp(join(tmpdir(), 'sotto-historical-object-'));
    try {
      const destination = join(directory, 'audio.wav');
      await restored.downloadToFile('recordings/history.wav', destination);
      expect(await readFile(destination, 'utf8')).toBe('historical');
      await restored.delete('recordings/history.wav');
      if (provider === 's3')
        expect(storage.versions).toEqual([
          { bucket: 'other', key: 'recordings/history.wav', version: 'keep' },
        ]);
      else expect(storage.objects).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it.each(['s3', 'r2'] as const)(
  'does not use another provider when historical %s credentials are missing',
  async (provider) => {
    selectProvider(provider);
    const original = await captureStorageBackend();
    selectProvider(provider === 's3' ? 'r2' : 's3');
    storage.missingCredentialProvider = provider;
    storage.destinations = [];
    await expect(restoreStorageBackend(original.descriptor)).rejects.toThrow(
      `No ${provider} credential`
    );
    expect(storage.destinations).toEqual([]);
  }
);

it.each(['s3', 'r2'])(
  'reads %s objects from the captured bucket after configuration changes',
  async (provider) => {
    selectProvider(provider as 's3' | 'r2');
    const backend = await captureStorageBackend();
    storage.objects.push(
      { bucket: 'media', key: 'audio.mp3', body: 'original audio' },
      { bucket: 'replacement', key: 'audio.mp3', body: 'wrong backend' }
    );
    storage.config.objectStorageBucket = 'replacement';
    const directory = await mkdtemp(join(tmpdir(), 'sotto-captured-read-'));
    try {
      const destination = join(directory, 'audio.mp3');
      await backend.downloadToFile('audio.mp3', destination);
      expect(await readFile(destination, 'utf8')).toBe('original audio');
      await expect(backend.downloadToFile('audio.mp3', destination)).rejects.toMatchObject({
        code: 'EEXIST',
      });
      await expect(
        backend.downloadToFile('https://foreign.example/audio.mp3', join(directory, 'foreign'))
      ).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it('retains cancelled multipart work until outstanding remote requests are resolved', async () => {
  const backend = await captureStorageBackend();
  let release!: () => void;
  let started!: () => void;
  let completed!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const remoteCompletion = new Promise<void>((resolve) => {
    completed = resolve;
  });
  storage.partGate = {
    started,
    completed,
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  const abort = new AbortController();
  const source = Readable.from([Buffer.alloc(6 * 1024 * 1024)]);
  const outcome = backend
    .writeStream('recordings/cancelled-parts.wav', source, 'audio/wav', abort.signal)
    .then(
      () => null,
      (error: unknown) => error
    );
  await waiting;
  try {
    abort.abort();
    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(source.destroyed).toBe(true);
    expect(storage.objects).toEqual([]);
    expect(await backend.has('recordings/cancelled-parts.wav')).toBe(true);
  } finally {
    release();
  }
  await remoteCompletion;
  await backend.delete('recordings/cancelled-parts.wav');
  expect(await backend.has('recordings/cancelled-parts.wav')).toBe(false);
  expect(storage.parts.size).toBe(0);
});

it('keeps an existing S3 object when multipart completion conflicts', async () => {
  const backend = await captureStorageBackend();
  storage.objects.push({ bucket: 'media', key: 'recordings/existing.wav', body: 'original' });
  await expect(
    backend.writeStream(
      'recordings/existing.wav',
      Readable.from([Buffer.alloc(6 * 1024 * 1024)]),
      'audio/wav'
    )
  ).rejects.toMatchObject({ name: 'PreconditionFailed' });
  expect(storage.objects).toEqual([
    { bucket: 'media', key: 'recordings/existing.wav', body: 'original' },
  ]);
  expect(storage.uploads.some((upload) => upload.key === 'recordings/existing.wav')).toBe(true);
});

it('preserves source failures and destroys pre-aborted sources before object creation', async () => {
  const backend = await captureStorageBackend();
  const failure = new Error('Recording source failed');
  const source = Readable.from(
    (async function* () {
      yield Buffer.from('partial');
      throw failure;
    })()
  );
  await expect(backend.writeStream('recordings/source.wav', source, 'audio/wav')).rejects.toBe(
    failure
  );
  expect(source.destroyed).toBe(true);
  const cancelled = Readable.from(['never written']);
  await expect(
    backend.writeStream('recordings/pre-aborted.wav', cancelled, 'audio/wav', AbortSignal.abort())
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled.destroyed).toBe(true);
  expect(storage.objects).toEqual([]);
  expect(storage.uploads).toEqual([]);
});

it('retains multipart failure evidence while another part is still in flight', async () => {
  const backend = await captureStorageBackend();
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  storage.partGate = {
    started,
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  storage.fault = 'denied';
  const source = Readable.from([Buffer.alloc(6 * 1024 * 1024)]);
  let settled = false;
  const outcome = backend.writeStream('recordings/in-flight.wav', source, 'audio/wav').then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    }
  );
  await waiting;
  try {
    expect(settled).toBe(false);
    expect(storage.objects).toEqual([]);
    expect(await backend.has('recordings/in-flight.wav')).toBe(true);
  } finally {
    release();
  }
  expect(await outcome).toMatchObject({ message: 'Upload part denied' });
  expect(source.destroyed).toBe(true);
  expect(await backend.has('recordings/in-flight.wav')).toBe(true);
});

it.each(['s3', 'r2'])(
  'streams multipart %s content to its captured destination',
  async (provider) => {
    selectProvider(provider as 's3' | 'r2');
    const backend = await captureStorageBackend();
    storage.config.objectStorageBucket = 'replacement';
    const content = Buffer.alloc(6 * 1024 * 1024, 's');
    const key = `episodes/owned/${crypto.randomUUID()}.mp3`;
    const url = await backend.writeStream(
      key,
      Readable.from([content.subarray(0, 1024), content.subarray(1024)]),
      'audio/mpeg'
    );
    expect(backend.normalize(url)).toBe(key);
    expect(storage.objects).toHaveLength(1);
    const stored = storage.objects[0]!;
    expect(stored.bucket).toBe('media');
    expect(stored.key).toBe(key);
    expect(createHash('sha256').update(stored.body!).digest('hex')).toBe(
      createHash('sha256').update(content).digest('hex')
    );
    expect(storage.uploads).toEqual([]);
  }
);

it('retains failed multipart uploads for the admitted cleanup target', async () => {
  const backend = await captureStorageBackend();
  storage.fault = 'denied';
  await expect(
    backend.writeStream(
      'recordings/failed.wav',
      Readable.from([Buffer.alloc(6 * 1024 * 1024)]),
      'audio/wav'
    )
  ).rejects.toThrow('Upload part denied');
  expect(storage.objects).toEqual([]);
  expect(await backend.has('recordings/failed.wav')).toBe(true);
  storage.fault = '';
  await backend.delete('recordings/failed.wav');
  expect(await backend.has('recordings/failed.wav')).toBe(false);
});

it('cancels a stalled object stream without creating a visible object', async () => {
  const backend = await captureStorageBackend();
  const abort = new AbortController();
  const source = new Readable({
    read() {
      abort.abort();
    },
  });
  await expect(
    backend.writeStream('recordings/cancelled.wav', source, 'audio/wav', abort.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(source.destroyed).toBe(true);
  expect(storage.objects).toEqual([]);
});

it.each(['s3', 'r2'])(
  'cleans unfinished %s uploads in the captured bucket before acknowledging deletion',
  async (provider) => {
    selectProvider(provider as 's3' | 'r2');
    storage.uploads = [
      { bucket: 'media', key: 'recordings/owned.wav', uploadId: 'one' },
      { bucket: 'media', key: 'recordings/owned.wav', uploadId: 'two' },
      { bucket: 'media', key: 'recordings/owned.wav.backup', uploadId: 'keep' },
      { bucket: 'replacement', key: 'recordings/owned.wav', uploadId: 'other' },
    ];
    const cleanup = await captureStorageCleanup();
    storage.config.objectStorageBucket = 'replacement';
    expect(await cleanup.has('recordings/owned.wav')).toBe(true);
    storage.fault = 'denied';
    await expect(cleanup.delete('recordings/owned.wav')).rejects.toThrow('Multipart abort denied');
    storage.fault = '';
    await cleanup.delete('recordings/owned.wav');
    expect(await cleanup.has('recordings/owned.wav')).toBe(false);
    expect(storage.uploads).toEqual([
      { bucket: 'media', key: 'recordings/owned.wav.backup', uploadId: 'keep' },
      { bucket: 'replacement', key: 'recordings/owned.wav', uploadId: 'other' },
    ]);
  }
);

it('preserves historical percent-encoded public references for newly written keys', async () => {
  selectProvider('r2');
  const captured = await captureStorageCleanup();
  if (captured.descriptor.kind !== 'object') throw new Error('Expected object storage');
  expect('writeBuffer' in captured).toBe(false);
  const backend = await captureStorageBackend({
    ...captured.descriptor,
    referenceEncoding: 'percent',
  });
  const key = 'avatars/owner/a b%2F.png';
  const url = await backend.writeBuffer(key, Buffer.from('avatar'), 'image/png');
  expect(url).toBe('https://cdn.example/media/avatars/owner/a%20b%252F.png');
  expect(backend.normalize(url)).toBe(key);
  expect(storage.objects[0]?.key).toBe(key);
});

it.each(['s3', 'r2'])(
  'keeps %s writes bound to their captured bucket and refuses overwrites',
  async (provider) => {
    selectProvider(provider as 's3' | 'r2');
    const backend = await captureStorageBackend();
    storage.config.objectStorageBucket = 'replacement';
    storage.config.objectStoragePublicUrl = 'https://replacement.example';
    const url = await backend.writeBuffer(
      'avatars/owner/unique.png',
      Buffer.from('original'),
      'image/png'
    );
    expect(url).toBe(
      provider === 's3'
        ? 'https://media.s3.us-east-1.amazonaws.com/avatars/owner/unique.png'
        : 'https://cdn.example/media/avatars/owner/unique.png'
    );
    await expect(
      backend.writeBuffer('avatars/owner/unique.png', Buffer.from('replacement'), 'image/png')
    ).rejects.toMatchObject({ name: 'PreconditionFailed' });
    expect(storage.objects).toEqual([
      {
        bucket: 'media',
        key: 'avatars/owner/unique.png',
        body: 'original',
        contentType: 'image/png',
      },
    ]);
  }
);

it('surfaces object write failures and rejects invalid or cancelled requests before creating content', async () => {
  const backend = await captureStorageBackend();
  storage.fault = 'denied';
  await expect(
    backend.writeBuffer('denied.bin', Buffer.from('content'), 'application/octet-stream')
  ).rejects.toThrow('Object writes denied');
  storage.fault = '';
  await expect(
    backend.writeBuffer('../escape.bin', Buffer.from('content'), 'application/octet-stream')
  ).rejects.toThrow();
  await expect(backend.writeBuffer('empty.bin', Buffer.from('content'), ' ')).rejects.toThrow(
    'content type'
  );
  await expect(
    backend.writeBuffer(
      'cancelled.bin',
      Buffer.from('content'),
      'application/octet-stream',
      AbortSignal.abort()
    )
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(storage.objects).toEqual([]);
});

it('verifies an exact root-level object including historical versions without matching its neighbours', async () => {
  storage.versions = [
    { bucket: 'media', key: 'avatar.png', version: 'deleted', marker: true },
    { bucket: 'media', key: 'avatar.png.backup', version: 'keep' },
  ];
  const cleanup = await captureStorageCleanup();
  expect(await cleanup.has('avatar.png')).toBe(true);
  await cleanup.delete('avatar.png');
  expect(await cleanup.has('avatar.png')).toBe(false);
  expect(storage.versions).toEqual([
    { bucket: 'media', key: 'avatar.png.backup', version: 'keep' },
  ]);
});

describe('captured object storage cleanup', () => {
  it('honors a historical encoded alias without confusing it with a literal-percent key', async () => {
    selectProvider('r2');
    storage.objects = [
      { bucket: 'media', key: 'recordings/hello world.wav' },
      { bucket: 'media', key: 'recordings/hello%20world.wav' },
    ];
    const current = await captureStorageCleanup();
    if (current.descriptor.kind !== 'object') throw new Error('Expected object storage');
    const restored = await captureStorageCleanup({
      ...current.descriptor,
      referenceEncoding: 'percent',
    });
    const key = restored.normalize('https://cdn.example/media/recordings/hello%20world.wav');
    expect(key).toBe('recordings/hello world.wav');
    await restored.delete(key);
    expect(storage.objects).toEqual([{ bucket: 'media', key: 'recordings/hello%20world.wav' }]);
  });
  it('preserves raw directory markers and never redirects their deletion to slashless objects', async () => {
    selectProvider('r2');
    storage.objects = [
      { bucket: 'media', key: 'recordings/' },
      { bucket: 'media', key: 'recordings' },
      { bucket: 'media', key: 'recordings/keep.wav' },
    ];
    const cleanup = await captureStorageCleanup();
    const keys: string[] = [];
    for await (const key of cleanup.list('recordings/')) keys.push(key);
    expect(keys).toEqual(['recordings/', 'recordings/keep.wav']);
    await cleanup.delete('recordings/');
    expect(storage.objects).toEqual([
      { bucket: 'media', key: 'recordings' },
      { bucket: 'media', key: 'recordings/keep.wav' },
    ]);
  });

  it('keeps cleanup unresolved when S3 returns an empty truncated version page', async () => {
    storage.fault = 'empty_versions';
    const cleanup = await captureStorageCleanup();
    await expect(cleanup.delete('recordings/owned.wav')).rejects.toThrow('did not advance');
  });
  it('refuses deletion during version discovery so pagination markers remain valid', async () => {
    storage.versions = [{ bucket: 'media', key: 'recordings/owned.wav', version: 'v1' }];
    const cleanup = await captureStorageCleanup();
    const listing = cleanup.list('recordings/');
    expect(await listing.next()).toEqual({ done: false, value: 'recordings/owned.wav' });
    await expect(cleanup.delete('recordings/owned.wav')).rejects.toThrow('Finish collecting');
    expect(storage.versions).toHaveLength(1);
    await listing.return(undefined);
    await cleanup.delete('recordings/owned.wav');
    expect(storage.versions).toEqual([]);
  });
  it('removes every S3 historical version and deletion marker while preserving neighbouring keys and buckets', async () => {
    storage.versions = [
      { bucket: 'media', key: 'episodes/owned/audio.mp3', version: 'one' },
      { bucket: 'media', key: 'episodes/owned/audio.mp3', version: 'two' },
      { bucket: 'media', key: 'episodes/owned/audio.mp3', version: 'three', marker: true },
      { bucket: 'media', key: 'episodes/owned/audio.mp3-backup', version: 'keep' },
      { bucket: 'other', key: 'episodes/owned/audio.mp3', version: 'keep' },
    ];
    const cleanup = await captureStorageCleanup();
    const keys: string[] = [];
    for await (const key of cleanup.list('episodes/owned/')) keys.push(key);
    expect(keys.filter((key) => key === 'episodes/owned/audio.mp3')).toHaveLength(3);
    storage.config.objectStorageBucket = 'other';
    await cleanup.delete('episodes/owned/audio.mp3', { force: true });
    await cleanup.delete('episodes/owned/audio.mp3', { force: true });
    expect(storage.versions).toEqual([
      { bucket: 'media', key: 'episodes/owned/audio.mp3-backup', version: 'keep' },
      { bucket: 'other', key: 'episodes/owned/audio.mp3', version: 'keep' },
    ]);
    await expect(captureStorageCleanup(structuredClone(cleanup.descriptor))).resolves.toMatchObject(
      {
        descriptor: cleanup.descriptor,
      }
    );
  });

  it('keeps retained historical bytes unresolved when the storage service denies deletion', async () => {
    storage.versions = [{ bucket: 'media', key: 'recordings/owned.wav', version: 'v1' }];
    const cleanup = await captureStorageCleanup();
    storage.fault = 'denied';
    await expect(cleanup.delete('recordings/owned.wav')).rejects.toThrow('retention forbids');
    expect(storage.versions).toEqual([
      { bucket: 'media', key: 'recordings/owned.wav', version: 'v1' },
    ]);
  });

  it('retains the scheduled public alias across a CDN change without changing the physical backend', async () => {
    selectProvider('r2');
    const cleanup = await captureStorageCleanup();
    storage.config.objectStoragePublicUrl = 'https://new-cdn.example';
    const restored = await captureStorageCleanup(structuredClone(cleanup.descriptor));
    expect(restored.normalize('https://cdn.example/media/recordings/100%.wav')).toBe(
      'recordings/100%.wav'
    );
    expect(() => restored.normalize('https://cdn.example/media-other/private')).toThrow();
  });

  it.each(['repeated', 'missing', 'outside'] as const)(
    'rejects a %s object listing response instead of acknowledging incomplete cleanup',
    async (fault) => {
      selectProvider('r2');
      storage.objects = [
        { bucket: 'media', key: 'recordings/one' },
        { bucket: 'media', key: 'recordings/b' },
      ];
      storage.fault = fault;
      const cleanup = await captureStorageCleanup();
      await expect(
        (async () => {
          for await (const key of cleanup.list('recordings/')) void key;
        })()
      ).rejects.toThrow(fault === 'outside' ? 'outside the cleanup prefix' : 'did not advance');
      expect(storage.objects).toHaveLength(2);
    }
  );
});
