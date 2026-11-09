import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { deriveOwnedCredentialKey } from '@/lib/credentials/byok-crypto';

export const SPEAKING_REFERENCE_CHUNK_BYTES = 256 * 1024;
export const SPEAKING_REFERENCE_MAX_BYTES = 64 * 1024 * 1024;
const TAG_BYTES = 16;
const id = z.string().min(1).max(200);
const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

const speakingReferenceBindingSchema = z
  .object({
    instanceId: uuid,
    userId: id,
    userCreatedAt: z.number().int().safe(),
    courseId: id,
    courseCreatedAt: z.number().int().safe(),
    classId: id,
    classCreatedAt: z.number().int().safe(),
    sectionId: id,
    sectionIncarnationId: uuid,
    promptId: id,
    promptIncarnationId: uuid,
    attempt: z.number().int().positive(),
    operationId: uuid,
    sourceHash: digest,
  })
  .strict();
export type SpeakingReferenceBinding = z.infer<typeof speakingReferenceBindingSchema>;

export const speakingReferenceEnvelopeSchema = z
  .object({
    version: z.literal(1),
    binding: speakingReferenceBindingSchema,
    byteLength: z.number().int().min(1).max(SPEAKING_REFERENCE_MAX_BYTES),
    chunkBytes: z.literal(SPEAKING_REFERENCE_CHUNK_BYTES),
    chunkCount: z
      .number()
      .int()
      .min(1)
      .max(SPEAKING_REFERENCE_MAX_BYTES / SPEAKING_REFERENCE_CHUNK_BYTES),
    noncePrefix: base64,
    keyId: digest,
    wrapNonce: base64,
    wrappedKey: base64,
    wrapTag: base64,
  })
  .strict();
export type SpeakingReferenceEnvelope = z.infer<typeof speakingReferenceEnvelopeSchema>;

function decode(value: string, length: number): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== length || bytes.toString('base64') !== value)
    throw new Error('Invalid speaking reference envelope');
  return bytes;
}

function validated(value: unknown): SpeakingReferenceEnvelope {
  const envelope = speakingReferenceEnvelopeSchema.parse(value);
  if (envelope.chunkCount !== Math.ceil(envelope.byteLength / envelope.chunkBytes))
    throw new Error('Invalid speaking reference envelope');
  decode(envelope.noncePrefix, 8);
  decode(envelope.wrapNonce, 12);
  decode(envelope.wrappedKey, 32);
  decode(envelope.wrapTag, TAG_BYTES);
  return envelope;
}

function immutable(envelope: SpeakingReferenceEnvelope) {
  return {
    version: envelope.version,
    binding: envelope.binding,
    byteLength: envelope.byteLength,
    chunkBytes: envelope.chunkBytes,
    chunkCount: envelope.chunkCount,
    noncePrefix: envelope.noncePrefix,
  };
}

function wrapAad(envelope: SpeakingReferenceEnvelope) {
  return Buffer.from(
    JSON.stringify({
      domain: 'sotto-speaking-reference-wrap-v1',
      ...immutable(envelope),
      keyId: envelope.keyId,
      wrapNonce: envelope.wrapNonce,
    })
  );
}

function chunkAad(envelope: SpeakingReferenceEnvelope, index: number, length: number) {
  return Buffer.from(
    JSON.stringify({
      domain: 'sotto-speaking-reference-chunk-v1',
      ...immutable(envelope),
      index,
      length,
    })
  );
}

function wrappingId(key: Uint8Array): string {
  if (key.length !== 32) throw new Error('Invalid speaking reference wrapping key');
  return createHash('sha256')
    .update('sotto-speaking-reference-key-id-v1')
    .update(key)
    .digest('hex');
}

function legacyWrappingKey(): Buffer {
  const root = deriveOwnedCredentialKey();
  try {
    return Buffer.from(
      hkdfSync('sha256', root, Buffer.alloc(0), 'sotto-speaking-reference-wrap-v1', 32)
    );
  } finally {
    root.fill(0);
  }
}

const keyringSchema = z
  .object({
    version: z.literal(1),
    active: z.union([z.literal('legacy'), digest]),
    keys: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(16),
  })
  .strict();

