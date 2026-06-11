import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const execFileAsync = promisify(execFile);

/**
 * Get a file extension from a MIME type string.
 */
export function getExtensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/webm': 'webm',
    'audio/webm;codecs=opus': 'webm',
    'audio/ogg': 'ogg',
    'audio/ogg;codecs=opus': 'ogg',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
  };
  return map[mimeType.toLowerCase()] ?? 'bin';
}

/**
 * Transcode an audio buffer to 128k mono 44100Hz MP3 via FFmpeg.
 * Used for normalizing uploaded audio before sending it to provider APIs.
 */
export async function transcodeToMp3(
  inputBuffer: Buffer,
  inputExtension: string
): Promise<Buffer> {
  const tmpDir = path.join(
    os.tmpdir(),
    `sotto-transcode-${crypto.randomUUID()}`
  );
  const inputPath = path.join(tmpDir, `input.${inputExtension}`);
  const outputPath = path.join(tmpDir, 'output.mp3');

  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(inputPath, inputBuffer);

    await execFileAsync('ffmpeg', [
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      '44100',
      '-b:a',
      '128k',
      '-y',
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
