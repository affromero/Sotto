import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { materialTextChunkSchema } from '@sotto/shared';

export interface MaterialArtifact {
  file: string;
  sha256: string;
  byteSize: number;
}

async function artifactPath(directory: string, artifact: MaterialArtifact, maximum: number) {
  if (!/^[a-z0-9.-]+$/.test(artifact.file) || artifact.file === '.' || artifact.file === '..')
    throw new Error('Invalid material artifact name.');
  const root = await realpath(directory);
  const path = join(root, artifact.file);
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== artifact.byteSize ||
    metadata.size > maximum ||
    dirname(await realpath(path)) !== root
  )
    throw new Error('Material artifact identity or byte budget changed.');
  return path;
}

export async function readMaterialArtifact(
  directory: string,
  artifact: MaterialArtifact,
  maximum: number
) {
  const bytes = await readFile(await artifactPath(directory, artifact, maximum));
  if (
    bytes.byteLength !== artifact.byteSize ||
    createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
  )
    throw new Error('Material artifact checksum changed.');
  return bytes;
}

/** Each JSON line is bounded before parsing. The enclosing transaction rolls back on a bad final hash. */
export async function* readMaterialChunkArtifact(
  directory: string,
  artifact: MaterialArtifact,
  signal: AbortSignal
) {
  const path = await artifactPath(directory, artifact, 128 * 1024 * 1024);
  const hash = createHash('sha256');
  let bytes = 0;
  let pending = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { signal, highWaterMark: 65536 })) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Material artifact is not binary.');
    bytes += chunk.byteLength;
    if (bytes > artifact.byteSize) throw new Error('Material artifact exceeds its receipt.');
    hash.update(chunk);
    pending = Buffer.concat([pending, chunk]);
    let end: number;
    while ((end = pending.indexOf(10)) >= 0) {
      if (end > 128 * 1024) throw new Error('Material text chunk exceeds its line budget.');
      const line = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        pending.subarray(0, end)
      );
      pending = pending.subarray(end + 1);
      yield materialTextChunkSchema.parse(JSON.parse(line));
    }
    if (pending.byteLength > 128 * 1024)
      throw new Error('Material text chunk exceeds its line budget.');
  }
  if (pending.byteLength || bytes !== artifact.byteSize || hash.digest('hex') !== artifact.sha256)
    throw new Error('Material text chunk artifact is incomplete or changed.');
}
