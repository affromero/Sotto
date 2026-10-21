const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { run } = require('../../deploy/queue-lifecycle.cjs');

function fixture() {
  const flags = new Map([
    ['audio-generation', false],
    ['material-analysis', true],
    ['vocabulary-audio', false],
  ]);
  const active = new Map();
  const reviewed = {
    previousQueues: ['audio-generation'],
    candidateQueues: [...flags.keys()].sort(),
    addedQueues: ['material-analysis', 'vocabulary-audio'],
  };
  const proof = JSON.stringify({
    schemaVersion: 1,
    stack: 'sotto',
    releaseSha: 'a'.repeat(40),
    candidateWebImage: `ghcr.io/fixture/web@sha256:${'b'.repeat(64)}`,
    candidateWorkersImage: `ghcr.io/fixture/workers@sha256:${'c'.repeat(64)}`,
    previousRuntimes: Object.fromEntries(
      ['web', 'workers-heavy', 'workers-light', 'workers-pipeline'].map((service) => [
        service,
        { containerId: 'd'.repeat(64), imageId: `sha256:${'e'.repeat(64)}` },
      ])
    ),
    previousNames: reviewed.previousQueues,
    candidateNames: reviewed.candidateQueues,
    compatibilityReviewSha256: 'f'.repeat(64),
    schemaReviewSha256: '1'.repeat(64),
  });
  const transition = { proof, sha256: createHash('sha256').update(proof).digest('hex') };
  const runtime = {
    names: reviewed.previousQueues,
    namespace: 'fixture',
    environment: { DATABASE_URL: 'postgresql://fixture/fixture', REDIS_URL: 'redis://fixture/13' },
    database: {
      $transaction: async (read) =>
        read({ $executeRawUnsafe: async () => {}, $queryRawUnsafe: async () => [] }),
    },
    sottoJobExecutions: () => ({}),
    sottoJobOutbox: () => ({ listIncomplete: async () => ({ jobs: [], cursor: null }) }),
    createQueue: (name) => ({
      name,
      isPaused: async () => flags.get(name) ?? false,
      pause: async () => flags.set(name, true),
      resume: async () => flags.set(name, false),
      getActiveCount: async () => active.get(name) ?? 0,
      getJobs: async () => (active.get(name) ? [{ id: 'active-fixture' }] : []),
      getJobSchedulersCount: async () => 0,
      getWorkers: async () => [],
      close: async () => {},
    }),
  };
  return { flags, active, transition, runtime, candidateNames: reviewed.candidateQueues };
}

test('old and candidate runtimes preserve all original pause flags and inspect added work before drain', async () => {
  const { flags, active, transition, runtime, candidateNames } = fixture();
  const previousInput = { transition, role: 'previous' };
  const candidateInput = { transition, role: 'candidate' };
  const original = [...flags];
  const manifest = await run({ command: 'snapshot', ...previousInput }, runtime);
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual([...flags], original);
  await run({ command: 'pause', manifest, ...previousInput }, runtime);
  assert([...flags.values()].every(Boolean));
  active.set('vocabulary-audio', 1);
  assert.equal(
    (await run({ command: 'drained-all', manifest, ...previousInput }, runtime)).drained,
    false
  );
  active.clear();
  assert.equal(
    (await run({ command: 'drained-all', manifest, ...previousInput }, runtime)).drained,
    true
  );
  runtime.names = candidateNames;
  assert(
    (await run({ command: 'observe', manifest, ...candidateInput }, runtime)).queues.every(
      (queue) => queue.paused
    )
  );
  await run({ command: 'restore', manifest, ...candidateInput }, runtime);
  assert.deepEqual([...flags], original);
});

test('missing, foreign, removed or repeated queues and changed runtime cannot alter flags', async () => {
  const { flags, transition, runtime } = fixture();
  const original = [...flags];
  const input = { transition, role: 'previous' };
  const manifest = await run({ command: 'snapshot', ...input }, runtime);
  const originalProof = JSON.parse(transition.proof);
  function changedProof(changes) {
    const proof = JSON.stringify({ ...originalProof, ...changes });
    return { proof, sha256: createHash('sha256').update(proof).digest('hex') };
  }
  for (const broken of [
    { ...manifest, queues: manifest.queues.slice(1) },
    { ...manifest, connectionIdentity: 'foreign' },
    { ...manifest, transition: changedProof({ candidateNames: ['material-analysis'] }) },
    {
      ...manifest,
      transition: changedProof({ previousNames: ['audio-generation', 'audio-generation'] }),
    },
  ])
    await assert.rejects(
      run(
        { command: 'pause', manifest: broken, role: 'previous', transition: broken.transition },
        runtime
      )
    );
  runtime.names = ['foreign'];
  await assert.rejects(run({ command: 'pause', manifest, ...input }, runtime));
  await assert.rejects(run({ command: 'snapshot', ...input }, runtime));
  assert.deepEqual([...flags], original);
});

test('unconfirmed restoration fails with original receipt intact for recovery', async () => {
  const { transition, runtime } = fixture();
  const input = { transition, role: 'previous' };
  const manifest = await run({ command: 'snapshot', ...input }, runtime);
  const saved = JSON.stringify(manifest);
  await run({ command: 'pause', manifest, ...input }, runtime);
  const createQueue = runtime.createQueue;
  runtime.createQueue = (name) => ({ ...createQueue(name), resume: async () => {} });
  await assert.rejects(run({ command: 'restore', manifest, ...input }, runtime), /not restored/);
  assert.equal(JSON.stringify(manifest), saved);
});
