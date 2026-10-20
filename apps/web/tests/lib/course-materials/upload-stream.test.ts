// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { materialUploadLimits } from '@sotto/shared';
import {
  createMaterialUploadStream,
  MaterialUploadStreamError,
} from '@/lib/course-materials/uploads/stream';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function requestFor(
  bytes: Uint8Array<ArrayBuffer>,
  signal = new AbortController().signal
): Pick<Request, 'body' | 'signal'> {
  return {
    signal,
    body: new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}
async function consume(body: AsyncIterable<unknown>) {
  let byteSize = 0;
  const hash = createHash('sha256');
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Expected byte chunks');
    byteSize += chunk.byteLength;
    hash.update(chunk);
  }
  return { byteSize, sha256: hash.digest('hex') };
}

describe('verified streaming material upload parts', () => {
  it('exposes the first bytes before EOF and releases a digest only after complete consumption', async () => {
    const prefix = Buffer.from('First page.');
    const suffix = Buffer.from('Last page.');
    const expected = Buffer.concat([prefix, suffix]);
    let controller!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
    const upload = createMaterialUploadStream(
      {
        signal: new AbortController().signal,
        body: new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(supplied) {
            controller = supplied;
            controller.enqueue(prefix);
          },
        }),
      },
      { declaredFileBytes: expected.length, index: 0, sha256: sha256(expected) }
    );
    expect(() => upload.getVerification()).toThrow(MaterialUploadStreamError);
    const iterator = upload.body[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value)).toEqual(prefix);
    expect(() => upload.getVerification()).toThrow('successful complete stream consumption');
    controller.enqueue(suffix);
    controller.close();
    const remaining = await consume({ [Symbol.asyncIterator]: () => iterator });
    expect(remaining.byteSize).toBe(suffix.length);
    const verified = upload.getVerification();
    expect(verified).toEqual({
      index: 0,
      offset: 0,
      byteSize: expected.length,
      sha256: sha256(expected),
    });
    verified.sha256 = '0'.repeat(64);
    expect(upload.getVerification().sha256).toBe(sha256(expected));
  });

  it('streams a full four-MiB part without accumulating its body in the consumer', async () => {
    const chunk = Buffer.alloc(65536, 42);
    const count = materialUploadLimits.partBytes / chunk.length;
    const hash = createHash('sha256');
    for (let index = 0; index < count; index++) hash.update(chunk);
    const expectedSha = hash.digest('hex');
    let remaining = count;
    const upload = createMaterialUploadStream(
      {
        signal: new AbortController().signal,
        body: new ReadableStream<Uint8Array<ArrayBuffer>>({
          pull(controller) {
            if (!remaining) {
              controller.close();
              return;
            }
            remaining--;
            controller.enqueue(chunk);
          },
        }),
      },
      { declaredFileBytes: materialUploadLimits.partBytes, index: 0, sha256: expectedSha }
    );
    expect(await consume(upload.body)).toEqual({
      byteSize: materialUploadLimits.partBytes,
      sha256: expectedSha,
    });
    expect(upload.getVerification()).toMatchObject({
      byteSize: materialUploadLimits.partBytes,
      sha256: expectedSha,
    });
  });

  it('derives the last part byte count from the complete declared file', async () => {
    const bytes = Buffer.from('last');
    const upload = createMaterialUploadStream(requestFor(bytes), {
      declaredFileBytes: materialUploadLimits.partBytes + bytes.length,
      index: 1,
      sha256: sha256(bytes),
    });
    await consume(upload.body);
    expect(upload.getVerification()).toEqual({
      index: 1,
      offset: materialUploadLimits.partBytes,
      byteSize: 4,
      sha256: sha256(bytes),
    });
  });

  it('rejects early EOF without exposing a verified digest', async () => {
    const bytes = Buffer.from('short');
    const upload = createMaterialUploadStream(requestFor(bytes), {
      declaredFileBytes: bytes.length + 1,
      index: 0,
      sha256: sha256(bytes),
    });
    await expect(consume(upload.body)).rejects.toMatchObject({ code: 'length_mismatch' });
    expect(() => upload.getVerification()).toThrow('successful complete stream consumption');
  });

  it('rejects an oversized body before it can produce a verified digest', async () => {
    const bytes = Buffer.from('too long');
    const upload = createMaterialUploadStream(requestFor(bytes), {
      declaredFileBytes: bytes.length - 1,
      index: 0,
      sha256: sha256(bytes),
    });
    await expect(consume(upload.body)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(() => upload.getVerification()).toThrow('successful complete stream consumption');
  });

  it('rejects a checksum mismatch after full consumption without releasing its digest', async () => {
    const bytes = Buffer.from('content');
    const upload = createMaterialUploadStream(requestFor(bytes), {
      declaredFileBytes: bytes.length,
      index: 0,
      sha256: '0'.repeat(64),
    });
    await expect(consume(upload.body)).rejects.toMatchObject({ code: 'checksum_mismatch' });
    expect(() => upload.getVerification()).toThrow('successful complete stream consumption');
  });

  it('rejects cancellation before taking ownership of the request body', () => {
    const bytes = Buffer.from('content');
    const reason = new Error('Upload cancelled');
    expect(() =>
      createMaterialUploadStream(requestFor(bytes, AbortSignal.abort(reason)), {
        declaredFileBytes: bytes.length,
        index: 0,
        sha256: sha256(bytes),
      })
    ).toThrow(reason);
  });

  it('cancels a pending upstream read when the caller aborts and exposes no verified digest', async () => {
    const controller = new AbortController();
    let cancelled = false;
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const upload = createMaterialUploadStream(
      {
        signal: new AbortController().signal,
        body: new ReadableStream<Uint8Array<ArrayBuffer>>({
          pull() {
            entered();
          },
          cancel() {
            cancelled = true;
          },
        }),
      },
      { declaredFileBytes: 100, index: 0, sha256: '0'.repeat(64) },
      controller.signal
    );
    const consumed = consume(upload.body);
    const rejected = expect(consumed).rejects.toMatchObject({ name: 'AbortError' });
    await reading;
    const reason = new Error('Worker stopped');
    controller.abort(reason);
    await rejected;
    expect(cancelled).toBe(true);
    expect(() => upload.getVerification()).toThrow(reason);
  });

  it('rejects a missing body and malformed checksum before exposing a stream', () => {
    const input = { declaredFileBytes: 1, index: 0, sha256: 'a'.repeat(64) };
    expect(() =>
      createMaterialUploadStream({ signal: new AbortController().signal, body: null }, input)
    ).toThrow('request body');
    expect(() =>
      createMaterialUploadStream(requestFor(Buffer.from('a')), { ...input, sha256: 'missing' })
    ).toThrow();
  });
});
