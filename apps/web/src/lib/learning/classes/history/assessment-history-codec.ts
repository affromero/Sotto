import { createHash } from 'node:crypto';
import { z } from 'zod';

const chunkBytes = 512 * 1024;
const maxBytes = 32 * 1024 * 1024;
const maxChunks = maxBytes / chunkBytes;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const assessmentHistoryManifestSchema = z
  .object({
    version: z.literal(1),
    digest: sha256,
    bytes: z.number().int().min(1).max(maxBytes),
    chunks: z.number().int().min(1).max(maxChunks),
  })
  .strict()
  .refine((value) => value.chunks === Math.ceil(value.bytes / chunkBytes));

const chunkSchema = z
  .object({ version: z.literal(1), index: z.number().int().nonnegative(), data: z.string() })
  .strict();

/** Encode a bounded JSON record into pages small enough for the Sidedoor snapshot limit. */
export function encodeAssessmentHistory(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(z.json().parse(value)), 'utf8');
  if (bytes.length === 0 || bytes.length > maxBytes)
    throw new Error('Assessment history exceeds its size limit.');
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    chunks.push({
      version: 1 as const,
      index: chunks.length,
      data: bytes.subarray(offset, offset + chunkBytes).toString('base64'),
    });
  }
  return {
    manifest: assessmentHistoryManifestSchema.parse({
      version: 1,
      digest: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      chunks: chunks.length,
    }),
    chunks,
  };
}

/** Decode only complete, ordered, canonically encoded pages matching their manifest. */
export function decodeAssessmentHistory(manifestInput: unknown, chunksInput: readonly unknown[]) {
  const manifest = assessmentHistoryManifestSchema.parse(manifestInput);
  if (chunksInput.length !== manifest.chunks) throw new Error('Assessment history is incomplete.');
  const parts = chunksInput.map((input, index) => {
    const chunk = chunkSchema.parse(input);
    const expectedBytes = Math.min(chunkBytes, manifest.bytes - index * chunkBytes);
    const expectedLength = Math.ceil(expectedBytes / 3) * 4;
    if (chunk.index !== index || chunk.data.length !== expectedLength)
      throw new Error('Assessment history page is invalid.');
    const decoded = Buffer.from(chunk.data, 'base64');
    if (decoded.length !== expectedBytes || decoded.toString('base64') !== chunk.data)
      throw new Error('Assessment history page is invalid.');
    return decoded;
  });
  const bytes = Buffer.concat(parts, manifest.bytes);
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.digest)
    throw new Error('Assessment history digest does not match.');
  return z.json().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
