import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { materialUploadSha256Schema } from '@sotto/shared';
import { planMaterialUploadPart, type MaterialUploadPlannedPart } from './protocol';

export class MaterialUploadStreamError extends Error {
  constructor(
    readonly code: 'missing_body' | 'length_mismatch' | 'checksum_mismatch' | 'not_verified',
    message: string
  ) {
    super(message);
    this.name = 'MaterialUploadStreamError';
  }
}

export interface VerifiedMaterialUploadPart extends MaterialUploadPlannedPart {
  sha256: string;
}

export interface MaterialUploadStream {
  body: Readable;
  getVerification(): VerifiedMaterialUploadPart;
}

/**
 * The declared size and index come from the reserved server session and route.
 * The SHA-256 comes from the mandatory part header. No storage is published here.
 */
export function createMaterialUploadStream(
  request: Pick<Request, 'body' | 'signal'>,
  input: { declaredFileBytes: number; index: number; sha256: string },
  cancellation?: AbortSignal
): MaterialUploadStream {
  const planned = planMaterialUploadPart(input.declaredFileBytes, input.index);
  const expectedSha256 = materialUploadSha256Schema.parse(input.sha256);
  const signal = cancellation ? AbortSignal.any([request.signal, cancellation]) : request.signal;
  signal.throwIfAborted();
  if (!request.body || request.body.locked)
    throw new MaterialUploadStreamError('missing_body', 'An unlocked request body is required.');

  // DOM and node:stream/web declarations describe this same native Web stream.
  const source = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0], {
    signal,
    highWaterMark: 65536,
  });
  let verified: VerifiedMaterialUploadPart | undefined;
  const body: Readable = source.compose(
    async function* (chunks: AsyncIterable<unknown>) {
      const hash = createHash('sha256');
      let received = 0;
      for await (const chunk of chunks) {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array))
          throw new MaterialUploadStreamError(
            'length_mismatch',
            'Upload body chunks must be bytes.'
          );
        if (chunk.byteLength > planned.byteSize - received)
          throw new RequestBodyTooLargeError(planned.byteSize);
        received += chunk.byteLength;
        hash.update(chunk);
        yield Buffer.from(chunk);
      }
      signal.throwIfAborted();
      if (received !== planned.byteSize)
        throw new MaterialUploadStreamError(
          'length_mismatch',
          'The complete part body must match its server-derived byte count.'
        );
      const sha256 = hash.digest('hex');
      if (sha256 !== expectedSha256)
        throw new MaterialUploadStreamError(
          'checksum_mismatch',
          'The part SHA-256 does not match.'
        );
      verified = { ...planned, sha256 };
    },
    { signal }
  );
  return {
    body,
    getVerification() {
      signal.throwIfAborted();
      if (!body.readableEnded || body.errored || !verified)
        throw new MaterialUploadStreamError(
          'not_verified',
          'Part verification is available only after successful complete stream consumption.'
        );
      return { ...verified };
    },
  };
}
