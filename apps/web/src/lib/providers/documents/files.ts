import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { StorageReadCleanupError } from 'thesidedoor-core/storage';

/** Bound allocation and reads to the same regular-file descriptor. */
export async function readPdfFile(
  path: string,
  limits: { maximum: number; expectedBytes?: number }
): Promise<Buffer> {
  if (!Number.isSafeInteger(limits.maximum) || limits.maximum < 1)
    throw new Error('Invalid PDF file size limit.');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let primary: unknown;
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > limits.maximum ||
      (limits.expectedBytes !== undefined && stat.size !== limits.expectedBytes)
    )
      throw new Error('Invalid PDF file type or size.');
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const read = await file.read(data, offset, data.length - offset);
      if (!read.bytesRead) throw new Error('PDF file was truncated.');
      offset += read.bytesRead;
    }
    if ((await file.read(Buffer.alloc(1))).bytesRead) throw new Error('PDF file changed.');
    return data;
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      await file.close();
    } catch (cause) {
      throw new StorageReadCleanupError({
        cause: primary
          ? new AggregateError([primary, cause], 'PDF read and closure failed')
          : cause,
      });
    }
  }
}
