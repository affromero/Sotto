// @vitest-environment node
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrivateRedis } from '../../../helpers/queue/private-redis';

describe('retained review inventory channel', () => {
  let redis: Awaited<ReturnType<typeof createPrivateRedis>>;
  beforeAll(async () => {
    redis = await createPrivateRedis();
  });
  afterAll(async () => {
    await redis?.close();
  });

  it('refuses duplicate queue identities without changing the Redis database', async () => {
    await redis.client.set('retained-fixture', 'preserved');
    const before = await redis.client.dump('retained-fixture');
    const hash = 'a'.repeat(64);
    const evidence = {
      schemaVersion: 1,
      namespace: 'sotto-platform-v2',
      databaseIdentityHash: hash,
      storageIdentityHash: hash,
      jobs: [1, 2, 3].map((number) => ({
        id: `00000000-0000-4000-8000-00000000000${number}`,
        fingerprint: hash,
        delivered: true,
        jobHash: hash,
        payloadHash: hash,
        scopesHash: hash,
        classHash: hash,
        courseHash: hash,
        profileHash: hash,
        classUpdatedAt: 1,
        currentClassUpdatedAt: 2,
        worksheetReferenceHash: hash,
      })),
    };
    const policy = {
      schemaVersion: 1,
      webHeapMiB: 256,
      workerHeapMiB: 512,
      helperHeapMiB: 192,
      queueConcurrency: 1,
      privacyContactEmail: 'operator@example.com',
    };
    const outcome = await new Promise<{ code: number | null; errors: string; fences: number }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--require',
            'tsx/cjs',
            '-e',
            'require("../../scripts/deploy/review/runtime/channel.ts").main().catch(error=>{console.error(error);process.exit(1)})',
          ],
          {
            env: {
              ...process.env,
              REDIS_URL: redis.url,
              DATABASE_URL: 'postgresql://unreachable:fixture@127.0.0.1:1/unreachable',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        );
        let output = '';
        let errors = '';
        let fences = 0;
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Retained inventory channel timed out'));
        }, 20_000);
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          while (output.includes('\n')) {
            const end = output.indexOf('\n');
            const line = output.slice(0, end);
            output = output.slice(end + 1);
            if (!line.startsWith('SOTTO_REVIEW_IPC=')) continue;
            const event = JSON.parse(line.slice('SOTTO_REVIEW_IPC='.length));
            if (event.type !== 'fence') {
              child.kill('SIGKILL');
              reject(new Error('Unexpected retained inventory event'));
              return;
            }
            fences++;
            child.stdin.write(JSON.stringify({ type: 'ack', id: event.id }) + '\n');
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          errors += chunk.toString();
        });
        child.once('error', reject);
        child.once('close', (code) => {
          clearTimeout(timeout);
          resolve({ code, errors, fences });
        });
        child.stdin.write(
          JSON.stringify({
            mode: 'retained-inventory',
            input: { evidence, queues: ['worksheet-pdf', 'worksheet-pdf'] },
            policy,
          }) + '\n'
        );
      }
    );
    expect(outcome.code).toBe(1);
    expect(outcome.fences).toBe(1);
    expect(outcome.errors).toContain('Ordered unique queues required');
    expect(await redis.client.dbsize()).toBe(1);
    expect(await redis.client.dump('retained-fixture')).toEqual(before);
  }, 30_000);
});
