// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createPrivateRedis, verifyPrivateRedisIdentity } from '../../helpers/queue/private-redis';
import privateRedisEnvironment from '../../helpers/queue/private-redis-environment';

it('removes its private directory if the Redis executable cannot start', async () => {
  const root = await mkdtemp('/tmp/sdr-startup-test-');
  vi.stubEnv('TMPDIR', root);
  vi.stubEnv('PATH', join(root, 'missing'));
  try {
    await expect(createPrivateRedis()).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(root)).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects a Redis connection served by a different child', async () => {
  const first = await createPrivateRedis();
  let second: Awaited<ReturnType<typeof createPrivateRedis>> | undefined;
  try {
    second = await createPrivateRedis();
    await expect(verifyPrivateRedisIdentity(first.client, first.server)).resolves.toBeUndefined();
    await expect(verifyPrivateRedisIdentity(first.client, second.server)).rejects.toThrow(
      'Redis server does not match the private child'
    );
  } finally {
    try {
      await second?.close();
    } finally {
      await first.close();
    }
  }
});

it('closes its private Redis and restores the previous URL on teardown', async () => {
  vi.stubEnv('SIDEDOOR_TEST_DATABASE_URL', 'fixture');
  vi.stubEnv('SIDEDOOR_TEST_REDIS_URL', undefined);
  vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:12345/0');
  const isolatedGlobal = { console: {} };
  let environment: Awaited<ReturnType<typeof privateRedisEnvironment.setup>> | undefined;
  let current: string | undefined;
  let restored: string | undefined;
  try {
    environment = await privateRedisEnvironment.setup(isolatedGlobal, {});
    current = process.env.SOTTO_TEST_PRIVATE_REDIS_URL;
    expect(current).toBeDefined();
    expect(process.env.REDIS_URL).toBe(current);
  } finally {
    try {
      await environment?.teardown(isolatedGlobal);
      restored = process.env.REDIS_URL;
    } finally {
      vi.unstubAllEnvs();
    }
  }
  expect(restored).toBe('redis://127.0.0.1:12345/0');
  if (!current) throw new Error('Private Redis URL missing');
  const url = new URL(current);
  const listening = await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
  expect(listening).toBe(false);
});

it('does not trust an inherited private Redis marker when isolation is disabled', async () => {
  vi.stubEnv('SOTTO_TEST_PRIVATE_REDIS_URL', 'redis://127.0.0.1:12345/0');
  vi.stubEnv('SIDEDOOR_TEST_REDIS_URL', undefined);
  vi.stubEnv('SIDEDOOR_TEST_DATABASE_URL', undefined);
  const isolatedGlobal = { console: {} };
  try {
    const environment = await privateRedisEnvironment.setup(isolatedGlobal, {});
    try {
      expect(process.env.SOTTO_TEST_PRIVATE_REDIS_URL).toBeUndefined();
    } finally {
      await environment.teardown(isolatedGlobal);
    }
    expect(process.env.SOTTO_TEST_PRIVATE_REDIS_URL).toBe('redis://127.0.0.1:12345/0');
  } finally {
    vi.unstubAllEnvs();
  }
});

it('closes after its Redis process has already stopped from a signal', async () => {
  const fixture = await createPrivateRedis();
  const port = Number(new URL(fixture.url).port);
  const contender = createServer();
  try {
    const payload = Buffer.alloc(1024 * 1024, 0xa7);
    await fixture.client.set('binary', payload);
    expect(await fixture.client.getBuffer('binary')).toEqual(payload);
    const exited = new Promise<void>((resolve) => fixture.server.once('exit', () => resolve()));
    if (!fixture.server.kill('SIGKILL')) throw new Error('Could not stop private Redis');
    await exited;
    const binding = await new Promise<Error | null>((resolve) => {
      contender.once('error', resolve);
      contender.listen(port, '127.0.0.1', () => resolve(null));
    });
    expect(binding).toMatchObject({ code: 'EADDRINUSE' });
    await expect(fixture.client.set('after-exit', 'unexpected')).rejects.toThrow();
    await expect(Promise.all([fixture.close(), fixture.close()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  } finally {
    if (contender.listening) await new Promise<void>((resolve) => contender.close(() => resolve()));
    await fixture.close();
  }
}, 10000);

it('keeps the private endpoint reserved when child shutdown cannot be confirmed', async () => {
  const fixture = await createPrivateRedis();
  const contender = createServer();
  const kill = vi.spyOn(fixture.server, 'kill').mockReturnValueOnce(false);
  try {
    await expect(fixture.close()).rejects.toThrow('Could not stop private Redis');
    const port = Number(new URL(fixture.url).port);
    const binding = await new Promise<Error | null>((resolve) => {
      contender.once('error', resolve);
      contender.listen(port, '127.0.0.1', () => resolve(null));
    });
    expect(binding).toMatchObject({ code: 'EADDRINUSE' });
  } finally {
    kill.mockRestore();
    if (contender.listening) await new Promise<void>((resolve) => contender.close(() => resolve()));
    await fixture.close();
  }
});

it('bounds shutdown and retains the endpoint when the child never exits', async () => {
  const fixture = await createPrivateRedis();
  const contender = createServer();
  const kill = vi.spyOn(fixture.server, 'kill').mockReturnValue(true);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const closing = fixture.close().then(
      () => null,
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(await closing).toMatchObject({ message: 'Private Redis did not exit' });
    const port = Number(new URL(fixture.url).port);
    const binding = await new Promise<Error | null>((resolve) => {
      contender.once('error', resolve);
      contender.listen(port, '127.0.0.1', () => resolve(null));
    });
    expect(binding).toMatchObject({ code: 'EADDRINUSE' });
  } finally {
    vi.useRealTimers();
    kill.mockRestore();
    if (contender.listening) await new Promise<void>((resolve) => contender.close(() => resolve()));
    await fixture.close();
  }
});

it('keeps the endpoint reserved when its owned directory is unavailable', async () => {
  const fixture = await createPrivateRedis();
  const contender = createServer();
  let directory: string | undefined;
  let moved: string | undefined;
  let renamed = false;
  try {
    const configuration = await fixture.client.config('GET', 'unixsocket');
    if (!Array.isArray(configuration) || typeof configuration[1] !== 'string')
      throw new Error('Private Redis socket path missing');
    directory = dirname(configuration[1]);
    moved = `${directory}-moved-${randomUUID()}`;
    await rename(directory, moved);
    renamed = true;
    await expect(fixture.close()).rejects.toMatchObject({ code: 'ENOENT' });
    const port = Number(new URL(fixture.url).port);
    const binding = await new Promise<Error | null>((resolve) => {
      contender.once('error', resolve);
      contender.listen(port, '127.0.0.1', () => resolve(null));
    });
    expect(binding).toMatchObject({ code: 'EADDRINUSE' });
  } finally {
    if (contender.listening) await new Promise<void>((resolve) => contender.close(() => resolve()));
    if (renamed && moved && directory) await rename(moved, directory);
    await fixture.close();
  }
});
