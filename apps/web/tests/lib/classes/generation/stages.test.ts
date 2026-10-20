// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runClassGenerationStages } from '@/lib/classes/generation/stages';
import {
  generationCleanupUnconfirmed,
  captureGenerationFailure,
} from '@/lib/classes/quality/generation-failure';

const context = { classId: 'class-fixture', attempt: 1 };

describe('class generation stage scheduling', () => {
  it('overlaps two branches while keeping a third queued', async () => {
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const writes: string[] = [];
    const run = runClassGenerationStages(
      [
        {
          stage: 'grammar',
          run: async () => {
            writes.push('grammar started');
            await first.promise;
            writes.push('grammar done');
          },
        },
        {
          stage: 'reading',
          run: async () => {
            writes.push('reading started');
            started.resolve();
            await second.promise;
            writes.push('reading done');
          },
        },
        {
          stage: 'writing',
          run: async () => {
            writes.push('writing done');
          },
        },
      ],
      context
    );
    await started.promise;
    expect(writes).toEqual(['grammar started', 'reading started']);
    first.resolve();
    second.resolve();
    await run;
    expect(writes).toEqual(
      expect.arrayContaining(['grammar done', 'reading done', 'writing done'])
    );
  });

  it('drains admitted work and leaves queued work untouched after a failure', async () => {
    const admitted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const failure = new Error('grammar rejected');
    const writes: string[] = [];
    let settled = false;
    const run = runClassGenerationStages(
      [
        {
          stage: 'grammar',
          run: async () => {
            await admitted.promise;
            throw failure;
          },
        },
        {
          stage: 'reading',
          run: async () => {
            admitted.resolve();
            await release.promise;
            writes.push('reading persisted');
          },
        },
        {
          stage: 'writing',
          run: async () => {
            writes.push('writing persisted');
          },
        },
      ],
      context
    );
    const observed = run.catch((error: unknown) => {
      settled = true;
      return error;
    });
    await admitted.promise;
    await Promise.resolve();
    expect(settled).toBe(false);
    release.resolve();
    expect(await observed).toBe(failure);
    expect(writes).toEqual(['reading persisted']);
  });

  it('retains a secondary cleanup failure with the original rejection', async () => {
    const release = Promise.withResolvers<void>();
    const original = new Error('content rejected');
    const cleanup = new Error('provider has not settled');
    cleanup.name = 'ProviderCleanupError';
    const retained: unknown[] = [];
    const run = runClassGenerationStages(
      [
        {
          stage: 'grammar',
          run: async () => {
            throw original;
          },
        },
        {
          stage: 'reading',
          run: async () => {
            await release.promise;
            throw cleanup;
          },
        },
      ],
      { ...context, onCleanupError: (error) => retained.push(error) }
    );
    const observed = run.catch((error: unknown) => error);
    release.resolve();
    expect(await observed).toBe(original);
    expect(retained).toEqual([cleanup]);
    expect(generationCleanupUnconfirmed(original)).toBe(true);
    expect(captureGenerationFailure(original).stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'grammar' }),
        expect.objectContaining({ stage: 'reading' }),
      ])
    );
  });

  it('drains an active branch before returning cancellation and admits no queued branch', async () => {
    const controller = new AbortController();
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const writes: string[] = [];
    const run = runClassGenerationStages(
      [
        {
          stage: 'grammar',
          run: async () => {
            started.resolve();
            await release.promise;
            writes.push('settled');
          },
        },
        {
          stage: 'reading',
          run: async () => {
            controller.abort(new Error('cancelled'));
          },
        },
        {
          stage: 'writing',
          run: async () => {
            writes.push('unexpected');
          },
        },
      ],
      { ...context, signal: controller.signal }
    );
    const observed = run.catch((error: unknown) => error);
    await started.promise;
    expect(writes).toEqual([]);
    release.resolve();
    expect(await observed).toBe(controller.signal.reason);
    expect(writes).toEqual(['settled']);
  });
});
