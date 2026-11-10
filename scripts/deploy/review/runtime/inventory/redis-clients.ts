import assert from 'node:assert/strict';
import type Redis from 'ioredis';

function fieldsFor(value: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const item of value.trim().split(/\s+/)) {
    const separator = item.indexOf('=');
    assert(separator > 0, 'Malformed Redis client inventory');
    const key = item.slice(0, separator);
    assert(!fields.has(key), 'Duplicate Redis client field');
    fields.set(key, item.slice(separator + 1));
  }
  assert(/^[1-9][0-9]*$/.test(fields.get('id') ?? ''), 'Redis client ID missing');
  assert(/^\S+:\d+$/.test(fields.get('addr') ?? ''), 'Redis client address missing');
  assert(/^[A-Za-z]+$/.test(fields.get('flags') ?? ''), 'Redis client flags missing');
  assert(/^\d+$/.test(fields.get('db') ?? ''), 'Redis client database missing');
  assert(/^\S+$/.test(fields.get('cmd') ?? ''), 'Redis client command missing');
  return fields;
}

/** Observe all databases; the caller must independently fence writers. */
async function inspectExclusiveRedisClient(redis: Redis, expected?: string): Promise<string> {
  const identity = async () => {
    const id = await redis.client('ID');
    assert(
      (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
        (typeof id === 'string' && /^[1-9][0-9]{0,15}$/.test(id)),
      'Redis client identity unavailable'
    );
    const info = await redis.info('server');
    const runIds = [...info.matchAll(/^run_id:([a-f0-9]{40})\r?$/gm)];
    assert.equal(runIds.length, 1, 'Redis server identity unavailable');
    return { id: String(id), runId: runIds[0][1] };
  };
  const before = await identity();
  const response = await redis.client('LIST');
  assert(
    typeof response === 'string' &&
      response.endsWith('\n') &&
      Buffer.byteLength(response) <= 262_144,
    'Bounded Redis client inventory required'
  );
  const lines = response.trim().split('\n');
  assert.equal(lines.length, 1, 'Unexpected Redis client');
  const fields = fieldsFor(lines[0]);
  assert.equal(fields.get('id'), before.id, 'Redis observer changed');
  assert.equal(fields.get('db'), '0', 'Redis observer database changed');
  const info = await redis.client('INFO');
  assert(
    typeof info === 'string' && Buffer.byteLength(info) <= 4096,
    'Bounded Redis observer information required'
  );
  const own = fieldsFor(info);
  assert.equal(own.get('id'), before.id, 'Redis observer changed');
  assert.equal(own.get('db'), '0', 'Redis observer database changed');
  assert.deepEqual(await identity(), before, 'Redis observer identity changed');
  const token = `${before.runId}:${before.id}`;
  if (expected !== undefined) assert.equal(token, expected, 'Redis observer identity changed');
  return token;
}

/** Bind every observation to one connection and reject any reconnect. */
export function createExclusiveRedisObserver(redis: Redis) {
  let token: string | undefined;
  let lostConnection = false;
  let invalid = false;
  let busy = false;
  let disposed = false;
  const lost = () => {
    lostConnection = true;
  };
  const detach = () => {
    redis.off('close', lost);
    redis.off('reconnecting', lost);
  };
  redis.on('close', lost);
  redis.on('reconnecting', lost);
  return {
    async verify() {
      if (busy) invalid = true;
      assert(!disposed && !lostConnection && !invalid && !busy, 'Redis observer unavailable');
      busy = true;
      try {
        const observed = await inspectExclusiveRedisClient(redis, token);
        assert(!disposed && !lostConnection && !invalid, 'Redis observer connection lost');
        token = observed;
      } catch (error) {
        invalid = true;
        throw error;
      } finally {
        busy = false;
        if (disposed) detach();
      }
    },
    close() {
      disposed = true;
      if (!busy) detach();
    },
  };
}
