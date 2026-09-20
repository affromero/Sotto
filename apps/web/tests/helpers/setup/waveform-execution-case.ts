import type { Job } from 'bullmq';
import { dirname } from 'node:path';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { expect, vi } from 'vitest';
import { LocalStorageReader, StorageReadCleanupError } from 'thesidedoor-core/storage';
import { ProcessRunner, ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import type { PrismaClient } from '@/generated/prisma/client';
import { processWaveformGeneration } from '@/workers/waveform-generation.worker';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { JobExecutionCleanupError } from 'thesidedoor-core/runtime/outbox';

export const waveformExecutionScenarios = [
  'waveform download cancellation',
  'waveform post-commit cancellation',
  'waveform post-commit cleanup failure',
  'waveform download and cleanup failure',
  'waveform optional process cleanup failure',
  'waveform storage cleanup failure',
];

export async function exerciseWaveformExecution(options: {
  database: PrismaClient;
  episodeId: string;
  job: Job;
  scenario: string;
  failCleanup: (directory: string) => Promise<void>;
  trackWorkspace: (directory: string) => void;
}) {
  const { database, episodeId, job, scenario } = options;
  const record = await sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(job.id!));
  if (!record) throw new Error('Missing waveform job');
  const scope = record.job.scopes.find((item) => item.subjectId === `episode:${episodeId}`);
  if (!scope) throw new Error('Missing episode scope');
  const unresolved = () =>
    sottoTransaction(database, (tx) => sottoJobExecutions(tx).listUnresolved(scope));
  const controller = new AbortController();
  const reason = new Error('Stop waveform download');
  const primary = new Error('Download failed');
  const copy = LocalStorageReader.prototype.copyToFile;
  const progress = job.updateProgress.bind(job);
  const execute = ProcessRunner.prototype.execute;
  const open = filesystem.open;
  let downloadSettled = false;
  let workspace = '';
  const copies = vi
    .spyOn(LocalStorageReader.prototype, 'copyToFile')
    .mockImplementation(async function (this: LocalStorageReader, ...args) {
      workspace = dirname(args[1]);
      options.trackWorkspace(workspace);
      expect((await unresolved()).executions).toMatchObject([{ status: 'active' }]);
      if (scenario === 'waveform download and cleanup failure') {
        await options.failCleanup(workspace);
        throw primary;
      }
      if (scenario === 'waveform download cancellation') {
        expect(args[2]).toBe(controller.signal);
        controller.abort(reason);
        try {
          return await copy.apply(this, args);
        } finally {
          downloadSettled = true;
        }
      }
      return copy.apply(this, args);
    });
  if (scenario === 'waveform storage cleanup failure') {
    filesystem.open = async (...args: Parameters<typeof open>) => {
      const file = await open(...args);
      if (typeof args[1] !== 'number' || !String(args[0]).endsWith('.mp3')) return file;
      return new Proxy(file, {
        get(target, property) {
          if (property === 'close')
            return async () => {
              await target.close();
              throw new Error('Source close acknowledgement lost');
            };
          const value: unknown = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    syncBuiltinESMExports();
  }
  const progresses = vi.spyOn(job, 'updateProgress').mockImplementation(async (value) => {
    await progress(value);
    if (value !== 100) return;
    if (scenario === 'waveform post-commit cancellation') controller.abort(reason);
    if (scenario === 'waveform post-commit cleanup failure') await options.failCleanup(workspace);
  });
  const processes = vi.spyOn(ProcessRunner.prototype, 'execute').mockImplementation(async function (
    this: ProcessRunner,
    request
  ) {
    if (
      scenario === 'waveform optional process cleanup failure' &&
      request.args.some((arg) => arg.includes('showspectrumpic'))
    )
      throw new ProcessExecutionError('cleanup_failed');
    return execute.call(this, request);
  });
  try {
    const outcome = await processWaveformGeneration(job, controller.signal).then(
      () => ({ success: true }),
      (error) => ({ error: error as unknown })
    );
    const published =
      scenario === 'waveform post-commit cancellation' ||
      scenario === 'waveform post-commit cleanup failure';
    const uncertain = scenario.includes('cleanup failure');
    if (scenario === 'waveform download cancellation') {
      expect(outcome).toEqual({ error: reason });
      expect(downloadSettled).toBe(true);
    } else if (scenario === 'waveform download and cleanup failure') {
      expect(outcome).toMatchObject({
        error: { errors: [primary, expect.any(JobExecutionCleanupError)] },
      });
    } else if (scenario === 'waveform storage cleanup failure') {
      expect(outcome).toMatchObject({ error: expect.any(StorageReadCleanupError) });
      expect((await filesystem.stat(workspace)).isDirectory()).toBe(true);
    } else if (scenario === 'waveform post-commit cancellation')
      expect(outcome).toEqual({ success: true });
    else expect(outcome).toHaveProperty('error');
    const episode = await database.episode.findUniqueOrThrow({ where: { id: episodeId } });
    expect(Boolean(episode.waveformUrl)).toBe(published);
    expect(Boolean(episode.spectrogramUrl)).toBe(published);
    expect(
      (await sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(job.id!)))?.complete
    ).toBe(published);
    if (uncertain) {
      expect((await unresolved()).executions).toMatchObject([{ status: 'cleanup-unconfirmed' }]);
      await expect(
        sottoTransaction(database, (tx) =>
          sottoJobExecutions(tx).requireParentDrained(record.job.id, record.fingerprint)
        )
      ).rejects.toThrow();
    } else expect((await unresolved()).executions).toEqual([]);
  } finally {
    filesystem.open = open;
    syncBuiltinESMExports();
    copies.mockRestore();
    progresses.mockRestore();
    processes.mockRestore();
  }
}
