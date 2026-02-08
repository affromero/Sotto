import { logger } from './logger';

/**
 * Concatenate audio segments using FFmpeg
 * Returns the stitched audio as a Buffer
 */
export async function stitchSegments(
  segmentPaths: string[],
  outputPath: string
): Promise<void> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  // Create concat file list
  const { writeFile, unlink } = await import('fs/promises');
  const concatListPath = `${outputPath}.concat.txt`;
  const concatContent = segmentPaths.map((p) => `file '${p}'`).join('\n');

  await writeFile(concatListPath, concatContent);

  try {
    // Concatenate with FFmpeg
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-ar', '44100',
      '-ac', '2',
      // Normalize loudness
      '-filter:a', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      outputPath,
    ]);

    logger.info('Audio stitching complete', { outputPath, segmentCount: String(segmentPaths.length) });
  } finally {
    // Clean up concat list
    await unlink(concatListPath).catch(() => {});
  }
}

/**
 * Get audio duration in seconds using FFprobe
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    filePath,
  ]);

  return parseFloat(stdout.trim());
}
