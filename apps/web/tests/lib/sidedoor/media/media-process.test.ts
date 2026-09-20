// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ProcessExecutionError } from 'thesidedoor-core/runtime/process';
import { StorageReadCleanupError } from 'thesidedoor-core/storage';
import { JobExecutionCleanupError } from 'thesidedoor-core/runtime/outbox';
import {
  executeMediaProcess,
  MediaCleanupError,
  rethrowMediaInterruption,
} from '@/lib/audio/media-process';

describe('optional media analysis error policy', () => {
  it('rejects an invalid explicit deadline before starting a media command', async () => {
    await expect(executeMediaProcess('ffmpeg', [], { timeoutMs: 0 })).rejects.toThrow(
      'Invalid process request'
    );
  });
  it.each([
    new ProcessExecutionError('cleanup_failed'),
    new StorageReadCleanupError({ cause: new Error('Storage still writing') }),
    new JobExecutionCleanupError({ cause: new Error('Workspace retained') }),
    new MediaCleanupError({ cause: new Error('Filesystem unavailable') }),
    new AggregateError([new Error('Analysis failed'), new Error('Cleanup failed')]),
  ])('preserves cleanup evidence through error wrappers', (cleanup) => {
    const error = new Error('Optional analysis failed', {
      cause: new Error('Worker failed', { cause: cleanup }),
    });
    expect(() => rethrowMediaInterruption(error)).toThrow(error);
    expect(() => rethrowMediaInterruption(error, AbortSignal.abort(new Error('Stopped')))).toThrow(
      error
    );
  });
  it('allows ordinary optional failures and handles cyclic causes', () => {
    const first = new Error('Invalid audio');
    const second = new Error('Analysis unavailable', { cause: first });
    first.cause = second;
    expect(() => rethrowMediaInterruption(first)).not.toThrow();
    expect(() =>
      rethrowMediaInterruption(new ProcessExecutionError('exit_failed', 1))
    ).not.toThrow();
  });
  it('propagates the original interruption while preserving a wrapped abort reason', () => {
    const reason = new Error('Worker stopped');
    const error = new Error('Read interrupted', { cause: reason });
    expect(() => rethrowMediaInterruption(error, AbortSignal.abort(reason))).toThrow(error);
  });
});
