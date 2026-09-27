import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';
import { startProvider, fixtureAudio } from './provider.mjs';

const root = resolve(import.meta.dirname, '..');
const base = new URL(process.env.SIDEDOOR_TEST_DATABASE_URL || 'postgresql://missing');
if (!['localhost', '127.0.0.1'].includes(base.hostname) || base.pathname !== '/sidedoor_test')
  throw new Error(
    'Browser tests require the isolated local SIDEDOOR_TEST_DATABASE_URL ending in /sidedoor_test'
  );
const name = `sotto_browser_${randomUUID().replaceAll('-', '')}`;
const directory = await mkdtemp(join(tmpdir(), 'sotto-browser-'));
const admin = new pg.Client({ connectionString: base.toString() });
const children = [];
let interrupted;
let redisAttempted = false;
let databaseCreated = false;
let provider;
let worker;
function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
function interrupt(signal) {
  interrupted = new Error(`Browser tests interrupted by ${signal}`);
  for (const child of [...children, ...(worker ? [worker] : [])]) {
    signalGroup(child, 'SIGTERM');
    setTimeout(() => signalGroup(child, 'SIGKILL'), 10_000).unref();
  }
}
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
async function stop(child) {
  signalGroup(child, 'SIGTERM');
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    signalGroup(child, 'SIGKILL');
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signalGroup(child, 'SIGKILL');
      resolve();
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      signalGroup(child, 'SIGKILL');
      resolve();
    });
  });
}
async function command(bin, args, env, capture = false, cwd = root, cleanup = false) {
  if (interrupted && !cleanup) throw interrupted;
  const child = spawn(bin, args, {
    cwd,
    env,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    detached: true,
  });
  children.push(child);
  let output = '';
  if (capture)
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
  await new Promise((ok, fail) => {
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? ok() : fail(interrupted || new Error(`${bin} ${args.join(' ')} exited ${code}`))
    );
  });
  return output.trim();
}
let failure;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  databaseCreated = true;
  redisAttempted = true;
  await command(
    'docker',
    ['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::6379', 'redis:7-alpine'],
    process.env
  );
  const redisPort = (await command('docker', ['port', name, '6379/tcp'], process.env, true))
    .split(':')
    .at(-1);
  const probe = createServer();
  await new Promise((ok) => probe.listen(0, '127.0.0.1', ok));
  const port = probe.address().port;
  await new Promise((ok) => probe.close(ok));
  provider = await startProvider();
  const db = new URL(base);
  db.pathname = `/${name}`;
  await mkdir(join(directory, 'storage'));
  await writeFile(join(directory, 'microphone.wav'), fixtureAudio());
  const env = {
    ...process.env,
    DATABASE_URL: db.toString(),
    DIRECT_DATABASE_URL: db.toString(),
    REDIS_URL: `redis://127.0.0.1:${redisPort}/0`,
    SELF_HOSTED: 'true',
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    BYOK_ENCRYPTION_KEY: '1'.repeat(64),
    SIDEDOOR_EXECUTION_DIR: join(directory, 'executions'),
    SIDEDOOR_PASSWORD_ORIGINS: '[]',
    SIDEDOOR_TRUSTED_PROXY: 'false',
    SOTTO_BROWSER_DIRECTORY: directory,
    SOTTO_BROWSER_PROVIDER: provider.url,
    SOTTO_BROWSER_PORT: String(port),
  };
  await command(
    'npx',
    ['--no-install', 'prisma', 'migrate', 'deploy', '--schema=apps/web/prisma/schema.prisma'],
    env
  );
  await command(
    'npx',
    ['--no-install', 'tsx', '--tsconfig', 'apps/web/tsconfig.json', 'apps/web/e2e/seed.ts'],
    env
  );
  await command('npm', ['run', 'build'], { ...env, SOTTO_ENV_FILE: join(directory, 'absent.env') });
  worker = spawn(resolve(root, 'node_modules/.bin/tsx'), ['src/workers/index.ts'], {
    cwd: resolve(root, 'apps/web'),
    env: { ...env, WORKER_PROFILE: 'pipeline', WORKER_QUEUES: 'speaking-grading' },
    stdio: 'inherit',
    detached: true,
  });
  worker.on('error', (error) => {
    failure = error;
  });
  await command(
    'npx',
    ['--no-install', 'playwright', 'test', '--config=e2e/playwright.config.ts'],
    env
  );
  if (provider.unexpected.length)
    throw new Error(`Unexpected provider traffic: ${JSON.stringify(provider.unexpected)}`);
  if (worker.exitCode !== null || worker.signalCode !== null)
    throw new Error('Speaking worker exited before browser tests finished');
} catch (error) {
  failure = error;
} finally {
  if (provider?.unexpected.length)
    console.error('Unexpected provider traffic:', provider.unexpected);
  const results = await Promise.allSettled([
    ...children.map(stop),
    ...(worker ? [stop(worker)] : []),
    ...(provider ? [provider.close()] : []),
  ]);
  results.push(
    ...(await Promise.allSettled([
      ...(redisAttempted
        ? [command('docker', ['rm', '-f', name], process.env, false, root, true)]
        : []),
      ...(databaseCreated ? [admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)] : []),
      rm(directory, { recursive: true, force: true }),
    ]))
  );
  results.push(...(await Promise.allSettled([admin.end()])));
  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (errors.length) {
    console.error('Browser cleanup failed:', errors);
    failure ||= new AggregateError(errors, 'Browser cleanup failed');
  }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
if (failure || interrupted) throw failure || interrupted;
