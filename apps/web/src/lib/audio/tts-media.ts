import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAudioDuration } from '../audio-stitcher';
import { executeMediaProcess, isMediaCleanupFailure, MediaCleanupError } from './media-process';

export type TtsMediaExecution = { signal?: AbortSignal; directory?: string };

export class TtsMediaCleanupError extends MediaCleanupError {
  constructor(
    readonly directory: string,
    options: ErrorOptions
  ) {
    super(options);
    this.name = 'TtsMediaCleanupError';
  }
}

async function withTtsDirectory<Result>(
  execution: TtsMediaExecution,
  run: (directory: string) => Promise<Result>
): Promise<Result> {
  execution.signal?.throwIfAborted();
  const directory = await mkdtemp(join(execution.directory ?? tmpdir(), 'tts-media-'));
  let failed = false;
  let primary: unknown;
  try {
    execution.signal?.throwIfAborted();
    const result = await run(directory);
    execution.signal?.throwIfAborted();
    return result;
  } catch (error) {
    failed = true;
    primary = error;
    if (isMediaCleanupFailure(error)) throw new TtsMediaCleanupError(directory, { cause: error });
    throw error;
  } finally {
    // An unconfirmed child may still own these files. Its execution must retain them.
    if (!isMediaCleanupFailure(primary)) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        const cleanup = new TtsMediaCleanupError(directory, { cause: error });
        if (failed)
          throw new AggregateError(
            [primary, cleanup],
            'TTS processing and temporary cleanup failed',
            { cause: primary }
          );
        throw cleanup;
      }
    }
  }
}

export async function measureTtsAudio(
  audio: Buffer,
  options: TtsMediaExecution = {}
): Promise<number> {
  const execution = { signal: options.signal, directory: options.directory };
  return withTtsDirectory(execution, async (directory) => {
    const input = join(directory, 'input.mp3');
    await writeFile(input, audio, { signal: execution.signal, flag: 'wx' });
    return getAudioDuration(input, execution.signal);
  });
}

/** Preserve the existing mono MP3 encoding while owning FFmpeg and every temporary file. */
export async function concatenateTtsAudio(
  buffers: readonly Buffer[],
  options: TtsMediaExecution = {}
): Promise<Buffer> {
  const execution = { signal: options.signal, directory: options.directory };
  execution.signal?.throwIfAborted();
  if (buffers.length === 0) throw new Error('TTS concatenation needs audio');
  if (buffers.length === 1) return buffers[0];
  return withTtsDirectory(execution, async (directory) => {
    const names = buffers.map((_, index) => `chunk-${index}.mp3`);
    for (let index = 0; index < buffers.length; index++) {
      execution.signal?.throwIfAborted();
      await writeFile(join(directory, names[index]), buffers[index], {
        signal: execution.signal,
        flag: 'wx',
      });
    }
    const list = join(directory, 'inputs.txt');
    await writeFile(list, names.map((name) => `file '${name}'`).join('\n'), {
      signal: execution.signal,
      flag: 'wx',
    });
    const output = join(directory, 'output.mp3');
    await executeMediaProcess(
      'ffmpeg',
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        '-ar',
        '44100',
        '-ac',
        '1',
        output,
      ],
      { signal: execution.signal }
    );
    return readFile(output, { signal: execution.signal });
  });
}
