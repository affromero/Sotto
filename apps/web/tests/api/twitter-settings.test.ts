import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

const mockPrismaUserFindUniqueOrThrow = vi.fn();
const mockPrismaUserUpdate = vi.fn();
const mockPrismaAccountFindFirst = vi.fn();
const mockPrismaAccountDeleteMany = vi.fn();
const mockPrismaTransaction = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaUserFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaUserUpdate(...args),
    },
    account: {
      findFirst: (...args: unknown[]) => mockPrismaAccountFindFirst(...args),
      deleteMany: (...args: unknown[]) => mockPrismaAccountDeleteMany(...args),
    },
    $transaction: (operations: unknown) => mockPrismaTransaction(operations),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

// ---- Import under test ----
import { GET, PATCH, DELETE } from '@/app/api/users/me/twitter/route';

// ---- Helpers ----

function createMockRequest(body?: Record<string, unknown>): NextRequest {
  return {
    json: async () => body,
  } as NextRequest;
}

// ---- Tests ----

describe('Twitter Settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/users/me/twitter', () => {
    it('returns twitter settings for authenticated user', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-001' } });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterHandle: '@johndoe',
        twitterEnabled: true,
        preferredHostVoiceId: 'voice-host-1',
        preferredExpertVoiceId: 'voice-expert-1',
        preferredTtsProvider: 'elevenlabs',
        preferredTtsModel: null,
        preferredAiProvider: 'anthropic',
        preferredAiModel: null,
      });
      mockPrismaAccountFindFirst.mockResolvedValue({
        providerAccountId: 'twitter-account-123',
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        twitterHandle: '@johndoe',
        twitterEnabled: true,
        preferredHostVoiceId: 'voice-host-1',
        preferredExpertVoiceId: 'voice-expert-1',
        preferredTtsProvider: 'elevenlabs',
        preferredTtsModel: null,
        preferredAiProvider: 'anthropic',
        preferredAiModel: null,
        connected: true,
      });
    });

    it('returns 401 for unauthenticated user', async () => {
      mockAuth.mockResolvedValue(null);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Unauthorized' });
    });

    it('returns connected: false when no Twitter account linked', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-002' } });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterHandle: null,
        twitterEnabled: false,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
      });
      mockPrismaAccountFindFirst.mockResolvedValue(null);

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.connected).toBe(false);
    });

    it('returns null voice IDs when not set', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-003' } });
      mockPrismaUserFindUniqueOrThrow.mockResolvedValue({
        twitterHandle: '@testuser',
        twitterEnabled: true,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
        preferredTtsProvider: null,
        preferredTtsModel: null,
        preferredAiProvider: null,
        preferredAiModel: null,
      });
      mockPrismaAccountFindFirst.mockResolvedValue({
        providerAccountId: 'twitter-123',
      });

      const response = await GET();
      const data = await response.json();

      expect(data.preferredHostVoiceId).toBeNull();
      expect(data.preferredExpertVoiceId).toBeNull();
    });
  });

  describe('PATCH /api/users/me/twitter', () => {
    it('updates twitterEnabled', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-004' } });
      mockPrismaUserUpdate.mockResolvedValue({
        twitterHandle: '@johndoe',
        twitterEnabled: false,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
      });

      const request = createMockRequest({ twitterEnabled: false });
      const response = await PATCH(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.twitterEnabled).toBe(false);
    });

    it('updates voice preferences', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-005' } });
      mockPrismaUserUpdate.mockResolvedValue({
        twitterHandle: '@janedoe',
        twitterEnabled: true,
        preferredHostVoiceId: 'new-host-voice',
        preferredExpertVoiceId: 'new-expert-voice',
      });

      const request = createMockRequest({
        preferredHostVoiceId: 'new-host-voice',
        preferredExpertVoiceId: 'new-expert-voice',
      });
      const response = await PATCH(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.preferredHostVoiceId).toBe('new-host-voice');
    });

    it('updates multiple fields at once', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-006' } });
      mockPrismaUserUpdate.mockResolvedValue({
        twitterHandle: '@testuser',
        twitterEnabled: true,
        preferredHostVoiceId: 'voice-a',
        preferredExpertVoiceId: 'voice-b',
      });

      const request = createMockRequest({
        twitterEnabled: true,
        preferredHostVoiceId: 'voice-a',
        preferredExpertVoiceId: 'voice-b',
      });
      const response = await PATCH(request);

      expect(response.status).toBe(200);
    });

    it('allows setting voice IDs to null', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-007' } });
      mockPrismaUserUpdate.mockResolvedValue({
        twitterHandle: '@user',
        twitterEnabled: true,
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
      });

      const request = createMockRequest({
        preferredHostVoiceId: null,
        preferredExpertVoiceId: null,
      });
      const response = await PATCH(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.preferredHostVoiceId).toBeNull();
      expect(data.preferredExpertVoiceId).toBeNull();
    });

    it('returns 400 for invalid body', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-008' } });

      const request = createMockRequest({
        twitterEnabled: 'not-a-boolean',
      });
      const response = await PATCH(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request');
    });

    it('returns 401 for unauthenticated user', async () => {
      mockAuth.mockResolvedValue(null);

      const request = createMockRequest({ twitterEnabled: true });
      const response = await PATCH(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Unauthorized' });
    });

    it('handles empty request body', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-009' } });
      mockPrismaUserUpdate.mockResolvedValue({
        twitterHandle: '@user',
        twitterEnabled: true,
        preferredHostVoiceId: 'voice-1',
        preferredExpertVoiceId: 'voice-2',
      });

      const request = createMockRequest({});
      const response = await PATCH(request);

      expect(response.status).toBe(200);
    });
  });

  describe('DELETE /api/users/me/twitter', () => {
    it('disconnects twitter account', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-010' } });
      mockPrismaTransaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map((op: Promise<unknown>) => Promise.resolve(op)));
        }
        return Promise.resolve([]);
      });

      const response = await DELETE();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ disconnected: true });
    });

    it('returns 401 for unauthenticated user', async () => {
      mockAuth.mockResolvedValue(null);

      const response = await DELETE();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Unauthorized' });
    });

  });
});
