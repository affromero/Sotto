/**
 * FFmpeg utilities for video chaining — extract last frame + concatenate clips.
 * Used by the visual-generation worker to chain multiple short clips into a longer video.
 */
import { logger } from './logger';

/**
 * Extract the last frame of a video as a PNG buffer.
 * Used to create visual continuity between chained video clips.
 */
export async function extractLastFrame(videoBuffer: Buffer): Promise<Buffer> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { writeFile, readFile, unlink, mkdtemp } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const execFileAsync = promisify(execFile);

  const tmpDir = await mkdtemp(join(tmpdir(), 'video-lastframe-'));
  const inputPath = join(tmpDir, 'input.mp4');
  const outputPath = join(tmpDir, 'lastframe.png');

  await writeFile(inputPath, videoBuffer);

  try {
    // Get video duration via ffprobe
    const { stdout: durationStr } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      inputPath,
    ]);
    const duration = parseFloat(durationStr.trim());
    if (isNaN(duration) || duration <= 0) {
      throw new Error(`Could not determine video duration: ${durationStr.trim()}`);
    }

    // Seek to near the end and extract the last frame
    const seekTo = Math.max(0, duration - 0.1);
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss', String(seekTo),
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
    // Remove temp dir (best-effort)
    const { rmdir } = await import('fs/promises');
    await rmdir(tmpDir).catch(() => {});
  }
}

/**
 * Concatenate multiple video clip buffers into one using FFmpeg concat demuxer.
 * All clips must have the same codec/resolution for lossless concat.
 */
export async function concatenateVideoClips(clips: Buffer[]): Promise<Buffer> {
  if (clips.length === 0) throw new Error('No clips to concatenate');
  if (clips.length === 1) return clips[0];

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { writeFile, readFile, unlink, mkdtemp } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const execFileAsync = promisify(execFile);

  const tmpDir = await mkdtemp(join(tmpdir(), 'video-concat-'));
  const clipPaths: string[] = [];

  try {
    // Write each clip to a temp file
    for (let i = 0; i < clips.length; i++) {
      const clipPath = join(tmpDir, `clip_${i}.mp4`);
      await writeFile(clipPath, clips[i]);
      clipPaths.push(clipPath);
    }

    // Build concat list
    const concatListPath = join(tmpDir, 'concat.txt');
    const concatContent = clipPaths.map((p) => `file '${p}'`).join('\n');
    await writeFile(concatListPath, concatContent);

    const outputPath = join(tmpDir, 'output.mp4');

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      outputPath,
    ]);

    logger.info('Video clip concatenation complete', { clipCount: String(clips.length) });

    return await readFile(outputPath);
  } finally {
    // Cleanup all temp files
    const allPaths = [...clipPaths];
    allPaths.push(join(tmpDir, 'concat.txt'), join(tmpDir, 'output.mp4'));
    await Promise.allSettled(allPaths.map((p) => unlink(p)));
    const { rmdir } = await import('fs/promises');
    await rmdir(tmpDir).catch(() => {});
  }
}
