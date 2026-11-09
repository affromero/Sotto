// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  decryptSpeakingReferenceChunk,
  encryptSpeakingReference,
  rewrapSpeakingReference,
  speakingReferenceObjectBytes,
  speakingReferenceKeyForEnvelope,
  verifySpeakingReferenceEnvelope,
  speakingReferenceWrappingKey,
  SPEAKING_REFERENCE_CHUNK_BYTES,
  SPEAKING_REFERENCE_MAX_BYTES,
  type SpeakingReferenceBinding,
} from '@/lib/classes/speaking/speaking-reference-crypto';

const binding: SpeakingReferenceBinding = {
  instanceId: '00000000-0000-4000-8000-000000000001',
  userId: 'learner',
  userCreatedAt: 1700000000000,
  courseId: 'course',
  courseCreatedAt: 1700000001000,
  classId: 'class',
  classCreatedAt: 1700000002000,
  sectionId: 'section',
  sectionIncarnationId: '00000000-0000-4000-8000-000000000002',
  promptId: 'prompt',
  promptIncarnationId: '00000000-0000-4000-8000-000000000003',
  attempt: 2,
  operationId: '00000000-0000-4000-8000-000000000004',
  sourceHash: 'a'.repeat(64),
};
const split = (bytes: Buffer, index: number, length: number) => {
  const start = index * (SPEAKING_REFERENCE_CHUNK_BYTES + 16);
  return bytes.subarray(start, start + length + 16);
};

