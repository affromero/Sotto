import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as yieldToEvents } from 'node:timers/promises';
import { logger } from '@/lib/logger';
import { executeMediaProcess, MediaCleanupError, rethrowMediaInterruption } from './media-process';

/**
 * Find where each segment's raw audio actually starts in the stitched output
 * by cross-correlating a short voiced snippet from each segment file against
 * the stitched audio. Returns an array of start times in seconds.
 * The caller owns the workspace and removes it only after all I/O has settled.
 */
export async function detectSegmentBoundaries(
  stitchedPath: string,
  segmentPaths: string[],
  workspace: string,
  signal?: AbortSignal
): Promise<number[]> {
  signal?.throwIfAborted();
  if (segmentPaths.length === 0) return [];
  if (segmentPaths.length === 1) return [0];

  const directory = await mkdtemp(join(workspace, 'boundaries-'));
  try {
    const SR = 16000;

    // Convert stitched audio to raw PCM for fast processing
    const stitchedPcmPath = join(directory, 'stitched.pcm');
    await executeMediaProcess(
      'ffmpeg',
      [
        '-y',
        '-i',
        stitchedPath,
        '-ar',
        String(SR),
        '-ac',
        '1',
        '-acodec',
        'pcm_s16le',
        '-f',
        's16le',
        stitchedPcmPath,
      ],
      { signal }
    );
    const stitchedBuf = await readFile(stitchedPcmPath, { signal });
    signal?.throwIfAborted();
    if (stitchedBuf.length % 2 !== 0) throw new Error('Decoded audio has an incomplete PCM sample');
    const stitched = new Float32Array(stitchedBuf.length / 2);
    for (let i = 0; i < stitched.length; i++) {
      stitched[i] = stitchedBuf.readInt16LE(i * 2);
    }

    const starts: number[] = [0]; // first segment always at 0
    let searchFrom = 0; // only search forward from last found position

    for (let seg = 1; seg < segmentPaths.length; seg++) {
      signal?.throwIfAborted();
      try {
        // Convert segment to same format
        const segPcmPath = join(directory, `segment-${seg}.pcm`);
        await executeMediaProcess(
          'ffmpeg',
          [
            '-y',
            '-i',
            segmentPaths[seg],
            '-ar',
            String(SR),
            '-ac',
            '1',
            '-acodec',
            'pcm_s16le',
            '-f',
            's16le',
            segPcmPath,
          ],
          { signal }
        );
        const segBuf = await readFile(segPcmPath, { signal });
        signal?.throwIfAborted();
        if (segBuf.length % 2 !== 0)
          throw new Error('Decoded segment has an incomplete PCM sample');
        const segData = new Float32Array(segBuf.length / 2);
        for (let i = 0; i < segData.length; i++) {
          segData[i] = segBuf.readInt16LE(i * 2);
        }

        // Find voice onset in segment (first 320-sample window with RMS > 500)
        let onset = 0;
        for (let i = 0; i < segData.length - 320; i += 320) {
          let sum = 0;
          for (let j = i; j < i + 320; j++) sum += segData[j] * segData[j];
          if (Math.sqrt(sum / 320) > 500) {
            onset = i;
            break;
          }
        }

        // Take 1s of voiced content as search snippet
        const snippetLen = Math.min(SR, segData.length - onset);
        const snippet = segData.slice(onset, onset + snippetLen);

        // Normalize snippet
        let maxSnip = 0;
        for (let i = 0; i < snippet.length; i++)
          if (Math.abs(snippet[i]) > maxSnip) maxSnip = Math.abs(snippet[i]);
        if (maxSnip > 0) for (let i = 0; i < snippet.length; i++) snippet[i] /= maxSnip;

        // Search in stitched audio from last position ± 5s margin
        const windowStart = Math.max(0, searchFrom - 5 * SR);
        const windowEnd = Math.min(stitched.length, searchFrom + segData.length + 30 * SR);

        let bestCorr = -Infinity;
        let bestIdx = searchFrom;

        // Normalize search region
        let maxSearch = 0;
        for (let i = windowStart; i < windowEnd; i++)
          if (Math.abs(stitched[i]) > maxSearch) maxSearch = Math.abs(stitched[i]);

        // Slide snippet over search window (step by 160 samples = 10ms for speed)
        for (let pos = windowStart; pos < windowEnd - snippetLen; pos += 160) {
          if ((pos - windowStart) % (160 * 128) === 0) {
            await yieldToEvents(undefined, { signal });
            signal?.throwIfAborted();
          }
          let corr = 0;
          for (let j = 0; j < snippetLen; j++) {
            corr += (stitched[pos + j] / (maxSearch || 1)) * snippet[j];
          }
          if (corr > bestCorr) {
            bestCorr = corr;
            bestIdx = pos;
          }
        }

        // Actual start = match position minus onset offset
        const actualStart = (bestIdx - onset) / SR;
        starts.push(Math.max(0, actualStart));
        searchFrom = bestIdx + segData.length / 2; // advance search position

        // Cleanup temp file
        try {
          await rm(segPcmPath);
        } catch (error) {
          throw new MediaCleanupError({ cause: error });
        }
      } catch (error) {
        rethrowMediaInterruption(error, signal);
        // Fallback: use previous start + previous segment duration estimate
        const prevStart = starts[starts.length - 1];
        starts.push(prevStart + 10); // rough fallback
      }
    }

    logger.info('Segment boundaries detected via cross-correlation', {
      segmentCount: String(segmentPaths.length),
      starts: starts.map((s) => s.toFixed(3)).join(', '),
    });

    return starts;
  } catch (err) {
    rethrowMediaInterruption(err, signal);
    logger.warn('Cross-correlation boundary detection failed, returning empty', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Resolve unreliable correlation matches using the same overlap as the audio stitcher. */
export function resolveSegmentStarts(
  detected: readonly number[],
  durations: readonly (number | null)[],
  crossfadeSeconds = 0.3
): number[] {
  const monotonic =
    detected.length === durations.length &&
    detected.length > 0 &&
    detected.every(
      (start, index) =>
        index === 0 || start >= detected[index - 1] + (durations[index - 1] ?? 0) * 0.5
    );
  if (monotonic) return [...detected];
  let cumulative = 0;
  return durations.map((duration) => {
    const start = cumulative;
    cumulative += (duration ?? 0) - crossfadeSeconds;
    return start;
  });
}
