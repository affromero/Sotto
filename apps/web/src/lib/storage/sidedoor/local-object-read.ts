import { open } from 'node:fs/promises';

export function contentTypeForStorageKey(key: string): string {
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.m4a')) return 'audio/mp4';
  if (key.endsWith('.wav')) return 'audio/wav';
  if (key.endsWith('.webm')) return 'audio/webm';
  if (key.endsWith('.pdf')) return 'application/pdf';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

export async function readLocalStorageFile(
  filePath: string,
  key: string,
  range?: string | null
): Promise<{ body: Buffer; size: number; contentType: string; start: number; end: number } | null> {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ filePath, 'r');
  } catch {
    return null;
  }
  try {
    const size = (await handle.stat()).size;
    let start = 0;
    let end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) return null;
      const [, rawStart, rawEnd] = match;
      if (rawStart === '') {
        const suffix = Number(rawEnd);
        if (!Number.isFinite(suffix) || suffix <= 0) return null;
        start = Math.max(0, size - suffix);
      } else {
        start = Number(rawStart);
        if (rawEnd !== '') end = Math.min(end, Number(rawEnd));
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size)
        return null;
    }
    const body = Buffer.alloc(end - start + 1);
    await handle.read(body, 0, body.length, start);
    return { body, size, contentType: contentTypeForStorageKey(key), start, end };
  } finally {
    await handle.close();
  }
}
