import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ---- Mocks ----

const mockPrismaApiKeyFindUnique = vi.fn();
const mockPrismaApiKeyUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: {
      findUnique: (...args: unknown[]) => mockPrismaApiKeyFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaApiKeyUpdate(...args),
    },
  },
}));

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

// ---- Import under test ----
import { generateApiKey, hashApiKey, validateApiKey, authenticateRequest } from '@/lib/api-keys';
import type { NextRequest } from 'next/server';

// ---- Tests ----

describe('api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateApiKey', () => {
    it('generates a key with sk_sotto_ prefix', () => {
      const { key, hash, prefix } = generateApiKey();

      expect(key).toMatch(/^sk_sotto_[a-f0-9]{64}$/);
      expect(hash).toHaveLength(64); // SHA-256 hex = 64 chars
      expect(prefix).toMatch(/^sk_sotto_[a-f0-9]{7}\.\.\.$/);
    });

    it('generates unique keys on each call', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();

      expect(key1.key).not.toBe(key2.key);
      expect(key1.hash).not.toBe(key2.hash);
    });

    it('generates a 64-character hex random suffix', () => {
      const { key } = generateApiKey();
      const suffix = key.replace('sk_sotto_', '');

      expect(suffix).toHaveLength(64);
      expect(suffix).toMatch(/^[a-f0-9]{64}$/);
    });

    it('generates consistent hash for same key', () => {
      const { key } = generateApiKey();
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);

      expect(hash1).toBe(hash2);
    });

    it('prefix contains first 16 characters of key plus ellipsis', () => {
      const { key, prefix } = generateApiKey();
      const expectedPrefix = key.substring(0, 16) + '...';

      expect(prefix).toBe(expectedPrefix);
    });

    it('hash is different from the raw key', () => {
      const { key, hash } = generateApiKey();

      expect(hash).not.toBe(key);
      expect(hash).not.toContain('sk_sotto_');
    });
  });

  describe('hashApiKey', () => {
    it('hashes using SHA-256', () => {
      const testKey = 'sk_sotto_test123';
      const expectedHash = crypto.createHash('sha256').update(testKey).digest('hex');

      const hash = hashApiKey(testKey);

      expect(hash).toBe(expectedHash);
    });

    it('produces different hashes for different keys', () => {
      const hash1 = hashApiKey('sk_sotto_key1');
      const hash2 = hashApiKey('sk_sotto_key2');

      expect(hash1).not.toBe(hash2);
    });

    it('produces a 64-character hex string', () => {
      const hash = hashApiKey('sk_sotto_anything');

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('handles empty string input', () => {
      const hash = hashApiKey('');

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for same input', () => {
      const key = 'sk_sotto_deterministic_test';
      const results = Array.from({ length: 10 }, () => hashApiKey(key));

      expect(new Set(results).size).toBe(1);
    });
  });

  describe('validateApiKey', () => {
    it('validates a correct non-revoked key', async () => {
      const testKey = 'sk_sotto_validkey123';

      mockPrismaApiKeyFindUnique.mockResolvedValue({
        id: 'key-id-1',
        userId: 'user-123',
        revokedAt: null,
      });

      mockPrismaApiKeyUpdate.mockResolvedValue({});

      const result = await validateApiKey(testKey);

      expect(result).toEqual({ userId: 'user-123' });
    });

    it('returns null for non-existent key', async () => {
      mockPrismaApiKeyFindUnique.mockResolvedValue(null);

      const result = await validateApiKey('sk_sotto_nonexistent');

      expect(result).toBeNull();
    });

    it('returns null for revoked key', async () => {
      const testKey = 'sk_sotto_revokedkey';

      mockPrismaApiKeyFindUnique.mockResolvedValue({
        id: 'key-id-2',
        userId: 'user-456',
        revokedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await validateApiKey(testKey);

      expect(result).toBeNull();
    });

    it('does not throw if update fails (fire and forget)', async () => {
      const testKey = 'sk_sotto_updatefail';

      mockPrismaApiKeyFindUnique.mockResolvedValue({
        id: 'key-id-4',
        userId: 'user-999',
        revokedAt: null,
      });

      mockPrismaApiKeyUpdate.mockRejectedValue(new Error('Update failed'));

      const result = await validateApiKey(testKey);

      expect(result).toEqual({ userId: 'user-999' });
    });

    it('handles keys with different formats', async () => {
      const testKey = 'not_a_valid_format';

      mockPrismaApiKeyFindUnique.mockResolvedValue(null);

      const result = await validateApiKey(testKey);

      expect(result).toBeNull();
    });
  });

  describe('authenticateRequest', () => {
    it('authenticates via Bearer token with valid API key', async () => {
      const testKey = 'sk_sotto_bearer123';
      const mockRequest = {
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'authorization') return `Bearer ${testKey}`;
            return null;
          }),
        },
      } as unknown as NextRequest;

      mockPrismaApiKeyFindUnique.mockResolvedValue({
        id: 'key-id-6',
        userId: 'user-bearer',
        revokedAt: null,
      });

      const result = await authenticateRequest(mockRequest);

      expect(result).toEqual({ userId: 'user-bearer' });
    });

    it('ignores Bearer token if not sk_sotto_ prefix', async () => {
      const mockRequest = {
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'authorization') return 'Bearer other_token_format';
            return null;
          }),
        },
      } as unknown as NextRequest;

      mockAuth.mockResolvedValue({
        user: { id: 'user-session' },
      });

      const result = await authenticateRequest(mockRequest);

      expect(result).toEqual({ userId: 'user-session' });
      expect(mockPrismaApiKeyFindUnique).not.toHaveBeenCalled();
    });

    it('falls back to session auth when no Bearer token', async () => {
      const mockRequest = {
        headers: {
          get: vi.fn(() => null),
        },
      } as unknown as NextRequest;

      mockAuth.mockResolvedValue({
        user: { id: 'user-session-2' },
      });

      const result = await authenticateRequest(mockRequest);

      expect(result).toEqual({ userId: 'user-session-2' });
    });

    it('returns null when neither Bearer nor session auth succeed', async () => {
      const mockRequest = {
        headers: {
          get: vi.fn(() => null),
        },
      } as unknown as NextRequest;

      mockAuth.mockResolvedValue(null);

      const result = await authenticateRequest(mockRequest);

      expect(result).toBeNull();
    });

    it('prioritizes Bearer token over session', async () => {
      const testKey = 'sk_sotto_priority';
      const mockRequest = {
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'authorization') return `Bearer ${testKey}`;
            return null;
          }),
        },
      } as unknown as NextRequest;

      mockPrismaApiKeyFindUnique.mockResolvedValue({
        id: 'key-id-7',
        userId: 'user-bearer-priority',
        revokedAt: null,
      });

      mockAuth.mockResolvedValue({
        user: { id: 'user-session-ignored' },
      });

      const result = await authenticateRequest(mockRequest);

      expect(result).toEqual({ userId: 'user-bearer-priority' });
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('returns null when Bearer token is invalid and no session', async () => {
      const testKey = 'sk_sotto_invalid';
      const mockRequest = {
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'authorization') return `Bearer ${testKey}`;
            return null;
          }),
        },
      } as unknown as NextRequest;

      mockPrismaApiKeyFindUnique.mockResolvedValue(null);

      mockAuth.mockResolvedValue(null);

      const result = await authenticateRequest(mockRequest);

      expect(result).toBeNull();
    });

    it('handles malformed authorization header', async () => {
      const mockRequest = {
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'authorization') return 'InvalidFormat';
            return null;
          }),
        },
      } as unknown as NextRequest;

      mockAuth.mockResolvedValue({
        user: { id: 'user-malformed' },
      });

      const result = await authenticateRequest(mockRequest);

      expect(result).toEqual({ userId: 'user-malformed' });
    });
  });
});
