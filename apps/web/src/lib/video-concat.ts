import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';

const execAsync = promisify(exec);

interface PreviewSegment {
  order: number;
  previewUrl: string;
}

/**
 * Concatenate pre-rendered segment previews into a final video via FFmpeg.
 * All previews must use the same codec, resolution, and frame rate.
 *
 * Returns the final MP4 as a Buffer.
 */
export async function concatenateSegmentPreviews(
  segments: PreviewSegment[],
  audioUrl: string,
): Promise<Buffer> {
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

    logger.info('Video concatenation complete', {
      segments: String(sorted.length),
      size: String(result.length),
    });

    return result;
  } finally {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
