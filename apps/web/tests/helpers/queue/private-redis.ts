import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import Redis from 'ioredis';

/** Each fixture owns a separate Redis process and its complete disposable DB0. */
export async function createPrivateRedis() {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Loopback port required');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve()))
  );
  const process = spawn(
    'redis-server',
    ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no'],
    { stdio: 'ignore' }
  );
  const url = `redis://127.0.0.1:${port}/0`;
  const client = new Redis(url, {
    commandTimeout: 5000,
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => (attempt < 100 ? 20 : null),
  });
  client.on('error', () => undefined);
  const close = async () => {
    client.disconnect();
    if (process.exitCode === null) {
      const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
      process.kill('SIGTERM');
      await exited;
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Private Redis startup timed out')), 5000);
      client.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
      process.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      process.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Private Redis exited'));
      });
    });
    return { client, url, close };
  } catch (error) {
    await close();
    throw error;
  }
}
