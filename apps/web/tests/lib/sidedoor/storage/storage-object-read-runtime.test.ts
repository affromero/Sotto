// @vitest-environment node
import { createServer, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareStorageBackend, StorageReadCleanupError } from 'thesidedoor-core/storage';
import { captureStorageBackend, readAttributedStorageRange } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

const boundary = vi.hoisted(() => ({
  endpoint: '',
  destroy: [] as (() => void)[],
  provider: 's3',
  storage: null as null | { input: unknown; backend: { descriptor: unknown } },
  permitted: true,
}));
vi.mock('@/lib/sidedoor/storage/core/storage-inputs', () => ({
  resolveStorageInput: async () => {
    if (!boundary.storage) throw new Error('Missing storage attribution');
    return boundary.storage;
  },
}));
vi.mock('@/lib/storage/sidedoor/local-object-access', () => ({
  canReadLocalObjectConsumer: async () => boundary.permitted,
}));
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: async () => ({
    storageProvider: boundary.provider,
    objectStorageEndpoint: boundary.endpoint,
    objectStorageBucket: 'media',
    objectStorageRegion: 'us-east-1',
    objectStoragePublicUrl: null,
  }),
}));
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
    credentialRevision: '00000000-0000-4000-8000-000000000001',
    values: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  }),
  resolveSottoInstanceStorageCredentialRevision: async () => ({
    credentialRevision: '00000000-0000-4000-8000-000000000001',
    values: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  }),
}));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...sdk,
    S3Client: class extends sdk.S3Client {
      constructor(options: ConstructorParameters<typeof sdk.S3Client>[0]) {
        super({ ...options, endpoint: boundary.endpoint, forcePathStyle: true, maxAttempts: 1 });
        boundary.destroy.push(() => this.destroy());
      }
    },
  };
});

