import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks ----

const mockTtsKeyUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockAiKeyUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    userTtsKey: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: (...args: unknown[]) => mockTtsKeyUpdateMany(...args),
    },
    userAiKey: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: (...args: unknown[]) => mockAiKeyUpdateMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  validateProviderCredentials: vi.fn(),
  getProviderMeta: vi.fn(() => ({ displayName: 'Test Provider' })),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  validateAiProviderCredentials: vi.fn(),
  getAiProviderMeta: vi.fn(() => ({ displayName: 'Test AI Provider' })),
}));

// ---- Import under test ----
import { encryptApiKey, decryptApiKey, markTtsKeyInvalid, markAiKeyInvalid } from '@/lib/byok';

// ---- Tests ----

describe('byok encryption/decryption', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, BYOK_ENCRYPTION_KEY: 'test-secret-key-for-unit-tests-32!' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ---------------------------------------------------------------------------
  // Round-trip integrity
  // ---------------------------------------------------------------------------

  describe('round-trip integrity', () => {
    it('decrypts to the exact original plaintext', () => {
      const key = 'sk-ant-api03-abc123def456';
      const encrypted = encryptApiKey(key);
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe(key);
    });

    it('preserves Anthropic key format (sk-ant-...)', () => {
      const key = 'sk-ant-api03-xYz789AbCdEf0123456789-abcdef0123456789ABCDEF0123456789abcdef0123456789ABCDEF01234-AbCdEfGhIjKlMnOpQrStUvWxYz';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('preserves OpenAI key format (sk-...)', () => {
      const key = 'sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('preserves ElevenLabs key format', () => {
      const key = 'el_abc123def456ghi789jkl012mno345';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('preserves very long keys (500 chars)', () => {
      const key = 'sk-' + 'a'.repeat(497);
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
      expect(decrypted).toHaveLength(500);
    });

    it('preserves short keys (10 chars)', () => {
      const key = 'sk-1234567';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('preserves single character', () => {
      const key = 'x';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });
  });

  // ---------------------------------------------------------------------------
  // Whitespace preservation (the likely bug)
  // ---------------------------------------------------------------------------

  describe('whitespace handling', () => {
    it('preserves trailing newline if present', () => {
      const key = 'sk-ant-api03-abc123\n';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
      expect(decrypted.endsWith('\n')).toBe(true);
    });

    it('preserves leading space if present', () => {
      const key = ' sk-ant-api03-abc123';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
      expect(decrypted.startsWith(' ')).toBe(true);
    });

    it('preserves trailing space if present', () => {
      const key = 'sk-ant-api03-abc123 ';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
      expect(decrypted.endsWith(' ')).toBe(true);
    });

    it('preserves trailing carriage return + newline', () => {
      const key = 'sk-ant-api03-abc123\r\n';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('preserves trailing tab', () => {
      const key = 'sk-ant-api03-abc123\t';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('preserves internal whitespace', () => {
      const key = 'sk-ant  api03  abc123';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });
  });

  // ---------------------------------------------------------------------------
  // Special characters
  // ---------------------------------------------------------------------------

  describe('special characters', () => {
    it('handles keys with hyphens and underscores', () => {
      const key = 'sk-ant_api03-my_key-123_456';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('handles keys with dots', () => {
      const key = 'sk.ant.api03.abc123';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('handles keys with plus and equals (base64-like)', () => {
      const key = 'sk+ant/api03==abc123+/==';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('handles keys with unicode characters', () => {
      const key = 'sk-ant-api03-abc123-émojis-café';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('handles keys with emoji', () => {
      const key = 'sk-ant-🔑-abc123';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('handles keys with null bytes', () => {
      const key = 'sk-ant\x00api03';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('handles keys with backslashes', () => {
      const key = 'sk-ant\\api03\\abc123';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });

    it('handles keys with quotes', () => {
      const key = 'sk-ant"api03\'abc123';
      const decrypted = decryptApiKey(encryptApiKey(key));

      expect(decrypted).toBe(key);
    });
  });

  // ---------------------------------------------------------------------------
  // Uniqueness — each encryption must produce different ciphertext
  // ---------------------------------------------------------------------------

  describe('ciphertext uniqueness', () => {
    it('produces different ciphertext for the same plaintext (random salt + IV)', () => {
      const key = 'sk-ant-api03-abc123';
      const encrypted1 = encryptApiKey(key);
      const encrypted2 = encryptApiKey(key);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('both unique ciphertexts decrypt to the same plaintext', () => {
      const key = 'sk-ant-api03-abc123';
      const encrypted1 = encryptApiKey(key);
      const encrypted2 = encryptApiKey(key);

      expect(decryptApiKey(encrypted1)).toBe(key);
      expect(decryptApiKey(encrypted2)).toBe(key);
    });

    it('20 encryptions of the same key all produce unique ciphertexts', () => {
      const key = 'sk-ant-api03-determinism-test';
      const ciphertexts = Array.from({ length: 20 }, () => encryptApiKey(key));

      expect(new Set(ciphertexts).size).toBe(20);
    }, 20_000);

    it('20 encryptions all decrypt back to the same key', () => {
      const key = 'sk-ant-api03-determinism-test';
      const ciphertexts = Array.from({ length: 20 }, () => encryptApiKey(key));
      const decrypted = ciphertexts.map(decryptApiKey);

      expect(new Set(decrypted).size).toBe(1);
      expect(decrypted[0]).toBe(key);
    }, 20_000);
  });

  // ---------------------------------------------------------------------------
  // Ciphertext format
  // ---------------------------------------------------------------------------

  describe('ciphertext format', () => {
    it('produces valid base64 output', () => {
      const encrypted = encryptApiKey('sk-ant-api03-abc123');

      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
      // Re-encoding should match (no non-base64 characters)
      const decoded = Buffer.from(encrypted, 'base64');
      expect(decoded.toString('base64')).toBe(encrypted);
    });

    it('ciphertext is longer than plaintext (salt + IV + authTag overhead)', () => {
      const key = 'sk-ant-api03-abc123';
      const encrypted = encryptApiKey(key);
      const ciphertextBytes = Buffer.from(encrypted, 'base64');

      // salt(16) + iv(16) + authTag(16) + ciphertext(>=plaintext length)
      expect(ciphertextBytes.length).toBeGreaterThanOrEqual(48 + key.length);
    });

    it('ciphertext contains salt + IV + authTag + encrypted data (48+ byte header)', () => {
      const encrypted = encryptApiKey('x');
      const combined = Buffer.from(encrypted, 'base64');

      // Minimum: 16 (salt) + 16 (iv) + 16 (authTag) + 1 (single char ciphertext)
      expect(combined.length).toBeGreaterThanOrEqual(49);
    });
  });

  // ---------------------------------------------------------------------------
  // Tamper detection — GCM auth tag must reject modifications
  // ---------------------------------------------------------------------------

  describe('tamper detection', () => {
    it('rejects ciphertext with flipped bit in encrypted data', () => {
      const encrypted = encryptApiKey('sk-ant-api03-abc123');
      const buf = Buffer.from(encrypted, 'base64');

      // Flip a bit in the ciphertext region (after salt + iv + authTag = 48 bytes)
      buf[48] ^= 0x01;
      const tampered = buf.toString('base64');

      expect(() => decryptApiKey(tampered)).toThrow();
    });

    it('rejects ciphertext with modified salt', () => {
      const encrypted = encryptApiKey('sk-ant-api03-abc123');
      const buf = Buffer.from(encrypted, 'base64');

      // Modify salt (first 16 bytes)
      buf[0] ^= 0xff;
      const tampered = buf.toString('base64');

      expect(() => decryptApiKey(tampered)).toThrow();
    });

    it('rejects ciphertext with modified IV', () => {
      const encrypted = encryptApiKey('sk-ant-api03-abc123');
      const buf = Buffer.from(encrypted, 'base64');

      // Modify IV (bytes 16-31)
      buf[16] ^= 0xff;
      const tampered = buf.toString('base64');

      expect(() => decryptApiKey(tampered)).toThrow();
    });

    it('rejects ciphertext with modified auth tag', () => {
      const encrypted = encryptApiKey('sk-ant-api03-abc123');
      const buf = Buffer.from(encrypted, 'base64');

      // Modify auth tag (bytes 32-47)
      buf[32] ^= 0xff;
      const tampered = buf.toString('base64');

      expect(() => decryptApiKey(tampered)).toThrow();
    });

    it('rejects truncated ciphertext', () => {
      const encrypted = encryptApiKey('sk-ant-api03-abc123');
      const buf = Buffer.from(encrypted, 'base64');

      // Truncate to just the header (remove encrypted data)
      const truncated = buf.subarray(0, 48).toString('base64');

      expect(() => decryptApiKey(truncated)).toThrow();
    });

    it('rejects ciphertext with appended data', () => {
      const encrypted = encryptApiKey('sk-ant-api03-abc123');
      const buf = Buffer.from(encrypted, 'base64');

      // Append extra bytes
      const extended = Buffer.concat([buf, Buffer.from('extra')]);
      const tampered = extended.toString('base64');

      expect(() => decryptApiKey(tampered)).toThrow();
    });

    it('rejects swapped ciphertext between two different encryptions', () => {
      const encrypted1 = encryptApiKey('key-one');
      const encrypted2 = encryptApiKey('key-two');

      const buf1 = Buffer.from(encrypted1, 'base64');
      const buf2 = Buffer.from(encrypted2, 'base64');

      // Take header from encryption1, ciphertext from encryption2
      const frankenstein = Buffer.concat([
        buf1.subarray(0, 48),
        buf2.subarray(48),
      ]);
      const tampered = frankenstein.toString('base64');

      expect(() => decryptApiKey(tampered)).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Wrong encryption key
  // ---------------------------------------------------------------------------

  describe('wrong encryption key', () => {
    it('fails to decrypt with a different BYOK_ENCRYPTION_KEY', () => {
      const key = 'sk-ant-api03-abc123';
      const encrypted = encryptApiKey(key);

      // Change the encryption key
      process.env.BYOK_ENCRYPTION_KEY = 'different-secret-key-for-testing!!';

      expect(() => decryptApiKey(encrypted)).toThrow();
    });

    it('fails to decrypt when BYOK_ENCRYPTION_KEY is unset', () => {
      const key = 'sk-ant-api03-abc123';
      const encrypted = encryptApiKey(key);

      delete process.env.BYOK_ENCRYPTION_KEY;

      expect(() => decryptApiKey(encrypted)).toThrow('BYOK_ENCRYPTION_KEY');
    });

    it('fails to encrypt when BYOK_ENCRYPTION_KEY is unset', () => {
      delete process.env.BYOK_ENCRYPTION_KEY;

      expect(() => encryptApiKey('sk-ant-api03-abc123')).toThrow('BYOK_ENCRYPTION_KEY');
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid input
  // ---------------------------------------------------------------------------

  describe('invalid input', () => {
    it('rejects empty string as ciphertext', () => {
      expect(() => decryptApiKey('')).toThrow();
    });

    it('rejects non-base64 ciphertext', () => {
      expect(() => decryptApiKey('not-valid-base64!!!')).toThrow();
    });

    it('rejects too-short ciphertext (less than header size)', () => {
      const tooShort = Buffer.alloc(30).toString('base64');

      expect(() => decryptApiKey(tooShort)).toThrow();
    });

    it('rejects ciphertext that is exactly the header size (no data)', () => {
      // 48 bytes = salt(16) + iv(16) + authTag(16), but no ciphertext
      const headerOnly = Buffer.alloc(48).toString('base64');

      expect(() => decryptApiKey(headerOnly)).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-key isolation
  // ---------------------------------------------------------------------------

  describe('cross-key isolation', () => {
    it('different plaintexts produce different decrypted values', () => {
      const key1 = 'sk-ant-first-key';
      const key2 = 'sk-ant-second-key';

      const encrypted1 = encryptApiKey(key1);
      const encrypted2 = encryptApiKey(key2);

      expect(decryptApiKey(encrypted1)).toBe(key1);
      expect(decryptApiKey(encrypted2)).toBe(key2);
      expect(decryptApiKey(encrypted1)).not.toBe(decryptApiKey(encrypted2));
    });

    it('encrypting the same key twice produces ciphertexts that both work independently', () => {
      const key = 'sk-ant-shared-key';
      const enc1 = encryptApiKey(key);
      const enc2 = encryptApiKey(key);

      // Both decrypt to the same value
      expect(decryptApiKey(enc1)).toBe(key);
      expect(decryptApiKey(enc2)).toBe(key);

      // But they are different ciphertexts
      expect(enc1).not.toBe(enc2);
    });
  });

  // ---------------------------------------------------------------------------
  // Byte-level fidelity — the actual scenario that matters for BYOK
  // ---------------------------------------------------------------------------

  describe('byte-level fidelity for real API keys', () => {
    const realWorldKeys = [
      { name: 'Anthropic production key', key: 'sk-ant-api03-RealKeyWithMixedCase123-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789' },
      { name: 'OpenAI project key', key: 'sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567' },
      { name: 'key with trailing newline from clipboard', key: 'sk-ant-api03-abc123\n' },
      { name: 'key with trailing space from clipboard', key: 'sk-ant-api03-abc123 ' },
      { name: 'key pasted with CRLF', key: 'sk-ant-api03-abc123\r\n' },
      { name: 'key with leading space', key: ' sk-ant-api03-abc123' },
    ];

    for (const { name, key } of realWorldKeys) {
      it(`round-trips ${name} byte-for-byte`, () => {
        const encrypted = encryptApiKey(key);
        const decrypted = decryptApiKey(encrypted);

        // Byte-level comparison
        const originalBytes = Buffer.from(key, 'utf8');
        const decryptedBytes = Buffer.from(decrypted, 'utf8');

        expect(decryptedBytes.equals(originalBytes)).toBe(true);
        expect(decrypted.length).toBe(key.length);
      });
    }
  });
});

describe('markTtsKeyInvalid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets isValid to false for the matching TTS key', async () => {
    await markTtsKeyInvalid('user-1', 'elevenlabs' as Parameters<typeof markTtsKeyInvalid>[1]);

    expect(mockTtsKeyUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider: 'elevenlabs', isValid: true }),
        data: expect.objectContaining({ isValid: false }),
      })
    );
  });
});

describe('markAiKeyInvalid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets isValid to false for the matching AI key', async () => {
    await markAiKeyInvalid('user-1', 'anthropic' as Parameters<typeof markAiKeyInvalid>[1]);

    expect(mockAiKeyUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider: 'anthropic', isValid: true }),
        data: expect.objectContaining({ isValid: false }),
      })
    );
  });
});
