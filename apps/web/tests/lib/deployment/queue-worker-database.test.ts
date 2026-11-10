// @vitest-environment node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

interface WorkerRecord {
  name: string;
  db?: string;
}

const { queueWorkersInDatabase } = createRequire(import.meta.url)(
  resolve(process.cwd(), '../../scripts/deploy/queue-lifecycle.cjs')
) as {
  queueWorkersInDatabase: (queue: unknown) => Promise<WorkerRecord[]>;
};

function queue(info: () => Promise<string>, workers: WorkerRecord[], cluster = false) {
  const client = { client: info, ...(cluster ? { nodes: () => [] } : {}) };
  return {
    getBackend: () => ({ client: Promise.resolve(client) }),
    getWorkers: async () => workers,
  };
}

describe('deployment worker database inspection', () => {
  it.each([
    ['unsupported client list', { name: 'GCP does not support client list' }],
    ['missing database', { name: 'worker' }],
    ['malformed database', { name: 'worker', db: '1x' }],
  ])('rejects %s', async (_description, worker) => {
    await expect(queueWorkersInDatabase(queue(async () => 'id=1 db=1', [worker]))).rejects.toThrow(
      'Worker database unavailable'
    );
  });

  it('rejects denied client information', async () => {
    const info = vi.fn().mockRejectedValue(new Error('client info denied'));
    await expect(queueWorkersInDatabase(queue(info, []))).rejects.toThrow('client info denied');
  });

  it('rejects Redis Cluster inspection', async () => {
    await expect(queueWorkersInDatabase(queue(async () => 'id=1 db=0', [], true))).rejects.toThrow(
      'Redis Cluster worker inspection is unsupported'
    );
  });

  it('rejects a connection that changes database during inspection', async () => {
    const info = vi.fn().mockResolvedValueOnce('id=1 db=1').mockResolvedValueOnce('id=1 db=0');
    await expect(queueWorkersInDatabase(queue(info, []))).rejects.toThrow(
      'Redis client database changed'
    );
  });
});
