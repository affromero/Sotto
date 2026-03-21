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
 * Speed up a video to a target duration using FFmpeg setpts filter.
 * The source video must be longer than targetDurationSeconds.
 * Used when a provider enforces a minimum duration (e.g., Fal requires >= 4s).
 */
export async function speedUpVideo(videoBuffer: Buffer, targetDurationSeconds: number): Promise<Buffer> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { writeFile, readFile, unlink, mkdtemp } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const execFileAsync = promisify(execFile);

  const tmpDir = await mkdtemp(join(tmpdir(), 'video-speedup-'));
  const inputPath = join(tmpDir, 'input.mp4');
  const outputPath = join(tmpDir, 'output.mp4');

  await writeFile(inputPath, videoBuffer);

  try {
    // Get actual duration via ffprobe
    const { stdout: durationStr } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      inputPath,
    ]);
    const sourceDuration = parseFloat(durationStr.trim());
    if (isNaN(sourceDuration) || sourceDuration <= 0) {
      throw new Error(`Could not determine video duration: ${durationStr.trim()}`);
    }

    const ptsFactor = targetDurationSeconds / sourceDuration;
    logger.info('Speeding up video', { sourceDuration, targetDurationSeconds, ptsFactor });

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-filter:v', `setpts=${ptsFactor}*PTS`,
      '-an',
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
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

// ---------------------------------------------------------------------------
// Per-segment preview concatenation
// ---------------------------------------------------------------------------

interface PreviewSegment {
  order: number;
  previewUrl: string;
}

/**
 * Concatenate pre-rendered segment previews into a final video via FFmpeg.
 * All previews must use the same codec, resolution, and frame rate.
 */
export async function concatenateSegmentPreviews(
  segments: PreviewSegment[],
  audioUrl: string,
): Promise<Buffer> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const { v4: uuidv4 } = await import('uuid');
  const execAsync = promisify(exec);

  const tmpDir = path.join(os.tmpdir(), `sotto-concat-${uuidv4()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const sorted = [...segments].sort((a, b) => a.order - b.order);

  try {
    // Download all preview MP4s
    const localPaths: string[] = [];
    await Promise.all(
      sorted.map(async (seg, i) => {
        const localPath = path.join(tmpDir, `seg-${String(i).padStart(4, '0')}.mp4`);
        const response = await fetch(seg.previewUrl);
        if (!response.ok) throw new Error(`Failed to download preview: ${seg.previewUrl}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(localPath, buffer);
        localPaths[i] = localPath;
      }),
    );

    // Create FFmpeg concat file
    const concatFile = path.join(tmpDir, 'concat.txt');
    const concatContent = localPaths.map((p) => `file '${p}'`).join('\n');
    fs.writeFileSync(concatFile, concatContent);

    // Download audio
    const audioPath = path.join(tmpDir, 'audio.mp3');
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) throw new Error(`Failed to download audio: ${audioUrl}`);
    fs.writeFileSync(audioPath, Buffer.from(await audioResponse.arrayBuffer()));

    // Concatenate videos + mux audio
    const outputPath = path.join(tmpDir, 'final.mp4');
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -i "${audioPath}" ` +
      `-c:v copy -c:a aac -b:a 192k -shortest "${outputPath}"`,
      { timeout: 300000 },
    );

    const result = fs.readFileSync(outputPath);

    logger.info('Video preview concatenation complete', {
      segments: String(sorted.length),
      size: String(result.length),
    });

    return result;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
