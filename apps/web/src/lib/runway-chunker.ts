import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile } from 'fs/promises';
import { join } from 'path';

const execFileAsync = promisify(execFile);

export const RUNWAY_MAX_SESSION_SECONDS = 300;
export const RUNWAY_CHUNK_TARGET_SECONDS = 280; // 20s margin for setup/teardown

export interface AudioChunk {
  index: number;
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  durationSeconds: number;
}

/**
 * Split audio into chunks of ~280s for Runway's 300s session limit.
 * If audio is ≤280s, returns a single chunk (no FFmpeg split).
 */
export async function splitAudioIntoChunks(params: {
  audioPath: string;
  totalDuration: number;
  tmpDir: string;
  chunkTargetSeconds?: number;
}): Promise<AudioChunk[]> {
  const { audioPath, totalDuration, tmpDir } = params;
  const chunkTarget = params.chunkTargetSeconds ?? RUNWAY_CHUNK_TARGET_SECONDS;

  if (totalDuration <= chunkTarget) {
    return [{
      index: 0,
      inputPath: audioPath,
      outputPath: join(tmpDir, 'chunk-video-0.webm'),
      startSeconds: 0,
      durationSeconds: totalDuration,
    }];
  }

  const chunks: AudioChunk[] = [];
  let offset = 0;
  let idx = 0;

  while (offset < totalDuration) {
    const remaining = totalDuration - offset;
    const chunkDuration = Math.min(chunkTarget, remaining);
    const chunkAudioPath = join(tmpDir, `chunk-audio-${idx}.mp3`);

    await execFileAsync('ffmpeg', [
      '-y', '-i', audioPath,
      '-ss', String(offset),
      '-t', String(chunkDuration),
      '-c', 'copy',
      chunkAudioPath,
    ]);

    chunks.push({
      index: idx,
      inputPath: chunkAudioPath,
      outputPath: join(tmpDir, `chunk-video-${idx}.webm`),
      startSeconds: offset,
      durationSeconds: chunkDuration,
    });

    offset += chunkDuration;
    idx++;
  }

  return chunks;
}

/**
 * Concatenate multiple WebM video chunks using FFmpeg concat demuxer.
 * No re-encoding — fast binary concat.
 */
export async function concatenateVideoChunks(params: {
  chunks: AudioChunk[];
  outputPath: string;
}): Promise<void> {
  const { chunks, outputPath } = params;

  if (chunks.length === 1) {
    // Single chunk — just copy
    const { copyFile } = await import('fs/promises');
    await copyFile(chunks[0].outputPath, outputPath);
    return;
  }

  // Write concat list file
  const listPath = join(outputPath, '..', 'concat-list.txt');
  const listContent = chunks
    .map((c) => `file '${c.outputPath}'`)
    .join('\n');
  await writeFile(listPath, listContent);

  await execFileAsync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outputPath,
  ]);
}
