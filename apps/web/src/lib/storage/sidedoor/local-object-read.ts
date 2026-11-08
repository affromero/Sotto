import { open } from 'node:fs/promises';

export function contentTypeForStorageKey(key: string): string {
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.m4a')) return 'audio/mp4';
  if (key.endsWith('.wav')) return 'audio/wav';
  if (key.endsWith('.webm')) return 'audio/webm';
  if (key.endsWith('.ogg')) return 'audio/ogg';
  if (key.endsWith('.flac')) return 'audio/flac';
  if (key.endsWith('.pdf')) return 'application/pdf';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

/** Resolve a single HTTP byte range against the exact stored file size. */
export function parseStorageByteRange(range: string | null | undefined, size: number) {
  if (!Number.isSafeInteger(size) || size < 0) return null;
  if (!range) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || size === 0) return null;
  const [, rawStart, rawEnd] = match;
  let start = 0;
  let end = size - 1;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
  } else {
    start = Number(rawStart);
    if (rawEnd !== '') end = Math.min(end, Number(rawEnd));
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
    return null;
  return { start, end };
}

export async function readLocalStorageFile(
  filePath: string,
  key: string,
  range?: string | null
): Promise<{ body: Buffer; size: number; contentType: string; start: number; end: number } | null> {
  const result = await readLocalStorageRange(filePath, key, range);
  if (!result) return null;
  const { body, size, contentType, start, end } = result;
  return { body, size, contentType, start, end };
}

/** Capture the file identity before and after each bounded read. */
export async function readLocalStorageRange(filePath: string, key: string, range?: string | null) {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ filePath, 'r');
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return null;
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    const size = Number(before.size);
    if (!Number.isSafeInteger(size)) throw new Error('Stored object is too large');
    const selection = parseStorageByteRange(range, size);
    if (!selection) return null;
    const { start, end } = selection;
    const body = Buffer.alloc(end - start + 1);
    const { bytesRead } = await handle.read(body, 0, body.length, start);
    if (bytesRead !== body.length) throw new Error('Stored object changed during read');
    const after = await handle.stat({ bigint: true });
    const identity = {
      kind: 'local' as const,
      device: before.dev.toString(),
      inode: before.ino.toString(),
      size: before.size.toString(),
      modified: before.mtimeNs.toString(),
      changed: before.ctimeNs.toString(),
    };
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error('Stored object changed during read');
    return { body, size, contentType: contentTypeForStorageKey(key), start, end, identity };
  } finally {
    await handle.close();
  }
}
