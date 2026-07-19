import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// ---- Mocks ----

const mockPrismaApiKeyFindUnique = vi.fn();
const mockPrismaApiKeyUpdate = vi.fn();
const mockPrismaUserFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    apiKey: {
      findUnique: (...args: unknown[]) => mockPrismaApiKeyFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaApiKeyUpdate(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

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

    it('uses a validated profile header with a valid API key', async () => {
      const testKey = 'sk_sotto_profile123';
      const mockRequest = {
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'authorization') return `Bearer ${testKey}`;
            if (name === 'x-sotto-profile-id') return 'member-1';
            return null;
          }),
        },
      } as unknown as NextRequest;

      mockPrismaApiKeyFindUnique.mockResolvedValue({
        id: 'key-id-profile',
        userId: 'local-user',
        revokedAt: null,
      });
      mockPrismaUserFindUnique.mockResolvedValue({ id: 'member-1' });

      const result = await authenticateRequest(mockRequest);

      expect(result).toEqual({ userId: 'member-1' });
      expect(mockPrismaUserFindUnique).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        select: { id: true },
      });
    });

    it('rejects a stale profile header with a valid API key', async () => {
      const testKey = 'sk_sotto_staleprofile';
      const mockRequest = {
        headers: {
          get: vi.fn((name: string) => {
            if (name === 'authorization') return `Bearer ${testKey}`;
            if (name === 'x-sotto-profile-id') return 'deleted-profile';
            return null;
          }),
        },
      } as unknown as NextRequest;

      mockPrismaApiKeyFindUnique.mockResolvedValue({
        id: 'key-id-stale-profile',
        userId: 'local-user',
        revokedAt: null,
      });
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const result = await authenticateRequest(mockRequest);

      expect(result).toBeNull();
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

  describe('authenticateRequest with the access gate configured', () => {
    beforeEach(() => {
      process.env.SOTTO_ACCESS_PASSWORD = 'family-secret';
      process.env.BYOK_ENCRYPTION_KEY = 'test-signing-key-material-0123456789abcdef';
    });

    afterEach(() => {
      delete process.env.SOTTO_ACCESS_PASSWORD;
    });

    function requestWith(cookieValue: string | null): NextRequest {
      return {
        headers: { get: vi.fn(() => null) },
        cookies: {
          get: vi.fn((name: string) =>
            name === 'sotto_gate' && cookieValue !== null ? { value: cookieValue } : undefined
          ),
        },
      } as unknown as NextRequest;
    }

    it('denies the session fallback without a gate cookie', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'owner' } });

      expect(await authenticateRequest(requestWith(null))).toBeNull();
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('denies the session fallback with a forged gate cookie', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'owner' } });

      expect(await authenticateRequest(requestWith('123.deadbeef'))).toBeNull();
    });

    it('allows the session fallback with a valid gate cookie', async () => {
      const { createGateToken } = await import('@/lib/access/gate');
      const token = await createGateToken();
      mockAuth.mockResolvedValue({ user: { id: 'owner' } });

      expect(await authenticateRequest(requestWith(token!))).toEqual({ userId: 'owner' });
    });

    it('leaves Bearer key auth untouched by the gate', async () => {
      const mockRequest = {
        headers: {
          get: vi.fn((name: string) =>
            name === 'authorization' ? 'Bearer sk_sotto_gatedbearer' : null
          ),
        },
        cookies: { get: vi.fn(() => undefined) },
      } as unknown as NextRequest;
      mockPrismaApiKeyFindUnique.mockResolvedValue({
        id: 'key-id-gated',
        userId: 'user-bearer',
        revokedAt: null,
      });

      expect(await authenticateRequest(mockRequest)).toEqual({ userId: 'user-bearer' });
    });
  });
});
