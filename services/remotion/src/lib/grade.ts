/**
 * FFmpeg warm amber grading for demo recordings.
 * Adapted from scripts/recording/lib/grade.ts.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Warm amber filter chain:
 * - scale: Lanczos downsample from 2× HiDPI source → final output resolution
 * - fade: 0.5s black→transparent
 * - curves: warm lighter shift
 * - eq: contrast +3%, saturation +4%
 * - unsharp: 5×5 kernel for maximum UI crispness
 */
const WARM_AMBER_FILTER = [
  'scale=iw/2:ih/2:flags=lanczos',
  'fade=t=in:st=0:d=0.5',
  'curves=preset=lighter',
  'eq=contrast=1.03:saturation=1.04',
  'unsharp=5:5:0.8',
].join(',');

/**
 * Apply warm amber color grading to a video file.
 * Input is expected to be 2× HiDPI (e.g. 3840×2160); output is half-res (1920×1080).
 * Outputs H264 High Profile MP4, no audio (screen recordings have none).
 */
export async function gradeVideo(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', WARM_AMBER_FILTER,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '12',
    '-profile:v', 'high',
    '-level:v', '4.2',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    outputPath,
  ], { timeout: 600_000 }); // 10 min — slow preset on large frames takes time
}
