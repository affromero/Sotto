// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import {
  admitPreparation,
  cancelPreparation,
  startPreparation,
  preparationStore,
  type ClassPreparation,
} from '@/lib/classes/preparation-state';

describe('durable class preparation state', () => {
  let database: DatabaseSync;
  const fixture = (): ClassPreparation => {
    const id = randomUUID();
    return {
      id,
      courseId: 'course:one',
      userId: 'learner:one',
      instanceId: randomUUID(),
      courseCreatedAt: 1,
      userCreatedAt: 1,
      createdAt: 1000,
      availableAt: 2000,
      expiresAt: 3000,
      updatedAt: 1000,
      timeZone: 'America/Bogota',
      deferAudio: true,
      inputFingerprint: 'b'.repeat(64),
      maxProviderRequests: 20,
      selection: { provider: 'local', model: 'local:fixture', credentialFingerprint: null },
      grant: { id, revision: randomUUID(), fingerprint: 'a'.repeat(64) },
      status: 'QUEUED',
      classId: null,
      audioEpisodeIds: [],
      result: null,
      failure: null,
    };
  };
  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(
      'CREATE TABLE SidedoorState (id TEXT PRIMARY KEY, revision TEXT NOT NULL, state TEXT NOT NULL)'
    );
  });
  afterEach(() => database.close());

  it('keeps the winning scheduled task on exact replay and rejects changed schedule or budget', () => {
    const current = fixture();
    expect(admitPreparation(current, { ...current, id: randomUUID() }).id).toBe(current.id);
    expect(() => admitPreparation(current, { ...current, availableAt: 2500 })).toThrow();
    expect(() => admitPreparation(current, { ...current, maxProviderRequests: 30 })).toThrow();
    expect(() =>
      admitPreparation(current, {
        ...current,
        selection: { ...current.selection, model: 'local:other' },
      })
    ).toThrow();
    expect(() => admitPreparation(current, { ...current, userCreatedAt: 2 })).toThrow();
  });

  it('starts only at the scheduled time and fails expired work without running it', () => {
    const queued = fixture();
    expect(() => startPreparation(queued, 1999)).toThrow();
    expect(startPreparation(queued, 2000).status).toBe('RUNNING');
    expect(startPreparation(queued, 3000)).toMatchObject({ status: 'FAILED', failure: 'expired' });
  });

  it('fences interrupted executions instead of repeating their provider effects', async () => {
    const current = startPreparation(fixture(), 2000);
    const backend = sqlStateBackend(
      {
        query: async (sql, values) => database.prepare(sql).all(...(values as SQLInputValue[])),
      },
      'sqlite',
      'persisted-running'
    );
    await backend.compareAndSwap(null, { revision: randomUUID(), state: current });
    const restarted = preparationStore(backend);
    await restarted.transact((state) => {
      if (!state) throw new Error('Missing fixture');
      Object.assign(state, startPreparation(state, 2100));
    });
    expect(await restarted.read()).toMatchObject({ status: 'UNRESOLVED', failure: 'interrupted' });
    expect(() => admitPreparation({ ...current, status: 'UNRESOLVED' }, fixture())).toThrow();
  });

  it('cancels queued work immediately and waits for running work to settle', () => {
    const queued = fixture();
    expect(cancelPreparation(queued, 1500).status).toBe('CANCELLED');
    const running = startPreparation(queued, 2000);
    const cancelling = cancelPreparation(running, 2100);
    expect(cancelling.status).toBe('CANCELLING');
    expect(startPreparation(cancelling, 2200).status).toBe('CANCELLED');
  });

  it('retains cancellation uncertainty while descendant audio still needs cleanup proof', () => {
    const completed = {
      ...fixture(),
      status: 'COMPLETED' as const,
      audioEpisodeIds: ['episode:one'],
    };
    const cancelling = cancelPreparation(completed, 2100);
    expect(cancelling.status).toBe('CANCELLING');
    expect(startPreparation(cancelling, 2200).status).toBe('CANCELLING');
    expect(() => admitPreparation(cancelling, fixture())).toThrow();
  });
});
