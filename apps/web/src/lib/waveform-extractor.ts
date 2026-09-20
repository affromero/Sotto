import { ProcessExecutionError, ProcessRunner } from 'thesidedoor-core/runtime/process';
import { executeMediaProcess } from './audio/media-process';
import { logger } from '@/lib/logger';

/** Measure channel energy in bounded temporal bins without retaining decoded audio. */
export async function extractWaveformPeaks(
  audioPath: string,
  barCount = 200,
  signal?: AbortSignal
): Promise<number[]> {
  if (!Number.isSafeInteger(barCount) || barCount < 1 || barCount > 10000)
    throw new Error('Waveform bar count must be an integer between 1 and 10000');
  signal?.throwIfAborted();
  const environment = { ...process.env };
  const { stdout } = await executeMediaProcess(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audioPath],
    { signal, timeoutMs: 30000, maxBuffer: 65536 }
  );
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error('Could not determine audio duration: ' + stdout.trim());
  signal?.throwIfAborted();
  const sampleRate = 16000;
  const chunks = new ProcessRunner(1).streamBytes({
    command: 'ffmpeg',
    args: [
      '-nostdin',
      '-v',
      'error',
      '-i',
      audioPath,
      '-map',
      '0:a:0',
      '-ac',
      '2',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      'pipe:1',
    ],
    environment,
    signal,
    timeoutMs: 300000,
    maxOutputBytes: null,
    maxBufferedBytes: 65536,
  });
  let diagnostics = Buffer.alloc(0);
  const energies = new Float64Array(barCount);
  const counts = new Float64Array(barCount);
  let frames = 0;
  let remainder = Buffer.alloc(0);
  try {
    for await (const chunk of chunks) {
      if (chunk.channel === 'stderr') {
        diagnostics = Buffer.from(Buffer.concat([diagnostics, chunk.bytes]).subarray(-65536));
        continue;
      }
      const bytes = Buffer.concat([remainder, chunk.bytes]);
      const end = bytes.length - (bytes.length % 4);
      for (let offset = 0; offset < end; offset += 4) {
        const bin = Math.min(
          barCount - 1,
          Math.floor((frames * barCount) / (duration * sampleRate))
        );
        const left = bytes.readInt16LE(offset);
        const right = bytes.readInt16LE(offset + 2);
        energies[bin] += (left * left + right * right) / 2;
        counts[bin]++;
        frames++;
      }
      remainder = Buffer.from(bytes.subarray(end));
    }
    if (!frames || remainder.length) throw new Error('Waveform decoder returned incomplete audio');
    const rms = Array.from(energies, (energy, index) =>
      counts[index] ? Math.sqrt(energy / counts[index]) : 0
    );
    const maximum = Math.max(...rms);
    return maximum ? rms.map((value) => value / maximum) : rms;
  } catch (error) {
    if (error instanceof ProcessExecutionError)
      error.diagnostics = { stdout: '', stderr: diagnostics.toString('utf8') };
    throw error;
  }
}

/**
 * Generate a spectrogram image from an audio file using FFmpeg showspectrumpic filter.
 */
export async function generateSpectrogram(
  audioPath: string,
  outputPath: string,
  width = 1920,
  height = 400,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  await executeMediaProcess(
    'ffmpeg',
    [
      '-i',
      audioPath,
      '-lavfi',
      `showspectrumpic=s=${width}x${height}:mode=combined:color=intensity:scale=log`,
      '-frames:v',
      '1',
      '-y',
      outputPath,
    ],
    { signal, timeoutMs: 300000 }
  );
  logger.info('Spectrogram generated', { audioPath, outputPath, width, height });
}
