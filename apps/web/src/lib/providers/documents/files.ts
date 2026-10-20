import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { StorageReadCleanupError } from 'thesidedoor-core/storage';

interface FileReadLimits {
  maximum: number;
  expectedBytes?: number;
  allowEmpty?: boolean;
  signal?: AbortSignal;
}

/** Keep type, size, reads and closure bound to the same descriptor. */
export async function withBoundedRegularFile<T>(
  path: string,
  limits: FileReadLimits,
  read: (file: FileHandle, size: number) => Promise<T>
): Promise<T> {
  if (!Number.isSafeInteger(limits.maximum) || limits.maximum < 1)
    throw new Error('Invalid file read size limit.');
  limits.signal?.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let failure: { error: unknown } | undefined;
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.size < (limits.allowEmpty ? 0 : 1) ||
      stat.size > limits.maximum ||
      (limits.expectedBytes !== undefined && stat.size !== limits.expectedBytes)
    )
      throw new Error('Invalid file type or size for the complete processing budget.');
    limits.signal?.throwIfAborted();
    const result = await read(file, stat.size);
    limits.signal?.throwIfAborted();
    return result;
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    try {
      await file.close();
    } catch (cause) {
      throw new StorageReadCleanupError({
        cause: failure
          ? new AggregateError([failure.error, cause], 'File read and closure failed')
          : cause,
      });
    }
  }
}

/** Read only the admitted bytes, rejecting concurrent growth or truncation. */
export async function readBoundedRegularFile(
  path: string,
  limits: FileReadLimits
): Promise<Buffer> {
  return withBoundedRegularFile(path, limits, async (file, size) => {
    const data = Buffer.alloc(size);
    let offset = 0;
    while (offset < data.length) {
      limits.signal?.throwIfAborted();
      const read = await file.read(data, offset, Math.min(data.length - offset, 65536));
      if (!read.bytesRead) throw new Error('File was truncated.');
      offset += read.bytesRead;
    }
    if ((await file.read(Buffer.alloc(1))).bytesRead) throw new Error('File changed.');
    return data;
  });
}
