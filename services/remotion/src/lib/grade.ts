/**
 * FFmpeg warm amber grading for demo recordings.
 * Adapted from scripts/recording/lib/grade.ts.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Warm amber filter chain:
 * - fade: 0.5s black→transparent
 * - curves: warm shift (+blue midtones, -red)
 * - eq: contrast +3%, saturation +4%
 * - unsharp: 3x3 kernel for UI crispness
 */
const WARM_AMBER_FILTER = [
  'fade=t=in:st=0:d=0.5',
  'curves=preset=lighter',
  'eq=contrast=1.03:saturation=1.04',
  'unsharp=3:3:0.4',
].join(',');

/**
 * Apply warm amber color grading to a video file.
 * Outputs h264 MP4 with AAC audio.
 */
export async function gradeVideo(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', WARM_AMBER_FILTER,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '15',
    '-c:a', 'aac',
    '-b:a', '128k',
    outputPath,
  ], { timeout: 300000 }); // 5 min timeout
}
