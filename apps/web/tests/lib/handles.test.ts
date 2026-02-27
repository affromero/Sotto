import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockReservedHandleFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    reservedHandle: {
      findUnique: (...args: unknown[]) => mockReservedHandleFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockGenerateResponse = vi.fn();
vi.mock('@/lib/llm', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
}));

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
vi.mock('@/lib/redis', () => ({
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----

import {
  isValidHandleFormat,
  isHardcodedReserved,
  checkHandleContent,
  isDbReserved,
  isHandleTaken,
  isHandleAvailable,
  generateHandleFromName,
  generateUniqueHandle,
} from '@/lib/handles';

// ---- Tests ----

describe('handles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: handle content check returns OK unless overridden
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    mockGenerateResponse.mockResolvedValue({ content: 'OK', inputTokens: 5, outputTokens: 1 });
  });

  describe('isValidHandleFormat', () => {
    it('accepts valid lowercase alphanumeric handles', () => {
      expect(isValidHandleFormat('alice')).toBe(true);
      expect(isValidHandleFormat('bob_smith')).toBe(true);
      expect(isValidHandleFormat('user123')).toBe(true);
      expect(isValidHandleFormat('a_b_c')).toBe(true);
    });

    it('accepts handles at minimum length (3)', () => {
      expect(isValidHandleFormat('abc')).toBe(true);
      expect(isValidHandleFormat('a_1')).toBe(true);
    });

    it('accepts handles at maximum length (30)', () => {
      expect(isValidHandleFormat('a'.repeat(30))).toBe(true);
    });

    it('rejects handles shorter than 3 characters', () => {
      expect(isValidHandleFormat('ab')).toBe(false);
      expect(isValidHandleFormat('a')).toBe(false);
      expect(isValidHandleFormat('')).toBe(false);
    });

    it('rejects handles longer than 30 characters', () => {
      expect(isValidHandleFormat('a'.repeat(31))).toBe(false);
    });

    it('rejects handles with uppercase letters', () => {
      expect(isValidHandleFormat('Alice')).toBe(false);
      expect(isValidHandleFormat('BOB')).toBe(false);
    });

    it('rejects handles with spaces', () => {
      expect(isValidHandleFormat('bob smith')).toBe(false);
    });

    it('rejects handles with special characters', () => {
      expect(isValidHandleFormat('bob-smith')).toBe(false);
      expect(isValidHandleFormat('bob.smith')).toBe(false);
      expect(isValidHandleFormat('bob@smith')).toBe(false);
      expect(isValidHandleFormat('bob!smith')).toBe(false);
    });

    it('accepts handles with only underscores and digits', () => {
      expect(isValidHandleFormat('___')).toBe(true);
      expect(isValidHandleFormat('123')).toBe(true);
      expect(isValidHandleFormat('1_2_3')).toBe(true);
    });
  });

  describe('isHardcodedReserved', () => {
    it('returns true for brand/system handles', () => {
      expect(isHardcodedReserved('sotto')).toBe(true);
      expect(isHardcodedReserved('admin')).toBe(true);
      expect(isHardcodedReserved('support')).toBe(true);
      expect(isHardcodedReserved('system')).toBe(true);
    });

    it('returns true for route segment handles', () => {
      expect(isHardcodedReserved('api')).toBe(true);
      expect(isHardcodedReserved('feed')).toBe(true);
      expect(isHardcodedReserved('create')).toBe(true);
      expect(isHardcodedReserved('settings')).toBe(true);
      expect(isHardcodedReserved('dashboard')).toBe(true);
    });

    it('returns true for reserved words', () => {
      expect(isHardcodedReserved('null')).toBe(true);
      expect(isHardcodedReserved('undefined')).toBe(true);
      expect(isHardcodedReserved('anonymous')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isHardcodedReserved('SOTTO')).toBe(true);
      expect(isHardcodedReserved('Admin')).toBe(true);
      expect(isHardcodedReserved('FEED')).toBe(true);
    });

    it('returns false for non-reserved handles', () => {
      expect(isHardcodedReserved('alice')).toBe(false);
      expect(isHardcodedReserved('bob_smith')).toBe(false);
      expect(isHardcodedReserved('podcast_fan_42')).toBe(false);
    });
  });

  describe('checkHandleContent', () => {
    it('returns NAME when LLM classifies as a common name', async () => {
      mockGenerateResponse.mockResolvedValue({ content: 'NAME', inputTokens: 5, outputTokens: 1 });

      const result = await checkHandleContent('alice');

      expect(result).toBe('NAME');
      expect(mockCacheSet).toHaveBeenCalledWith('handle:check:alice', 'NAME', expect.any(Number));
    });

    it('returns OFFENSIVE when LLM classifies as profane', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'OFFENSIVE',
        inputTokens: 5,
        outputTokens: 1,
      });

      const result = await checkHandleContent('slurword');

      expect(result).toBe('OFFENSIVE');
      expect(mockCacheSet).toHaveBeenCalledWith(
        'handle:check:slurword',
        'OFFENSIVE',
        expect.any(Number)
      );
    });

    it('returns OK when LLM says OK', async () => {
      mockGenerateResponse.mockResolvedValue({ content: 'OK', inputTokens: 5, outputTokens: 1 });

      const result = await checkHandleContent('zephyrbot');

      expect(result).toBe('OK');
      expect(mockCacheSet).toHaveBeenCalledWith('handle:check:zephyrbot', 'OK', expect.any(Number));
    });

    it('returns cached result without calling LLM', async () => {
      mockCacheGet.mockResolvedValue('NAME');

      const result = await checkHandleContent('maria');

      expect(result).toBe('NAME');
      expect(mockGenerateResponse).not.toHaveBeenCalled();
    });

    it('skips check for handles with underscores', async () => {
      const result = await checkHandleContent('alice_smith');

      expect(result).toBe('OK');
      expect(mockGenerateResponse).not.toHaveBeenCalled();
      expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('skips check for handles with digits', async () => {
      const result = await checkHandleContent('bob42');

      expect(result).toBe('OK');
      expect(mockGenerateResponse).not.toHaveBeenCalled();
    });

    it('fails open (returns OK) when LLM throws', async () => {
      mockGenerateResponse.mockRejectedValue(new Error('API unavailable'));

      const result = await checkHandleContent('james');

      expect(result).toBe('OK');
    });

  });

  describe('isDbReserved', () => {
    it('returns true when handle exists in ReservedHandle table', async () => {
      mockReservedHandleFindUnique.mockResolvedValue({
        id: 'rh-1',
        handle: 'reserved_one',
      });

      const result = await isDbReserved('reserved_one');

      expect(result).toBe(true);
      expect(mockReservedHandleFindUnique).toHaveBeenCalledWith({
        where: { handle: 'reserved_one' },
      });
    });

    it('returns false when handle is not in ReservedHandle table', async () => {
      mockReservedHandleFindUnique.mockResolvedValue(null);

      const result = await isDbReserved('available_handle');

      expect(result).toBe(false);
    });

    it('lowercases the handle before checking', async () => {
      mockReservedHandleFindUnique.mockResolvedValue(null);

      await isDbReserved('MixedCase');

      expect(mockReservedHandleFindUnique).toHaveBeenCalledWith({
        where: { handle: 'mixedcase' },
      });
    });
  });

  describe('isHandleTaken', () => {
    it('returns true when a user has the handle', async () => {
      mockUserFindUnique.mockResolvedValue({ id: 'user-1' });

      const result = await isHandleTaken('alice');

      expect(result).toBe(true);
      expect(mockUserFindUnique).toHaveBeenCalledWith({
        where: { handle: 'alice' },
        select: { id: true },
      });
    });

    it('returns false when no user has the handle', async () => {
      mockUserFindUnique.mockResolvedValue(null);

      const result = await isHandleTaken('unclaimed');

      expect(result).toBe(false);
    });

    it('lowercases the handle before checking', async () => {
      mockUserFindUnique.mockResolvedValue(null);

      await isHandleTaken('UPPER');

      expect(mockUserFindUnique).toHaveBeenCalledWith({
        where: { handle: 'upper' },
        select: { id: true },
      });
    });
  });

  describe('isHandleAvailable', () => {
    it('returns available for a valid, unreserved, untaken handle', async () => {
      mockReservedHandleFindUnique.mockResolvedValue(null);
      mockUserFindUnique.mockResolvedValue(null);

      const result = await isHandleAvailable('new_user_42');

      expect(result).toEqual({ available: true });
    });

    it('returns unavailable with reason for invalid format', async () => {
      const result = await isHandleAvailable('ab');

      expect(result).toEqual({
        available: false,
        reason: 'Handle must be 3-30 characters, lowercase letters, numbers, and underscores only',
      });
      expect(mockReservedHandleFindUnique).not.toHaveBeenCalled();
      expect(mockUserFindUnique).not.toHaveBeenCalled();
    });

    it('returns unavailable for hardcoded reserved handles', async () => {
      const result = await isHandleAvailable('admin');

      expect(result).toEqual({
        available: false,
        reason: 'This handle is reserved',
      });
      expect(mockReservedHandleFindUnique).not.toHaveBeenCalled();
    });

    it('returns "already taken" for premium name handles', async () => {
      mockGenerateResponse.mockResolvedValue({ content: 'NAME', inputTokens: 5, outputTokens: 1 });

      const result = await isHandleAvailable('sophia');

      expect(result).toEqual({
        available: false,
        reason: 'This handle is already taken',
      });
      expect(mockReservedHandleFindUnique).not.toHaveBeenCalled();
      expect(mockUserFindUnique).not.toHaveBeenCalled();
    });

    it('returns "not allowed" for offensive handles', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'OFFENSIVE',
        inputTokens: 5,
        outputTokens: 1,
      });

      const result = await isHandleAvailable('badword');

      expect(result).toEqual({
        available: false,
        reason: 'This handle is not allowed',
      });
      expect(mockReservedHandleFindUnique).not.toHaveBeenCalled();
      expect(mockUserFindUnique).not.toHaveBeenCalled();
    });

    it('returns unavailable for DB-reserved handles', async () => {
      mockReservedHandleFindUnique.mockResolvedValue({
        id: 'rh-1',
        handle: 'custom_reserved',
      });

      const result = await isHandleAvailable('custom_reserved');

      expect(result).toEqual({
        available: false,
        reason: 'This handle is reserved',
      });
      expect(mockUserFindUnique).not.toHaveBeenCalled();
    });

    it('returns unavailable when handle is already taken', async () => {
      mockReservedHandleFindUnique.mockResolvedValue(null);
      mockUserFindUnique.mockResolvedValue({ id: 'user-1' });

      const result = await isHandleAvailable('taken_user');

      expect(result).toEqual({
        available: false,
        reason: 'This handle is already taken',
      });
    });

    it('normalizes input to lowercase before all checks', async () => {
      mockReservedHandleFindUnique.mockResolvedValue(null);
      mockUserFindUnique.mockResolvedValue(null);

      // Mixed-case input is lowercased first, so 'ValidUser' -> 'validuser' passes format check
      const result = await isHandleAvailable('ValidUser');

      expect(result).toEqual({ available: true });
      expect(mockUserFindUnique).toHaveBeenCalledWith({
        where: { handle: 'validuser' },
        select: { id: true },
      });
    });
  });

  describe('generateHandleFromName', () => {
    it('lowercases the name', () => {
      expect(generateHandleFromName('Alice')).toBe('alice');
      expect(generateHandleFromName('BOB')).toBe('bob');
    });

    it('replaces spaces with underscores', () => {
      expect(generateHandleFromName('Alice Johnson')).toBe('alice_johnson');
    });

    it('collapses multiple spaces into one underscore', () => {
      expect(generateHandleFromName('Alice   Johnson')).toBe('alice_johnson');
    });

    it('strips non-alphanumeric/underscore characters', () => {
      expect(generateHandleFromName("Alice O'Brien")).toBe('alice_obrien');
      expect(generateHandleFromName('José García')).toBe('jos_garca');
    });

    it('trims whitespace', () => {
      expect(generateHandleFromName('  alice  ')).toBe('alice');
    });

    it('truncates to 30 characters', () => {
      const longName = 'a'.repeat(50);
      expect(generateHandleFromName(longName)).toHaveLength(30);
    });

    it('handles empty string', () => {
      expect(generateHandleFromName('')).toBe('');
    });

    it('handles name with only special characters', () => {
      expect(generateHandleFromName('!!!@@@###')).toBe('');
    });
  });

  describe('generateUniqueHandle', () => {
    it('uses the base handle when available', async () => {
      mockReservedHandleFindUnique.mockResolvedValue(null);
      mockUserFindUnique.mockResolvedValue(null);

      const result = await generateUniqueHandle('Alice Johnson');

      expect(result).toBe('alice_johnson');
    });

    it('appends a 4-digit suffix when base is taken', async () => {
      // First call (base check) — handle taken
      mockReservedHandleFindUnique.mockResolvedValue(null);
      mockUserFindUnique
        .mockResolvedValueOnce({ id: 'user-existing' }) // base "alice" is taken
        .mockResolvedValue(null); // suffixed version is available

      const result = await generateUniqueHandle('Alice');

      expect(result).toMatch(/^alice_\d{4}$/);
    });

    it('falls back to user_ prefix when name is too short', async () => {
      mockReservedHandleFindUnique.mockResolvedValue(null);
      mockUserFindUnique.mockResolvedValue(null);

      const result = await generateUniqueHandle('Al');

      // Base "al" is < 3 chars, so skips to prefix logic
      // prefix "al" is < 2 chars? No, it's 2, so prefix = "al"
      expect(result).toMatch(/^al_\d{4}$/);
    });

    it('uses user_ prefix when name produces empty handle', async () => {
      mockReservedHandleFindUnique.mockResolvedValue(null);
      mockUserFindUnique.mockResolvedValue(null);

      const result = await generateUniqueHandle('!');

      expect(result).toMatch(/^user_\d{4}$/);
    });

    it('handles null name', async () => {
      mockReservedHandleFindUnique.mockResolvedValue(null);
      mockUserFindUnique.mockResolvedValue(null);

      const result = await generateUniqueHandle(null);

      expect(result).toMatch(/^user_\d{4}$/);
    });

    it('falls back to random hex after 10 failed suffix attempts', async () => {
      // All availability checks return taken
      mockReservedHandleFindUnique.mockResolvedValue(null);
      mockUserFindUnique.mockResolvedValue({ id: 'user-existing' });

      const result = await generateUniqueHandle('Alice');

      // After base + 10 suffix attempts all fail, falls back to user_ + hex
      expect(result).toMatch(/^user_[a-f0-9]{12}$/);
    });
  });
});
