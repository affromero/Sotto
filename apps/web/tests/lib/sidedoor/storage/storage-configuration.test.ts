// @vitest-environment node
import { Readable } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  getObjectStorageConfig,
  planStorageDestination,
} from '@/lib/storage/sidedoor/configuration';
import { EMPTY_INFRA, type ServerInfraConfig } from '@/lib/site-config';

const mockResolveCredential = vi.fn().mockResolvedValue({
  values: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
});

vi.mock('@/lib/sidedoor/credentials/runtime/provider-credentials', () => ({
  resolveSottoInstanceStorageCredential: (...args: unknown[]) => mockResolveCredential(...args),
}));
vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: (_database: unknown, operation: (tx: unknown) => unknown) => operation({}),
}));
vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));
vi.mock('@/lib/server-config', () => ({
  infra: () => {
    throw new Error('Tests must pass an explicit shared configuration snapshot');
  },
}));

beforeEach(() => {
  mockResolveCredential.mockClear();
});

function configuration(overrides: Partial<ServerInfraConfig>): ServerInfraConfig {
  return { ...EMPTY_INFRA, ...overrides };
}

it('plans a missing local destination without creating it', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'sotto-storage-plan-'));
  try {
    const root = join(parent, 'new-storage');
    expect(
      planStorageDestination(configuration({ storageProvider: 'local', localStorageRoot: root }))
    ).toMatchObject({ kind: 'local', root });
    expect(await readdir(parent)).toEqual([]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

it('plans an object destination without resolving its credential', () => {
  const target = configuration({
    storageProvider: 's3',
    objectStorageEndpoint: 'https://s3.eu-west-1.amazonaws.com',
    objectStorageBucket: 'planned-bucket',
    objectStorageRegion: 'eu-west-1',
  });
  const planned = planStorageDestination(target);
  target.objectStorageBucket = 'changed';
  expect(planned).toMatchObject({
    provider: 's3',
    location: {
      bucket: 'planned-bucket',
      endpoint: 'https://s3.eu-west-1.amazonaws.com',
    },
  });
  expect(mockResolveCredential).not.toHaveBeenCalled();
});

it('uses the captured shared location and owned credential despite SDK environment overrides', async () => {
  vi.stubEnv('AWS_ENDPOINT_URL_S3', 'https://unexpected-storage.example');
  vi.stubEnv('AWS_ENDPOINT_URL', 'https://other-storage.example');
  const storage = await getObjectStorageConfig(
    configuration({
      storageProvider: 's3',
      objectStorageEndpoint: 'https://s3.us-east-1.amazonaws.com',
      objectStorageBucket: 'historical-media',
      objectStorageRegion: 'us-east-1',
    })
  );
  const destinations: string[] = [];
  storage.client.config.requestHandler = {
    handle: async (request: { hostname: string }) => {
      destinations.push(request.hostname);
      return {
        response: {
          statusCode: 200,
          headers: {},
          body: Readable.from(['historical bytes']),
        },
      };
    },
  };
  try {
    const result = await storage.client.send(
      new GetObjectCommand({ Bucket: storage.bucket, Key: 'recordings/old.wav' })
    );
    expect(await result.Body?.transformToString()).toBe('historical bytes');
    expect(destinations).toEqual(['historical-media.s3.us-east-1.amazonaws.com']);
    expect(mockResolveCredential).toHaveBeenCalledWith({}, 's3');
  } finally {
    storage.client.destroy();
    vi.unstubAllEnvs();
  }
});

it('accepts a one-use credential for setup probing without reading stored secrets', async () => {
  const storage = await getObjectStorageConfig(
    configuration({
      storageProvider: 'r2',
      objectStorageEndpoint: 'https://account.r2.cloudflarestorage.com',
      objectStorageBucket: 'media',
      objectStorageRegion: 'auto',
    }),
    { accessKeyId: 'probe-id', secretAccessKey: 'probe-secret' }
  );
  storage.client.destroy();
  expect(mockResolveCredential).not.toHaveBeenCalled();
});
