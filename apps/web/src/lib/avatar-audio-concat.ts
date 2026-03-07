import { logger } from './logger';

export async function concatenateSpeakerAudio(params: {
  segments: Array<{ audioUrl: string; order: number }>;
  outputPath: string;
}): Promise<{ durationSeconds: number }> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { writeFile, unlink, mkdir } = await import('fs/promises');
  const { join, dirname } = await import('path');
  const execFileAsync = promisify(execFile);

  const { segments, outputPath } = params;
  if (segments.length === 0) {
    throw new Error('No segments to concatenate');
  }

  const sorted = [...segments].sort((a, b) => a.order - b.order);
  const tmpDir = dirname(outputPath);
  await mkdir(tmpDir, { recursive: true });

  // Download each segment audio to tmp
  const localPaths: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const localPath = join(tmpDir, `seg_${i}.mp3`);
    const res = await fetch(sorted[i].audioUrl);
    if (!res.ok) {
      throw new Error(`Failed to download segment audio (${res.status}): ${sorted[i].audioUrl}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(localPath, buffer);
    localPaths.push(localPath);
  }

  // Build concat list file
  const concatListPath = join(tmpDir, 'concat.txt');
  const concatContent = localPaths.map((p) => `file '${p}'`).join('\n');
  await writeFile(concatListPath, concatContent);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '1',
      outputPath,
    ]);

    // Get duration via ffprobe
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      outputPath,
    ]);

    const durationSeconds = parseFloat(stdout.trim());

    logger.info('Speaker audio concatenation complete', {
      segmentCount: String(sorted.length),
      durationSeconds: String(Math.round(durationSeconds)),
    });

    return { durationSeconds };
  } finally {
    // Cleanup temp files
    await Promise.allSettled([
      unlink(concatListPath),
      ...localPaths.map((p) => unlink(p)),
    ]);
  }
}