describe('encrypted speaking references', () => {
  it('authenticates ownership and the wrapped key before playback begins', () => {
    const key = randomBytes(32);
    const reference = encryptSpeakingReference(Buffer.from('speech'), binding, key);
    expect(() => verifySpeakingReferenceEnvelope(reference.envelope, binding, key)).not.toThrow();
    expect(() =>
      verifySpeakingReferenceEnvelope(reference.envelope, { ...binding, userId: 'other' }, key)
    ).toThrow('identity changed');
    const tag = Buffer.from(reference.envelope.wrapTag, 'base64');
    tag[0] = tag[0]! ^ 1;
    expect(() =>
      verifySpeakingReferenceEnvelope(
        { ...reference.envelope, wrapTag: tag.toString('base64') },
        binding,
        key
      )
    ).toThrow('authentication failed');
  });
  it('retains legacy audio while a separately configured speaking key becomes active', () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'stable-credential-key');
    vi.stubEnv('SOTTO_SPEAKING_REFERENCE_KEYRING', '');
    try {
      const legacyKey = speakingReferenceWrappingKey();
      const old = encryptSpeakingReference(Buffer.from('old audio'), binding, legacyKey);
      const nextKey = randomBytes(32);
      const next = encryptSpeakingReference(Buffer.from('new audio'), binding, nextKey);
      vi.stubEnv(
        'SOTTO_SPEAKING_REFERENCE_KEYRING',
        JSON.stringify({
          version: 1,
          active: next.envelope.keyId,
          keys: [nextKey.toString('hex')],
        })
      );
      expect(speakingReferenceWrappingKey()).toEqual(nextKey);
      expect(
        decryptSpeakingReferenceChunk(
          old.ciphertext,
          old.envelope,
          binding,
          speakingReferenceKeyForEnvelope(old.envelope),
          0
        ).toString()
      ).toBe('old audio');
      expect(
        decryptSpeakingReferenceChunk(
          next.ciphertext,
          next.envelope,
          binding,
          speakingReferenceKeyForEnvelope(next.envelope),
          0
        ).toString()
      ).toBe('new audio');
      vi.stubEnv(
        'SOTTO_SPEAKING_REFERENCE_KEYRING',
        JSON.stringify({ version: 1, active: 'legacy', keys: [] })
      );
      expect(() => speakingReferenceKeyForEnvelope(next.envelope)).toThrow('key is unavailable');
      expect(speakingReferenceWrappingKey()).toEqual(legacyKey);
      nextKey.fill(0);
      legacyKey.fill(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects malformed, duplicate, or missing active keyring entries', () => {
    const key = randomBytes(32).toString('hex');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'stable-credential-key');
    try {
      for (const value of [
        '{',
        JSON.stringify({ version: 1, active: 'legacy', keys: [key, key] }),
        JSON.stringify({ version: 1, active: 'a'.repeat(64), keys: [key] }),
        JSON.stringify({ version: 1, active: 'legacy', keys: ['bad'] }),
      ]) {
        vi.stubEnv('SOTTO_SPEAKING_REFERENCE_KEYRING', value);
        expect(() => speakingReferenceWrappingKey()).toThrow(
          'Invalid speaking reference keyring configuration'
        );
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('derives the same domain-separated key for an instance and changes it when the secret changes', () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'first-test-instance-secret');
    try {
      const first = speakingReferenceWrappingKey();
      expect(speakingReferenceWrappingKey()).toEqual(first);
      vi.stubEnv('BYOK_ENCRYPTION_KEY', 'second-test-instance-secret');
      expect(speakingReferenceWrappingKey()).not.toEqual(first);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('authenticates each chunk and supports final short chunks without exposing plaintext in storage', () => {
    const key = randomBytes(32);
    const plain = Buffer.concat([
      Buffer.alloc(SPEAKING_REFERENCE_CHUNK_BYTES, 42),
      Buffer.from('hello'),
    ]);
    const result = encryptSpeakingReference(plain, binding, key);
    expect(result.ciphertext.includes(Buffer.from('hello'))).toBe(false);
    expect(speakingReferenceObjectBytes(result.envelope)).toBe(result.ciphertext.length);
    const first = decryptSpeakingReferenceChunk(
      split(result.ciphertext, 0, SPEAKING_REFERENCE_CHUNK_BYTES),
      result.envelope,
      binding,
      key,
      0
    );
    const second = decryptSpeakingReferenceChunk(
      split(result.ciphertext, 1, 5),
      result.envelope,
      binding,
      key,
      1
    );
    expect(Buffer.concat([first, second])).toEqual(plain);
  });

  it('rejects altered, truncated, reordered, cross-owner and cross-incarnation chunks', () => {
    const key = randomBytes(32);
    const result = encryptSpeakingReference(
      Buffer.alloc(SPEAKING_REFERENCE_CHUNK_BYTES + 7, 7),
      binding,
      key
    );
    const first = split(result.ciphertext, 0, SPEAKING_REFERENCE_CHUNK_BYTES);
    const damaged = Buffer.from(first);
    damaged[1] = damaged[1]! ^ 1;
    expect(() => decryptSpeakingReferenceChunk(damaged, result.envelope, binding, key, 0)).toThrow(
      'authentication failed'
    );
    expect(() =>
      decryptSpeakingReferenceChunk(first.subarray(1), result.envelope, binding, key, 0)
    ).toThrow('Invalid speaking reference chunk');
    expect(() => decryptSpeakingReferenceChunk(first, result.envelope, binding, key, 1)).toThrow(
      'Invalid speaking reference chunk'
    );
    expect(() =>
      decryptSpeakingReferenceChunk(first, result.envelope, { ...binding, userId: 'other' }, key, 0)
    ).toThrow('identity changed');
    expect(() =>
      decryptSpeakingReferenceChunk(
        first,
        result.envelope,
        { ...binding, promptIncarnationId: '00000000-0000-4000-8000-000000000005' },
        key,
        0
      )
    ).toThrow('identity changed');
    expect(() =>
      decryptSpeakingReferenceChunk(
        first,
        { ...result.envelope, noncePrefix: Buffer.alloc(8).toString('base64') },
        binding,
        key,
        0
      )
    ).toThrow('authentication failed');
    const wrappedKey = Buffer.from(result.envelope.wrappedKey, 'base64');
    wrappedKey[0] = wrappedKey[0]! ^ 1;
    expect(() =>
      decryptSpeakingReferenceChunk(
        first,
        { ...result.envelope, wrappedKey: wrappedKey.toString('base64') },
        binding,
        key,
        0
      )
    ).toThrow('authentication failed');
    const equalChunks = encryptSpeakingReference(
      Buffer.alloc(SPEAKING_REFERENCE_CHUNK_BYTES * 2, 7),
      binding,
      key
    );
    expect(() =>
      decryptSpeakingReferenceChunk(
        split(equalChunks.ciphertext, 0, SPEAKING_REFERENCE_CHUNK_BYTES),
        equalChunks.envelope,
        binding,
        key,
        1
      )
    ).toThrow('authentication failed');
  });

  it('rewraps without changing ciphertext and rejects a lost or mismatched wrapping key', () => {
    const firstKey = randomBytes(32);
    const nextKey = randomBytes(32);
    const result = encryptSpeakingReference(Buffer.from('original speech'), binding, firstKey);
    const rotated = rewrapSpeakingReference(result.envelope, firstKey, nextKey);
    expect(() =>
      decryptSpeakingReferenceChunk(result.ciphertext, result.envelope, binding, nextKey, 0)
    ).toThrow('key is unavailable');
    expect(
      decryptSpeakingReferenceChunk(result.ciphertext, rotated, binding, nextKey, 0).toString()
    ).toBe('original speech');
    expect(() =>
      decryptSpeakingReferenceChunk(result.ciphertext, rotated, binding, firstKey, 0)
    ).toThrow('key is unavailable');
  });

  it('uses distinct artifact keys and rejects invalid sizes and malformed envelopes', () => {
    const key = randomBytes(32);
    const first = encryptSpeakingReference(Buffer.from('speech'), binding, key);
    const second = encryptSpeakingReference(Buffer.from('speech'), binding, key);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(first.envelope.wrappedKey).not.toBe(second.envelope.wrappedKey);
    expect(() => encryptSpeakingReference(Buffer.alloc(0), binding, key)).toThrow(
      'size is unsupported'
    );
    expect(() =>
      encryptSpeakingReference(Buffer.alloc(SPEAKING_REFERENCE_MAX_BYTES + 1), binding, key)
    ).toThrow('size is unsupported');
    expect(() => speakingReferenceObjectBytes({ ...first.envelope, chunkCount: 2 })).toThrow(
      'Invalid speaking reference envelope'
    );
    expect(() => speakingReferenceObjectBytes({ ...first.envelope, wrapNonce: 'invalid' })).toThrow(
      'Invalid speaking reference envelope'
    );
    expect(() =>
      decryptSpeakingReferenceChunk(first.ciphertext, first.envelope, binding, key, 1)
    ).toThrow('Invalid speaking reference chunk');
  });

  it('authenticates exact chunk boundaries and immutable owner generations', () => {
    const key = randomBytes(32);
    const plain = Buffer.alloc(SPEAKING_REFERENCE_CHUNK_BYTES, 17);
    const sealed = encryptSpeakingReference(plain, binding, key);
    expect(sealed.envelope.chunkCount).toBe(1);
    expect(sealed.ciphertext.length).toBe(plain.length + 16);
    expect(
      decryptSpeakingReferenceChunk(sealed.ciphertext, sealed.envelope, binding, key, 0)
    ).toEqual(plain);
    expect(() =>
      decryptSpeakingReferenceChunk(
        sealed.ciphertext,
        sealed.envelope,
        { ...binding, userCreatedAt: binding.userCreatedAt + 1 },
        key,
        0
      )
    ).toThrow('identity changed');
    expect(() =>
      decryptSpeakingReferenceChunk(
        sealed.ciphertext,
        sealed.envelope,
        { ...binding, courseCreatedAt: binding.courseCreatedAt + 1 },
        key,
        0
      )
    ).toThrow('identity changed');
    expect(() =>
      decryptSpeakingReferenceChunk(
        sealed.ciphertext,
        sealed.envelope,
        { ...binding, classCreatedAt: binding.classCreatedAt + 1 },
        key,
        0
      )
    ).toThrow('identity changed');
    expect(() =>
      decryptSpeakingReferenceChunk(
        sealed.ciphertext,
        { ...sealed.envelope, byteLength: sealed.envelope.byteLength - 1 },
        binding,
        key,
        0
      )
    ).toThrow();
    expect(() =>
      decryptSpeakingReferenceChunk(
        Buffer.concat([sealed.ciphertext, Buffer.of(0)]),
        sealed.envelope,
        binding,
        key,
        0
      )
    ).toThrow('Invalid speaking reference chunk');
  });

  it('fails without the configured instance secret rather than inventing a key', () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '');
    try {
      expect(() => speakingReferenceWrappingKey()).toThrow('BYOK_ENCRYPTION_KEY');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
