import {
  LocalStorageReader,
  LocalStorageWriter,
  normalizeStorageReference,
  type LocalStorageCleanup,
} from 'thesidedoor-core/storage';
import type { CapturedStorageBackend } from '@/lib/r2';

export async function capturedLocalBackend(
  cleanup: LocalStorageCleanup,
  referenceRoot: string,
  routePrefix: string,
  assertDelete: (key: string, options?: { force?: boolean }) => void
): Promise<CapturedStorageBackend> {
  const writer = await LocalStorageWriter.restore(cleanup.identity);
  const reader = await LocalStorageReader.restore(cleanup.identity);
  const normalize = (reference: string) => {
    if (reference.startsWith('file://'))
      throw new Error('Local storage references must use the authenticated storage route');
    return normalizeStorageReference({ kind: 'local', root: referenceRoot }, reference, {
      localRoutePrefix: routePrefix,
    });
  };
  const url = (key: string) => `${routePrefix}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return {
    descriptor: Object.freeze({ kind: 'local', identity: cleanup.identity, referenceRoot }),
    normalize,
    downloadToFile: async (reference, destination, signal) =>
      reader.copyToFile(normalize(reference), destination, signal),
    list: async function* (prefix, signal) {
      signal?.throwIfAborted();
      for await (const key of cleanup.list(prefix)) {
        signal?.throwIfAborted();
        yield key;
      }
      signal?.throwIfAborted();
    },
    has: async (key, signal) => {
      signal?.throwIfAborted();
      const exists = await cleanup.has(key);
      signal?.throwIfAborted();
      return exists;
    },
    writeBuffer: async (key, body, contentType, signal) => {
      if (!contentType.trim()) throw new Error('Storage content type is required');
      await writer.writeImmutable(key, body, signal);
      return url(key);
    },
    writeStream: async (key, body, contentType, signal) => {
      try {
        if (!contentType.trim()) throw new Error('Storage content type is required');
        await writer.writeImmutable(key, body, signal);
        return url(key);
      } finally {
        body.destroy();
      }
    },
    delete: async (key, options) => {
      options?.signal?.throwIfAborted();
      assertDelete(key, options);
      await cleanup.delete(key);
      options?.signal?.throwIfAborted();
    },
  };
}
