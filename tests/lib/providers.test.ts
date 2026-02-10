import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the underlying service modules to prevent initialization errors
vi.mock('@/lib/claude', () => ({
  generateResponse: vi
    .fn()
    .mockResolvedValue({ content: 'test', inputTokens: 10, outputTokens: 20 }),
  streamResponse: vi.fn(),
}));

vi.mock('@/lib/elevenlabs', () => ({
  generateSpeech: vi.fn().mockResolvedValue(Buffer.from('audio')),
  generateSoundEffect: vi.fn().mockResolvedValue(Buffer.from('sfx')),
  getVoiceId: vi.fn().mockReturnValue('voice-id-123'),
}));

vi.mock('@/lib/r2', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://r2.example.com/file'),
  getPresignedUrl: vi.fn().mockResolvedValue('https://r2.example.com/presigned'),
  deleteFile: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  TIER_LIMITS: {
    FREE: {
      podcastsPerMonth: 3,
      maxDurationMinutes: 10,
      interactionsPerPodcast: 3,
      canDownload: false,
      canMakePrivate: false,
      voiceCount: 2,
    },
    PRO: {
      podcastsPerMonth: 20,
      maxDurationMinutes: 30,
      interactionsPerPodcast: Infinity,
      canDownload: true,
      canMakePrivate: true,
      voiceCount: 6,
    },
  },
  createCheckoutSession: vi.fn().mockResolvedValue('https://checkout.stripe.com/session'),
  createPortalSession: vi.fn().mockResolvedValue('https://billing.stripe.com/portal'),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createAIProvider } from '@/lib/providers/ai';
import { createTtsProvider } from '@/lib/providers/tts';
import { createStorageProvider } from '@/lib/providers/storage';
import { createPaymentProvider } from '@/lib/providers/payment';

describe('Provider Factories', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createAIProvider', () => {
    it('creates anthropic provider by default', () => {
      const provider = createAIProvider();
      expect(provider).toBeDefined();
      expect(provider.generateResponse).toBeDefined();
      expect(provider.streamResponse).toBeDefined();
    });

    it('creates anthropic provider when explicitly set', () => {
      const provider = createAIProvider('anthropic');
      expect(provider).toBeDefined();
    });

    it('creates openai provider', () => {
      const provider = createAIProvider('openai');
      expect(provider).toBeDefined();
    });

    it('falls back to anthropic for unknown type', () => {
      const provider = createAIProvider('unknown');
      expect(provider).toBeDefined();
    });

    it('reads from AI_PROVIDER env var', () => {
      process.env.AI_PROVIDER = 'anthropic';
      const provider = createAIProvider();
      expect(provider).toBeDefined();
    });

    it('anthropic provider delegates to claude.ts', async () => {
      const provider = createAIProvider('anthropic');
      const result = await provider.generateResponse('system', [
        { role: 'user', content: 'hello' },
      ]);
      expect(result).toEqual({ content: 'test', inputTokens: 10, outputTokens: 20 });
    });

    it('creates claude-code provider', () => {
      const provider = createAIProvider('claude-code');
      expect(provider).toBeDefined();
      expect(provider.generateResponse).toBeDefined();
      expect(provider.streamResponse).toBeDefined();
    });

    it('reads claude-code from AI_PROVIDER env var', () => {
      process.env.AI_PROVIDER = 'claude-code';
      const provider = createAIProvider();
      expect(provider).toBeDefined();
    });
  });

  describe('createTtsProvider', () => {
    it('creates elevenlabs provider by default', () => {
      const provider = createTtsProvider();
      expect(provider).toBeDefined();
      expect(provider.generateSpeech).toBeDefined();
      expect(provider.getVoiceId).toBeDefined();
    });

    it('creates openai provider', () => {
      const provider = createTtsProvider('openai');
      expect(provider).toBeDefined();
    });

    it('falls back to elevenlabs for unknown type', () => {
      const provider = createTtsProvider('unknown');
      expect(provider).toBeDefined();
    });

    it('elevenlabs provider delegates to elevenlabs.ts', async () => {
      const provider = createTtsProvider('elevenlabs');
      const result = await provider.generateSpeech({ text: 'hello', voiceId: 'test' });
      expect(result).toEqual(Buffer.from('audio'));
    });

    it('elevenlabs provider returns voice IDs', () => {
      const provider = createTtsProvider('elevenlabs');
      const hostVoice = provider.getVoiceId('HOST', 'podcast-1');
      const expertVoice = provider.getVoiceId('EXPERT', 'podcast-1');
      expect(hostVoice).toBeTruthy();
      expect(expertVoice).toBeTruthy();
      expect(hostVoice).not.toBe(expertVoice);
    });

    it('openai provider returns fixed voice IDs', () => {
      const provider = createTtsProvider('openai');
      expect(provider.getVoiceId('HOST')).toBe('nova');
      expect(provider.getVoiceId('EXPERT')).toBe('onyx');
    });
  });

  describe('createStorageProvider', () => {
    it('creates r2 provider by default', () => {
      const provider = createStorageProvider();
      expect(provider).toBeDefined();
      expect(provider.uploadFile).toBeDefined();
      expect(provider.getPresignedUrl).toBeDefined();
      expect(provider.deleteFile).toBeDefined();
    });

    it('creates s3 provider', () => {
      const provider = createStorageProvider('s3');
      expect(provider).toBeDefined();
    });

    it('creates local provider', () => {
      const provider = createStorageProvider('local');
      expect(provider).toBeDefined();
    });

    it('falls back to r2 for unknown type', () => {
      const provider = createStorageProvider('unknown');
      expect(provider).toBeDefined();
    });

    it('r2 provider delegates to r2.ts', async () => {
      const provider = createStorageProvider('r2');
      const url = await provider.uploadFile('key', Buffer.from('data'), 'text/plain');
      expect(url).toBe('https://r2.example.com/file');
    });
  });

  describe('createPaymentProvider', () => {
    it('creates stripe provider by default', () => {
      const provider = createPaymentProvider();
      expect(provider).toBeDefined();
      expect(provider.getTierLimits).toBeDefined();
      expect(provider.createCheckoutSession).toBeDefined();
      expect(provider.createPortalSession).toBeDefined();
    });

    it('creates none provider', () => {
      const provider = createPaymentProvider('none');
      expect(provider).toBeDefined();
    });

    it('falls back to stripe for unknown type', () => {
      const provider = createPaymentProvider('unknown');
      expect(provider).toBeDefined();
    });

    it('none provider returns unlimited limits', () => {
      const provider = createPaymentProvider('none');
      const limits = provider.getTierLimits('FREE');
      expect(limits.creditsMonthly).toBe(Infinity);
      expect(limits.canDownload).toBe(true);
    });

    it('none provider returns empty checkout URL', async () => {
      const provider = createPaymentProvider('none');
      const url = await provider.createCheckoutSession({
        userId: 'user-1',
        userEmail: 'test@test.com',
        priceId: 'price_123',
        successUrl: 'http://localhost/success',
        cancelUrl: 'http://localhost/cancel',
      });
      expect(url).toBe('');
    });

    it('none provider returns returnUrl for portal', async () => {
      const provider = createPaymentProvider('none');
      const url = await provider.createPortalSession('cus_123', 'http://localhost/billing');
      expect(url).toBe('http://localhost/billing');
    });

    it('stripe provider delegates getTierLimits', () => {
      const provider = createPaymentProvider('stripe');
      const limits = provider.getTierLimits('FREE');
      expect(limits.creditsMonthly).toBe(2);
    });
  });
});