function configuredKeyring() {
  const value = process.env.SOTTO_SPEAKING_REFERENCE_KEYRING;
  if (!value) return { active: 'legacy', keys: [] as Buffer[] };
  let parsed: z.infer<typeof keyringSchema>;
  try {
    const result = keyringSchema.safeParse(JSON.parse(value));
    if (!result.success) throw new Error();
    parsed = result.data;
  } catch {
    throw new Error('Invalid speaking reference keyring configuration');
  }
  const keys = parsed.keys.map((key) => Buffer.from(key, 'hex'));
  const ids = keys.map(wrappingId);
  if (
    new Set(ids).size !== ids.length ||
    (parsed.active !== 'legacy' && !ids.includes(parsed.active))
  ) {
    for (const key of keys) key.fill(0);
    throw new Error('Invalid speaking reference keyring configuration');
  }
  return { active: parsed.active, keys };
}

/** Select the configured write key, retaining the instance key for old references. */
export function speakingReferenceWrappingKey(): Buffer {
  const ring = configuredKeyring();
  try {
    if (ring.active === 'legacy') return legacyWrappingKey();
    const selected = ring.keys.find((key) => wrappingId(key) === ring.active);
    if (!selected) throw new Error('Speaking reference key is unavailable');
    return Buffer.from(selected);
  } finally {
    for (const key of ring.keys) key.fill(0);
  }
}

/** Select only the key named by the authenticated envelope. */
export function speakingReferenceKeyForEnvelope(envelopeInput: unknown): Buffer {
  const envelope = validated(envelopeInput);
  const ring = configuredKeyring();
  let legacy: Buffer | undefined;
  try {
    const selected = ring.keys.find((key) => wrappingId(key) === envelope.keyId);
    if (selected) return Buffer.from(selected);
    legacy = legacyWrappingKey();
    if (wrappingId(legacy) === envelope.keyId) return Buffer.from(legacy);
    throw new Error('Speaking reference key is unavailable');
  } finally {
    legacy?.fill(0);
    for (const key of ring.keys) key.fill(0);
  }
}

function wrapKey(envelope: SpeakingReferenceEnvelope, dataKey: Buffer, wrappingKey: Uint8Array) {
  const cipher = createCipheriv('aes-256-gcm', wrappingKey, decode(envelope.wrapNonce, 12));
  cipher.setAAD(wrapAad(envelope));
  const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return {
    wrappedKey: encrypted.toString('base64'),
    wrapTag: cipher.getAuthTag().toString('base64'),
  };
}

function unwrapKey(envelope: SpeakingReferenceEnvelope, wrappingKey: Uint8Array): Buffer {
  if (wrappingId(wrappingKey) !== envelope.keyId)
    throw new Error('Speaking reference key is unavailable');
  let partial: Buffer | undefined;
  try {
    const cipher = createDecipheriv('aes-256-gcm', wrappingKey, decode(envelope.wrapNonce, 12));
    cipher.setAAD(wrapAad(envelope));
    cipher.setAuthTag(decode(envelope.wrapTag, TAG_BYTES));
    partial = cipher.update(decode(envelope.wrappedKey, 32));
    return Buffer.concat([partial, cipher.final()]);
  } catch {
    throw new Error('Speaking reference authentication failed');
  } finally {
    partial?.fill(0);
  }
}

function chunkLength(envelope: SpeakingReferenceEnvelope, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= envelope.chunkCount)
    throw new Error('Invalid speaking reference chunk');
  return Math.min(envelope.chunkBytes, envelope.byteLength - index * envelope.chunkBytes);
}

export function speakingReferenceObjectBytes(envelopeInput: unknown): number {
  const envelope = validated(envelopeInput);
  return envelope.byteLength + envelope.chunkCount * TAG_BYTES;
}

/** Authenticate the envelope and its current owner before exposing a response. */
export function verifySpeakingReferenceEnvelope(
  envelopeInput: unknown,
  bindingInput: SpeakingReferenceBinding,
  wrappingKey: Uint8Array
): void {
  const envelope = validated(envelopeInput);
  const binding = speakingReferenceBindingSchema.parse(bindingInput);
  if (JSON.stringify(envelope.binding) !== JSON.stringify(binding))
    throw new Error('Speaking reference identity changed');
  const dataKey = unwrapKey(envelope, wrappingKey);
  dataKey.fill(0);
}

