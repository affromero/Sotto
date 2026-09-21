import { ProcessExecutionError, ProcessRunner } from 'thesidedoor-core/runtime/process';
import { isJobExecutionCleanupFailure } from 'thesidedoor-core/runtime/outbox';

/** Each invocation owns its process. Preserve existing per-stream execFile limits and no deadline. */
export async function executeMediaProcess(
  command: 'ffmpeg' | 'ffprobe' | 'fpcalc',
  args: readonly string[],
  options: { signal?: AbortSignal; maxBuffer?: number; timeoutMs?: number | null } = {}
) {
  const maximum = options.maxBuffer ?? 1024 * 1024;
  // Trusted local media wrappers retain the environment previously supplied by execFile.
  const environment = { ...process.env };
  try {
    return await new ProcessRunner(1).execute({
      command,
      args: [...args],
      environment,
      timeoutMs: options.timeoutMs ?? null,
      signal: options.signal,
      maxOutputBytes: maximum * 2,
      maxOutputBytesPerChannel: maximum,
    });
  } catch (error) {
    if (error instanceof ProcessExecutionError) error.message = `${command} process ${error.code}`;
    throw error;
  }
}

export class MediaCleanupError extends Error {
  constructor(options: ErrorOptions) {
    super('Media temporary resources could not be removed', options);
    this.name = 'MediaCleanupError';
  }
}

/** Optional analysis may fail, but it cannot conceal unresolved cleanup or interruption. */
export function isMediaCleanupFailure(error: unknown): boolean {
  if (isJobExecutionCleanupFailure(error)) return true;
  const seen = new Set<unknown>();
  let current = error;
  while (!seen.has(current)) {
    seen.add(current);
    if (
      current instanceof AggregateError ||
      current instanceof MediaCleanupError ||
      (current instanceof ProcessExecutionError && current.code === 'cleanup_failed')
    )
      return true;
    if (!(current instanceof Error) || current.cause === undefined) break;
    current = current.cause;
  }
  return false;
}

export function rethrowMediaInterruption(error: unknown, signal?: AbortSignal): void {
  if (isMediaCleanupFailure(error) || signal?.aborted) throw error;
}
