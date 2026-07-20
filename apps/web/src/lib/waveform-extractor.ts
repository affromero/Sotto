import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/lib/logger';

const execFileAsync = promisify(execFile);

/**
 * Extract waveform peaks from an audio file using FFmpeg astats filter.
 * Returns a normalized 0-1 array suitable for rendering a waveform visualization.
 */
export async function extractWaveformPeaks(audioPath: string, barCount = 200): Promise<number[]> {
  // Get audio duration first
  const { stdout: probeOut } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    audioPath,
  ]);
  const totalDuration = parseFloat(probeOut.trim());
  if (!totalDuration || totalDuration <= 0) {
    throw new Error(`Could not determine audio duration: ${probeOut.trim()}`);
  }

  const windowDuration = totalDuration / barCount;

  // Use FFmpeg volumedetect-style approach: segment audio into windows and measure RMS
  const { stderr } = await execFileAsync(
    'ffmpeg',
    [
      '-i',
      audioPath,
      '-af',
      `asegment=timestamps=${Array.from({ length: barCount - 1 }, (_, i) => ((i + 1) * windowDuration).toFixed(4)).join('|')},astats=metadata=1:reset=1`,
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  // Parse RMS_level values from stderr
  const rmsValues: number[] = [];
  const rmsRegex = /RMS level dB:\s*([-\d.]+|inf|-inf)/g;
  let match;
  while ((match = rmsRegex.exec(stderr)) !== null) {
    const db = match[1];
    if (db === '-inf' || db === 'inf') {
      rmsValues.push(0);
    } else {
      // Convert dB to linear: 10^(dB/20)
      rmsValues.push(Math.pow(10, parseFloat(db) / 20));
    }
  }

  if (rmsValues.length === 0) {
    logger.warn('No RMS values extracted, falling back to peak detection', { audioPath });
    return extractWaveformPeaksFallback(audioPath, barCount);
  }

  // FFmpeg astats reports per-channel — take every other value (or average stereo pairs)
  // We get 2 RMS values per segment for stereo (Overall for each segment)
  // Group by segment: astats outputs per-channel then overall for each segment
  const segmentRms = consolidateRmsValues(rmsValues, barCount);

  // Normalize to 0-1
  const maxRms = Math.max(...segmentRms, 0.0001);
  return segmentRms.map((v) => Math.min(v / maxRms, 1));
}

/**
 * Consolidate raw RMS values into per-segment values.
 * astats outputs multiple RMS entries per segment (per-channel + overall).
 * We take the overall values and reduce to the target bar count.
 */
function consolidateRmsValues(rmsValues: number[], targetCount: number): number[] {
  if (rmsValues.length <= targetCount) {
    // Pad with zeros if fewer values than bars
    return [...rmsValues, ...Array(targetCount - rmsValues.length).fill(0)];
  }

  // Downsample by averaging windows
  const result: number[] = [];
  const step = rmsValues.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += rmsValues[j];
    }
    result.push(sum / (end - start));
  }
  return result;
}

/**
 * Fallback: extract peaks using showwavespic filter and parsing pixel values.
 * Simpler but less accurate than astats.
 */
async function extractWaveformPeaksFallback(
  audioPath: string,
  barCount: number
): Promise<number[]> {
  // Use showwavespic to generate a 1-pixel-high waveform image, then read pixel values
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-i',
      audioPath,
      '-filter_complex',
      `showwavespic=s=${barCount}x1:colors=white`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'pipe:1',
    ],
    { encoding: 'buffer' as unknown as string, maxBuffer: 10 * 1024 * 1024 }
  );

  const buffer = Buffer.from(stdout);
  if (buffer.length === 0) {
    // Ultimate fallback: flat waveform
    return Array(barCount).fill(0.5);
  }

  const maxVal = Math.max(...buffer, 1);
  return Array.from(buffer)
    .slice(0, barCount)
    .map((v) => v / maxVal);
}

/**
 * Generate a spectrogram image from an audio file using FFmpeg showspectrumpic filter.
 */
export async function generateSpectrogram(
  audioPath: string,
  outputPath: string,
  width = 1920,
  height = 400
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-i',
    audioPath,
    '-lavfi',
    `showspectrumpic=s=${width}x${height}:mode=combined:color=intensity:scale=log`,
    '-frames:v',
    '1',
    '-y',
    outputPath,
  ]);
  logger.info('Spectrogram generated', { audioPath, outputPath, width, height });
}
