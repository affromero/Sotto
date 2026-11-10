import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';

const maxKeys = 10_000;
const maxBytes = 32 * 1024 * 1024;
const maxPages = 1_000;
const deadlineMs = 30_000;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const boundedDump = `
local usage = redis.call('MEMORY', 'USAGE', KEYS[1], 'SAMPLES', '0')
if not usage then return redis.error_reply('Redis key disappeared') end
if usage > tonumber(ARGV[1]) then return redis.error_reply('Redis data bound exceeded') end
local value = redis.call('DUMP', KEYS[1])
if not value then return redis.error_reply('Redis key disappeared') end
if string.len(value) > tonumber(ARGV[1]) then
  return redis.error_reply('Redis data bound exceeded')
end
return {usage, value}
`;

interface RetainedInput {
  redisUrl: string;
  queues: readonly string[];
  failedWorksheetIds: readonly string[];
}

/**
 * Inspect a trusted dedicated Redis after writers are fenced and heartbeats expire.
 * The caller must independently admit the evidence and verify canonical job receipts.
 * SCAN and ZRANGE bound item counts, not individual response sizes from a hostile server.
 */
export async function inspectRetainedReviewRedis(redis: Redis, input: RetainedInput) {
  const url = new URL(input.redisUrl);
  assert.equal(url.protocol, 'redis:', 'Dedicated Redis TCP connection required');
  assert(['', '/0'].includes(url.pathname), 'Dedicated review database 0 required');
  assert.equal(redis.options.host, url.hostname, 'Redis host changed');
  assert.equal(redis.options.port, Number(url.port || 6379), 'Redis port changed');
  assert.equal(redis.options.db ?? 0, 0, 'Dedicated review database 0 required');
  assert(!redis.options.path && !redis.options.sentinels, 'Direct Redis connection required');
  assert(
    typeof (redis as Redis & { nodes?: unknown }).nodes !== 'function',
    'Redis Cluster unsupported'
  );
  assert(
    redis.options.commandTimeout !== undefined &&
      redis.options.commandTimeout > 0 &&
      redis.options.commandTimeout <= 5000,
    'Bounded Redis commands required'
  );
  const queues = [...input.queues].sort();
  assert(queues.length > 0 && queues.length <= 100);
  assert.equal(new Set(queues).size, queues.length, 'Duplicate queue names');
  assert(queues.every((name) => /^[a-z][a-z0-9-]{0,99}$/.test(name)));
  assert(queues.includes('worksheet-pdf'), 'Worksheet queue required');
  const failed = [...input.failedWorksheetIds].sort();
  assert.equal(failed.length, 3, 'Three independently admitted failures required');
  assert.equal(new Set(failed).size, failed.length, 'Duplicate failed job identities');
  assert(failed.every((id) => /^[a-zA-Z0-9_-]{1,200}$/.test(id)));
  const deadline = Date.now() + deadlineMs;
  const checkDeadline = () => assert(Date.now() < deadline, 'Redis inspection deadline exceeded');

  async function identity() {
    checkDeadline();
    const client = await redis.client('INFO');
    assert.equal(typeof client, 'string', 'Redis client identity unavailable');
    const databases = client
      .trim()
      .split(/\s+/)
      .filter((field) => field.startsWith('db='));
    assert.deepEqual(databases, ['db=0'], 'Redis client database changed');
    const info = await redis.info('server');
    const runId = /^run_id:([a-f0-9]{40})\r?$/m.exec(info)?.[1];
    assert(runId, 'Redis server identity unavailable');
    return hash(JSON.stringify([url.hostname, Number(url.port || 6379), 0, runId]));
  }

  async function scan() {
    const keys = new Set<string>();
    let cursor = '0';
    let pages = 0;
    do {
      checkDeadline();
      const page = await redis.scan(cursor, 'COUNT', 100);
      cursor = page[0];
      assert(++pages <= maxPages, 'Redis scan bound exceeded');
      for (const key of page[1]) {
        assert(!keys.has(key), 'Redis scan returned duplicate keys');
        keys.add(key);
        assert(keys.size <= maxKeys, 'Redis key bound exceeded');
      }
    } while (cursor !== '0');
    return keys;
  }

  async function snapshot() {
    const server = await identity();
    const keys = await scan();
    assert.equal(await redis.dbsize(), keys.size, 'Redis changed during scan');
    const expected = new Map<string, string>();
    const jobKeys = new Set<string>();
    const failedFound: string[] = [];
    let completedCount = 0;
    for (const queue of queues) {
      const prefix = `bull:${queue}:`;
      expected.set(prefix + 'events', 'stream');
      expected.set(prefix + 'meta', 'hash');
      if (keys.has(prefix + 'marker')) {
        assert.equal(await redis.zcard(prefix + 'marker'), 1, 'Unexpected queue marker');
        assert.deepEqual(
          await redis.zrange(prefix + 'marker', '0', '0', 'WITHSCORES'),
          ['0', '0'],
          'Unexpected queue marker'
        );
        expected.set(prefix + 'marker', 'zset');
      }
      let count = 0;
      for (const state of ['completed', 'failed'] as const) {
        const key = prefix + state;
        if (!keys.has(key)) continue;
        expected.set(key, 'zset');
        jobKeys.add(key);
        const members = await redis.zrange(key, '0', String(maxKeys), 'WITHSCORES');
        assert(members.length % 2 === 0 && members.length <= maxKeys * 2);
        for (let index = 0; index < members.length; index += 2) {
          const id = members[index];
          assert(/^[a-zA-Z0-9_-]{1,200}$/.test(id), 'Unexpected job identity');
          assert(Number.isFinite(Number(members[index + 1])), 'Invalid job score');
          const jobKey = prefix + id;
          assert(!expected.has(jobKey), 'Job appears in multiple retained states');
          expected.set(jobKey, 'hash');
          jobKeys.add(jobKey);
          assert(expected.size <= maxKeys, 'Redis key bound exceeded');
          if (state === 'failed') {
            assert.equal(queue, 'worksheet-pdf', 'Unknown failed work');
            failedFound.push(id);
          } else completedCount++;
          assert(++count <= maxKeys, 'Queue job bound exceeded');
        }
      }
      if (count || keys.has(prefix + 'id')) {
        expected.set(prefix + 'id', 'string');
        jobKeys.add(prefix + 'id');
      }
    }
    assert.deepEqual(failedFound.sort(), failed, 'Failed delivery identities changed');
    assert.equal(expected.size, keys.size, 'Unexpected or missing Redis keys');
    const records: [string, string, string][] = [];
    let bytes = 0;
    let memory = 0;
    for (const [key, type] of [...expected].sort(([a], [b]) => a.localeCompare(b))) {
      checkDeadline();
      assert(keys.has(key), 'Expected retained Redis key is missing');
      assert.equal(await redis.type(key), type, 'Retained Redis key type changed');
      assert.equal(await redis.pttl(key), -1, 'Retained Redis key has expiry');
      const remaining = maxBytes - Math.max(memory, bytes);
      assert(remaining > 0, 'Redis data bound exceeded');
      const reply = await redis.callBuffer('EVAL_RO', boundedDump, '1', key, String(remaining));
      assert(Array.isArray(reply) && reply.length === 2, 'Redis data read failed');
      const [used, value] = reply;
      assert(typeof used === 'number' && used >= 0, 'Redis memory usage unavailable');
      assert(Buffer.isBuffer(value), 'Retained Redis key disappeared');
      memory += used;
      assert(memory <= maxBytes, 'Redis data bound exceeded');
      bytes += value.length;
      assert(bytes <= maxBytes, 'Redis data bound exceeded');
      records.push([key, type, hash(value)]);
    }
    assert.equal(await redis.dbsize(), keys.size, 'Redis changed during inspection');
    assert.equal(await identity(), server, 'Redis server identity changed');
    return {
      server,
      fingerprint: hash(JSON.stringify(records)),
      jobsFingerprint: hash(JSON.stringify(records.filter(([key]) => jobKeys.has(key)))),
      keys: keys.size,
      queues: queues.length,
      completed: completedCount,
      failed: failedFound.length,
    };
  }

  const first = await snapshot();
  const second = await snapshot();
  assert.deepEqual(second, first, 'Redis changed between inspections');
  return first;
}