describe('captured storage reads with the real S3 SDK', () => {
  let directory: string;
  let respond: (response: ServerResponse) => void;
  let requests: string[];
  let requestedRange: string | undefined;
  let requestedEtag: string | undefined;
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    requestedRange = request.headers.range;
    requestedEtag = request.headers['if-match'];
    request.resume();
    respond(response);
  });
  beforeEach(async () => {
    requests = [];
    requestedRange = undefined;
    requestedEtag = undefined;
    directory = await mkdtemp(join(tmpdir(), 'sotto-sdk-read-'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server');
    boundary.endpoint = `http://127.0.0.1:${address.port}`;
    boundary.provider = 's3';
    boundary.storage = null;
    boundary.permitted = true;
  });
  afterEach(async () => {
    for (const destroy of boundary.destroy.splice(0)) destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(directory, { recursive: true, force: true });
  });
  it('copies real SDK body bytes from the captured bucket', async () => {
    const bytes = Buffer.from([0, 255, 128, 10]);
    respond = (response) => {
      response.writeHead(200, { 'Content-Length': String(bytes.length) });
      response.end(bytes);
    };
    const backend = await captureStorageBackend();
    const destination = join(directory, 'audio');
    expect(await backend.downloadToFile('audio.mp3', destination)).toEqual({
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(await readFile(destination)).toEqual(bytes);
    expect(requests.map((request) => request.split('?')[0])).toEqual(['GET /media/audio.mp3']);
  });
  it('reads only the requested range from the captured object destination', async () => {
    respond = (response) => {
      response.writeHead(206, {
        'Content-Length': '4',
        'Content-Range': 'bytes 2-5/10',
        ETag: '"original"',
        'x-amz-version-id': 'version-a',
      });
      response.end('2345');
    };
    const backend = await captureStorageBackend();
    const stored = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
    const input = {
      consumer: 'recording:recording:audio',
      reference: 'audio.mp3',
      assetId: 'a'.repeat(64),
      backendId: stored.id,
      binding: stored.binding,
      key: 'audio.mp3',
    };
    boundary.storage = { input, backend: { descriptor: backend.descriptor } };
    await expect(
      readAttributedStorageRange({
        input: { ...input, key: 'other.mp3' },
        descriptor: backend.descriptor,
        execution: { userId: 'learner', authorize: async () => ({ userId: 'learner' }) },
        start: 2,
        end: 5,
      })
    ).rejects.toThrow('Storage attribution changed');
    expect(requests).toEqual([]);
    boundary.permitted = false;
    await expect(
      readAttributedStorageRange({
        input,
        descriptor: backend.descriptor,
        execution: { userId: 'other', authorize: async () => ({ userId: 'other' }) },
        start: 2,
        end: 5,
      })
    ).rejects.toThrow('Storage consumer is not authorized');
    expect(requests).toEqual([]);
    boundary.permitted = true;
    const result = await readAttributedStorageRange({
      input,
      descriptor: backend.descriptor,
      execution: { userId: 'learner', authorize: async () => ({ userId: 'learner' }) },
      start: 2,
      end: 5,
    });
    expect(requestedRange).toBe('bytes=2-5');
    expect(result).toMatchObject({ body: Buffer.from('2345'), start: 2, end: 5, size: 10 });
    expect(result?.identity).toEqual({
      kind: 'object',
      etag: '"original"',
      versionId: 'version-a',
    });
    respond = (response) => {
      response.writeHead(206, {
        'Content-Length': '4',
        'Content-Range': 'bytes 2-5/10',
        ETag: '"changed"',
        'x-amz-version-id': 'version-b',
      });
      response.end('abcd');
    };
    await expect(
      readAttributedStorageRange({
        input,
        descriptor: backend.descriptor,
        execution: { userId: 'learner', authorize: async () => ({ userId: 'learner' }) },
        start: 2,
        end: 5,
        expectedIdentity: result!.identity,
      })
    ).rejects.toThrow('Stored object identity changed');
    expect(requestedEtag).toBe('"original"');
    expect(requests.at(-1)).toContain('versionId=version-a');
  });

  it('closes an interrupted range read without returning partial bytes', async () => {
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let closed = false;
    respond = (response) => {
      response.on('close', () => {
        closed = true;
      });
      response.writeHead(206, {
        'Content-Length': '4',
        'Content-Range': 'bytes 0-3/4',
        ETag: '"version"',
      });
      response.write('ab');
      entered();
    };
    const backend = await captureStorageBackend();
    const stored = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
    const input = {
      consumer: 'recording:recording:audio',
      reference: 'audio.mp3',
      assetId: 'a'.repeat(64),
      backendId: stored.id,
      binding: stored.binding,
      key: 'audio.mp3',
    };
    boundary.storage = { input, backend: { descriptor: backend.descriptor } };
    const controller = new AbortController();
    const read = readAttributedStorageRange({
      input,
      descriptor: backend.descriptor,
      execution: {
        userId: 'learner',
        signal: controller.signal,
        authorize: async () => ({ userId: 'learner' }),
      },
      start: 0,
      end: 3,
    });
    await ready;
    controller.abort();
    await expect(read).rejects.toThrow();
    await expect.poll(() => closed).toBe(true);
  });
  it('cancels a pending cleanup inventory through the real SDK transport', async () => {
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let closed = false;
    respond = (response) => {
      response.on('close', () => {
        closed = true;
      });
      entered();
    };
    const backend = await captureStorageBackend();
    const controller = new AbortController();
    const result = expect(
      backend.has('storage-probes/test.txt', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    await ready;
    controller.abort();
    await result;
    await expect.poll(() => closed).toBe(true);
    expect(requests[0]).toContain('versions');
  });

  it('cancels a pending object DELETE through the real SDK transport', async () => {
    boundary.provider = 'r2';
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let closed = false;
    respond = (response) => {
      if (requests.at(-1)?.startsWith('DELETE ')) {
        response.on('close', () => {
          closed = true;
        });
        entered();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(
        '<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>'
      );
    };
    const backend = await captureStorageBackend();
    const controller = new AbortController();
    const result = expect(
      backend.delete('storage-probes/test.txt', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await ready;
    controller.abort();
    await result;
    await expect.poll(() => closed).toBe(true);
    expect(requests.at(-1)?.split('?')[0]).toBe('DELETE /media/storage-probes/test.txt');
  });
  it('retains typed cleanup uncertainty for a truncated SDK response', async () => {
    respond = (response) => {
      response.writeHead(200, { 'Content-Length': '100' });
      response.flushHeaders();
      response.write('partial');
      setTimeout(() => response.destroy(), 30);
    };
    const backend = await captureStorageBackend();
    const destination = join(directory, 'audio');
    await expect(backend.downloadToFile('audio.mp3', destination)).rejects.toMatchObject({
      errors: [expect.any(Error), expect.any(StorageReadCleanupError)],
    });
    expect(await readFile(destination, 'utf8')).toBe('partial');
  });
  it('cancels a pending SDK body and preserves the caller reason with cleanup evidence', async () => {
    let entered: (() => void) | undefined;
    let closed = false;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    respond = (response) => {
      response.on('close', () => {
        closed = true;
      });
      response.writeHead(200, { 'Content-Length': '100' });
      response.flushHeaders();
      entered!();
    };
    const backend = await captureStorageBackend();
    const controller = new AbortController();
    const reason = new Error('Worker stopped');
    const destination = join(directory, 'audio');
    const outcome = backend.downloadToFile('audio.mp3', destination, controller.signal).then(
      () => undefined,
      (error) => error as unknown
    );
    await ready;
    await expect
      .poll(async () =>
        readFile(destination).then(
          () => true,
          () => false
        )
      )
      .toBe(true);
    controller.abort(reason);
    const error = await outcome;
    expect(
      error === reason || (error instanceof AggregateError && error.errors.includes(reason))
    ).toBe(true);
    await expect.poll(() => closed).toBe(true);
  });
  it('closes a received SDK body without overwriting an existing destination', async () => {
    let closed = false;
    respond = (response) => {
      response.on('close', () => {
        closed = true;
      });
      response.writeHead(200, { 'Content-Length': '100' });
      response.flushHeaders();
      response.write('partial');
    };
    const backend = await captureStorageBackend();
    const destination = join(directory, 'existing');
    await writeFile(destination, 'preserved');
    const failure = await backend
      .downloadToFile('audio.mp3', destination)
      .catch((error) => error as unknown);
    expect(failure instanceof AggregateError ? failure.errors[0] : failure).toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(destination, 'utf8')).toBe('preserved');
    await expect.poll(() => closed).toBe(true);
  });
  it('cancels before SDK headers arrive without creating a destination', async () => {
    let entered: (() => void) | undefined;
    let closed = false;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    respond = (response) => {
      response.on('close', () => {
        closed = true;
      });
      entered!();
    };
    const backend = await captureStorageBackend();
    const controller = new AbortController();
    const reason = new Error('Stop before headers');
    const destination = join(directory, 'audio');
    const outcome = backend
      .downloadToFile('audio.mp3', destination, controller.signal)
      .catch((error) => error as unknown);
    await ready;
    controller.abort(reason);
    const failure = await outcome;
    expect(
      failure === reason || (failure instanceof AggregateError && failure.errors.includes(reason))
    ).toBe(true);
    await expect.poll(() => closed).toBe(true);
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('copies a complete empty object with a valid SDK body', async () => {
    respond = (response) => {
      response.writeHead(200, { 'Content-Length': '0' });
      response.end();
    };
    const backend = await captureStorageBackend();
    const destination = join(directory, 'empty');
    expect(await backend.downloadToFile('empty.mp3', destination)).toEqual({
      bytes: 0,
      sha256: createHash('sha256').digest('hex'),
    });
    expect(await readFile(destination)).toHaveLength(0);
  });
});
