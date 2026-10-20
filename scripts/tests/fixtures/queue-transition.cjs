const assert = require('node:assert/strict');
const { test } = require('node:test');
const { run } = require('../../deploy/queue-lifecycle.cjs');

function fixture() {
  const flags = new Map([
    ['audio-generation', false],
    ['material-analysis', true],
    ['vocabulary-audio', false],
  ]);
  const active = new Map();
  const transition = {
    previousQueues: ['audio-generation'],
    candidateQueues: [...flags.keys()].sort(),
    addedQueues: ['material-analysis', 'vocabulary-audio'],
  };
  const runtime = {
    names: transition.previousQueues,
    namespace: 'fixture',
    environment: { DATABASE_URL: 'postgresql://fixture/fixture', REDIS_URL: 'redis://fixture/13' },
    database: {
      $transaction: async (read) =>
        read({ $executeRawUnsafe: async () => {}, $queryRawUnsafe: async () => [] }),
    },
    sottoJobExecutions: () => ({}),
    sottoJobOutbox: () => ({}),
    createQueue: (name) => ({
      name,
      isPaused: async () => flags.get(name) ?? false,
      pause: async () => flags.set(name, true),
      resume: async () => flags.set(name, false),
      getActiveCount: async () => active.get(name) ?? 0,
      close: async () => {},
    }),
  };
  return { flags, active, transition, runtime };
}

test('old and candidate runtimes preserve all original pause flags and inspect added work before drain', async () => {
  const { flags, active, transition, runtime } = fixture();
  const original = [...flags];
  const manifest = await run({ command: 'snapshot', queueTransition: transition }, runtime);
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual([...flags], original);
  await run({ command: 'pause', manifest }, runtime);
  assert([...flags.values()].every(Boolean));
  active.set('vocabulary-audio', 1);
  assert.equal((await run({ command: 'drained-all', manifest }, runtime)).drained, false);
  active.clear();
  assert.equal((await run({ command: 'drained-all', manifest }, runtime)).drained, true);
  runtime.names = transition.candidateQueues;
  assert(
    (await run({ command: 'observe', manifest }, runtime)).queues.every((queue) => queue.paused)
  );
  await run({ command: 'restore', manifest }, runtime);
  assert.deepEqual([...flags], original);
});

test('missing, foreign, removed or repeated queues and changed runtime cannot alter flags', async () => {
  const { flags, transition, runtime } = fixture();
  const original = [...flags];
  const manifest = await run({ command: 'snapshot', queueTransition: transition }, runtime);
  for (const broken of [
    { ...manifest, queues: manifest.queues.slice(1) },
    { ...manifest, connectionIdentity: 'foreign' },
    { ...manifest, queueTransition: { ...transition, addedQueues: ['foreign'] } },
    { ...manifest, queueTransition: { ...transition, candidateQueues: ['material-analysis'] } },
    {
      ...manifest,
      queueTransition: { ...transition, previousQueues: ['audio-generation', 'audio-generation'] },
    },
  ])
    await assert.rejects(run({ command: 'pause', manifest: broken }, runtime));
  runtime.names = ['foreign'];
  await assert.rejects(run({ command: 'pause', manifest }, runtime));
  await assert.rejects(run({ command: 'snapshot', queueTransition: transition }, runtime));
  assert.deepEqual([...flags], original);
});

test('unconfirmed restoration fails with original receipt intact for recovery', async () => {
  const { transition, runtime } = fixture();
  const manifest = await run({ command: 'snapshot', queueTransition: transition }, runtime);
  const saved = JSON.stringify(manifest);
  await run({ command: 'pause', manifest }, runtime);
  const createQueue = runtime.createQueue;
  runtime.createQueue = (name) => ({ ...createQueue(name), resume: async () => {} });
  await assert.rejects(run({ command: 'restore', manifest }, runtime), /not restored/);
  assert.equal(JSON.stringify(manifest), saved);
});
