// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import {
  admitPrerequisiteFence,
  prerequisiteFenceStore,
  recordPrerequisiteFence,
  type PrerequisiteFence,
} from '@/lib/classes/help/lifecycle/prerequisite-fence';

describe('prerequisite operation fence', () => {
  let database: DatabaseSync;
  const fixture = (): PrerequisiteFence => {
    const id = randomUUID();
    const instanceId = randomUUID();
    return {
      id,
      classId: 'class-1',
      courseId: 'course-1',
      userId: 'learner-1',
      ownership: {
        instanceId,
        userId: 'learner-1',
        scopes: [
          { subjectId: `instance:${instanceId}`, generation: 0 },
          { subjectId: 'class:class-1', generation: 1 },
          { subjectId: 'course:course-1', generation: 1 },
          { subjectId: 'profile:learner-1', generation: 1 },
        ],
      },
      sourceHash: 'a'.repeat(64),
      snapshotHash: 'b'.repeat(64),
      selection: {
        provider: 'fixture',
        model: 'fixture',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      grant: { id, revision: randomUUID(), fingerprint: 'c'.repeat(64) },
      status: 'QUEUED',
    };
  };
  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(
      'CREATE TABLE SidedoorState (id TEXT PRIMARY KEY, revision TEXT NOT NULL, state TEXT NOT NULL)'
    );
  });
  afterEach(() => database.close());

  it('returns the original operation on a matching request after restart', async () => {
    const first = fixture();
    const backend = sqlStateBackend(
      { query: async (sql, values) => database.prepare(sql).all(...(values as SQLInputValue[])) },
      'sqlite',
      'prerequisite-class'
    );
    await recordPrerequisiteFence(backend, first);
    const restored = (await prerequisiteFenceStore(backend).read()).current;
    const newId = randomUUID();
    const replay = admitPrerequisiteFence(restored, {
      ...first,
      id: newId,
      grant: { ...first.grant, id: newId },
    });
    expect(replay.id).toBe(first.id);
  });

  it('retains the admitted operation when a changed lesson request is rejected', async () => {
    const first = fixture();
    const backend = sqlStateBackend(
      { query: async (sql, values) => database.prepare(sql).all(...(values as SQLInputValue[])) },
      'sqlite',
      'prerequisite-class'
    );
    await recordPrerequisiteFence(backend, first);
    await expect(
      recordPrerequisiteFence(backend, { ...first, snapshotHash: 'd'.repeat(64) })
    ).rejects.toThrow('already active or needs recovery');
    expect((await prerequisiteFenceStore(backend).read()).current).toEqual(first);
  });

  it('rejects a fence whose instance scope does not match its ownership', () => {
    const first = fixture();
    const changed = {
      ...first,
      ownership: {
        ...first.ownership,
        scopes: first.ownership.scopes.map((scope) =>
          scope.subjectId.startsWith('instance:') ? { ...scope, generation: 1 } : scope
        ),
      },
    };
    expect(() => admitPrerequisiteFence(null, changed)).toThrow();
  });

  it.each(['QUEUED', 'RUNNING', 'UNRESOLVED', 'COMPLETED', 'FAILED'] as const)(
    'does not replace %s work when the lesson changes',
    (status) => {
      const first = fixture();
      expect(() =>
        admitPrerequisiteFence({ ...first, status }, { ...first, snapshotHash: 'd'.repeat(64) })
      ).toThrow('already active or needs recovery');
    }
  );
});
