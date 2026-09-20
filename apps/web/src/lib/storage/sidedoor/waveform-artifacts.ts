import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractWaveformPeaks, generateSpectrogram } from '@/lib/waveform-extractor';
import { rethrowMediaInterruption } from '@/lib/audio/media-process';

/** Keep optional image generation separate from source, file-read and storage failures. */
export async function renderWaveformArtifacts(
  audioPath: string,
  directory: string,
  onSpectrogramFailure: (error: unknown) => void,
  signal?: AbortSignal
): Promise<{ waveform: Buffer; spectrogram: Buffer | null }> {
  const waveform = Buffer.from(
    JSON.stringify(await extractWaveformPeaks(audioPath, 200, signal)),
    'utf8'
  );
  const path = join(directory, 'spectrogram.png');
  try {
    await generateSpectrogram(audioPath, path, undefined, undefined, signal);
  } catch (error) {
    rethrowMediaInterruption(error, signal);
    onSpectrogramFailure(error);
    return { waveform, spectrogram: null };
  }
  signal?.throwIfAborted();
  return { waveform, spectrogram: await readFile(path, { signal }) };
}
