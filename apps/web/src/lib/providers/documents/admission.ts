import { abortable } from 'thesidedoor-core/runtime/stream';

let tail: Promise<void> | undefined;
let pending = 0;

/** Bound native rendering memory without changing worker job concurrency. */
export async function withPdfRender<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (pending >= 2) throw new Error('PDF rendering is busy. Retry after current documents finish.');
  pending++;
  const previous = tail;
  let release!: () => void;
  const completed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ownTail = previous ? previous.then(() => completed) : completed;
  tail = ownTail;
  try {
    if (previous) await (signal ? abortable(previous, signal) : previous);
    signal?.throwIfAborted();
    return await work();
  } finally {
    pending--;
    release();
    if (tail === ownTail) {
      void ownTail.then(() => {
        if (tail === ownTail) tail = undefined;
      });
    }
  }
}
