import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Redis from 'ioredis';

/** Refuse a server that won the reserved port before our child started. */
export async function verifyPrivateRedisIdentity(client: Redis, server: ChildProcess) {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null)
    throw new Error('Private Redis child is not running');
  const info = await client.info('server');
  const match = /^process_id:(\d+)\r?$/m.exec(info);
  if (
    !match ||
    Number(match[1]) !== server.pid ||
    server.exitCode !== null ||
    server.signalCode !== null
  )
    throw new Error('Redis server does not match the private child');
}

async function stopChild(child: ChildProcess) {
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };
    const onExit = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    child.once('exit', onExit);
    child.once('error', onError);
    timer = setTimeout(() => {
      if (!child.kill('SIGKILL')) {
        onError(new Error('Could not stop private Redis'));
        return;
      }
      timer = setTimeout(() => onError(new Error('Private Redis did not exit')), 5000);
    }, 5000);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
    else if (!child.kill('SIGTERM')) onError(new Error('Could not stop private Redis'));
  });
}

/** Each fixture owns a Redis child and a TCP endpoint that never changes owner. */
export async function createPrivateRedis() {
  const directory = await mkdtemp(join(tmpdir(), 'sdr-'));
  const identity = await lstat(directory);
  const socketPath = join(directory, 's');
  const sockets = new Set<Socket>();
  let failed = false;
  let cleaned = false;
  let directoryRemoved = false;
  let closing: Promise<void> | undefined;
  let child: ChildProcess | undefined;
  let client: Redis | undefined;
  let proxyFailure: Error | undefined;
  const destroySockets = () => {
    for (const socket of sockets) socket.destroy();
  };
  const proxy = createServer((incoming) => {
    if (failed) {
      incoming.destroy();
      return;
    }
    const upstream = createConnection(socketPath);
    sockets.add(incoming);
    sockets.add(upstream);
    incoming.on('error', () => upstream.destroy());
    upstream.on('error', () => incoming.destroy());
    incoming.once('close', () => {
      sockets.delete(incoming);
      upstream.destroy();
    });
    upstream.once('close', () => {
      sockets.delete(upstream);
      incoming.destroy();
    });
    upstream.once('connect', () => {
      if (failed) {
        incoming.destroy();
        upstream.destroy();
        return;
      }
      incoming.pipe(upstream).pipe(incoming);
    });
  });
  proxy.on('error', (error) => {
    proxyFailure = error;
    failed = true;
    destroySockets();
  });
  const close = () => {
    if (closing) return closing;
    failed = true;
    client?.disconnect();
    destroySockets();
    closing = (async () => {
      if (child) await stopChild(child);
      if (!directoryRemoved) {
        const current = await lstat(directory);
        if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino)
          throw new Error('Private Redis directory identity changed');
        await rm(directory, { recursive: true });
        directoryRemoved = true;
      }
      if (proxy.listening)
        await new Promise<void>((resolve, reject) =>
          proxy.close((error) => (error ? reject(error) : resolve()))
        );
      cleaned = true;
      if (proxyFailure) throw proxyFailure;
    })().catch((error: unknown) => {
      if (!cleaned) closing = undefined;
      throw error;
    });
    return closing;
  };
  try {
    if (
      !identity.isDirectory() ||
      (identity.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === 'function' && identity.uid !== process.getuid())
    )
      throw new Error('Private Redis directory permissions are invalid');
    if (Buffer.byteLength(socketPath) >= 104)
      throw new Error('Private Redis socket path is too long');
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', () => {
        proxy.removeListener('error', reject);
        resolve();
      });
    });
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Loopback port required');
    child = spawn(
      'redis-server',
      [
        '--port',
        '0',
        '--unixsocket',
        socketPath,
        '--unixsocketperm',
        '700',
        '--save',
        '',
        '--appendonly',
        'no',
      ],
      { stdio: 'ignore' }
    );
    const server = child;
    server.on('exit', () => {
      failed = true;
      destroySockets();
    });
    server.on('error', () => {
      failed = true;
      destroySockets();
    });
    const url = `redis://127.0.0.1:${address.port}/0`;
    client = new Redis(url, {
      commandTimeout: 5000,
      connectTimeout: 1000,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => (attempt < 100 ? 20 : null),
    });
    client.on('error', () => undefined);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Private Redis startup timed out')), 5000);
      client!.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
      server.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Private Redis exited'));
      });
    });
    await verifyPrivateRedisIdentity(client, server);
    return { client, url, close, server };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Private Redis startup and cleanup failed');
    }
    throw error;
  }
}