/** Encrypt one immutable artifact once; retain its ciphertext and envelope for retries. */
export function encryptSpeakingReference(
  plaintext: Uint8Array,
  bindingInput: SpeakingReferenceBinding,
  wrappingKey: Uint8Array
): { ciphertext: Buffer; envelope: SpeakingReferenceEnvelope } {
  if (!plaintext.length || plaintext.length > SPEAKING_REFERENCE_MAX_BYTES)
    throw new Error('Speaking reference audio size is unsupported');
  const binding = speakingReferenceBindingSchema.parse(bindingInput);
  const dataKey = randomBytes(32);
  let source: Buffer | undefined;
  try {
    source = Buffer.from(plaintext);
    const envelope: SpeakingReferenceEnvelope = {
      version: 1,
      binding,
      byteLength: plaintext.length,
      chunkBytes: SPEAKING_REFERENCE_CHUNK_BYTES,
      chunkCount: Math.ceil(plaintext.length / SPEAKING_REFERENCE_CHUNK_BYTES),
      noncePrefix: randomBytes(8).toString('base64'),
      keyId: wrappingId(wrappingKey),
      wrapNonce: randomBytes(12).toString('base64'),
      wrappedKey: Buffer.alloc(32).toString('base64'),
      wrapTag: Buffer.alloc(TAG_BYTES).toString('base64'),
    };
    Object.assign(envelope, wrapKey(envelope, dataKey, wrappingKey));
    const parts: Buffer[] = [];
    for (let index = 0; index < envelope.chunkCount; index++) {
      const length = chunkLength(envelope, index);
      const nonce = Buffer.alloc(12);
      decode(envelope.noncePrefix, 8).copy(nonce);
      nonce.writeUInt32BE(index, 8);
      const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
      cipher.setAAD(chunkAad(envelope, index, length));
      parts.push(
        cipher.update(
          source.subarray(index * envelope.chunkBytes, index * envelope.chunkBytes + length)
        ),
        cipher.final(),
        cipher.getAuthTag()
      );
    }
    return { ciphertext: Buffer.concat(parts), envelope };
  } finally {
    source?.fill(0);
    dataKey.fill(0);
  }
}

/** Authenticate a complete chunk before returning any plaintext from it. */
export function decryptSpeakingReferenceChunk(
  ciphertext: Uint8Array,
  envelopeInput: unknown,
  bindingInput: SpeakingReferenceBinding,
  wrappingKey: Uint8Array,
  index: number
): Buffer {
  const envelope = validated(envelopeInput);
  const binding = speakingReferenceBindingSchema.parse(bindingInput);
  if (JSON.stringify(envelope.binding) !== JSON.stringify(binding))
    throw new Error('Speaking reference identity changed');
  const length = chunkLength(envelope, index);
  if (ciphertext.length !== length + TAG_BYTES) throw new Error('Invalid speaking reference chunk');
  const dataKey = unwrapKey(envelope, wrappingKey);
  let partial: Buffer | undefined;
  try {
    const nonce = Buffer.alloc(12);
    decode(envelope.noncePrefix, 8).copy(nonce);
    nonce.writeUInt32BE(index, 8);
    const cipher = createDecipheriv('aes-256-gcm', dataKey, nonce);
    cipher.setAAD(chunkAad(envelope, index, length));
    cipher.setAuthTag(ciphertext.subarray(length));
    partial = cipher.update(ciphertext.subarray(0, length));
    return Buffer.concat([partial, cipher.final()]);
  } catch {
    throw new Error('Speaking reference authentication failed');
  } finally {
    partial?.fill(0);
    dataKey.fill(0);
  }
}

/** Rotate a wrapping key without changing authenticated audio bytes. */
export function rewrapSpeakingReference(
  envelopeInput: unknown,
  previous: Uint8Array,
  next: Uint8Array
) {
  const envelope = validated(envelopeInput);
  const dataKey = unwrapKey(envelope, previous);
  try {
    const rotated = {
      ...envelope,
      keyId: wrappingId(next),
      wrapNonce: randomBytes(12).toString('base64'),
    };
    return { ...rotated, ...wrapKey(rotated, dataKey, next) };
  } finally {
    dataKey.fill(0);
  }
}
