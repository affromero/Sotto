import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Download a URL to a local file path. */
export async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(dest, buffer);
}

/** Probe the duration of a media file in seconds using FFprobe. */
export async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

/**
 * Probe the duration of a remote media URL.
 * Downloads to a temp file, probes, then cleans up.
 */
export async function probeRemoteDuration(url: string, tmpPath: string): Promise<number> {
  await downloadFile(url, tmpPath);
  const duration = await probeDuration(tmpPath);
  fs.unlink(tmpPath, () => {});
  return duration;
}
