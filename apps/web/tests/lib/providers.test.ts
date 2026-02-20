import { describe, it, expect, vi } from 'vitest';

// Create mock TTS provider classes that will be injected via module.require
class MockElevenLabsProvider {
  providerId = 'elevenlabs';
  async generateSpeech() {
    return Buffer.from('audio');
  }
  async generateSoundEffect() {
    return Buffer.from('sfx');
  }
  getVoiceId(speaker: string, podcastId?: string) {
    if (!podcastId) {
      return speaker === 'HOST' ? 'host-default' : 'expert-default';
    }
    return speaker === 'HOST' ? 'host-elevenlabs-id' : 'expert-elevenlabs-id';
  }
}

class MockOpenAITtsProvider {
  providerId = 'openai';
  async generateSpeech() {
    return Buffer.from('audio');
  }
  getVoiceId(speaker: string) {
    return speaker === 'HOST' ? 'nova' : 'onyx';
  }
}

// Mock TTS provider dependencies
vi.mock('@/lib/voice-pool', () => ({
  VOICE_POOL: [],
  selectVoicePair: vi.fn().mockReturnValue({
    host: { ids: { elevenlabs: 'host-elevenlabs-id', openai: 'nova' } },
    expert: { ids: { elevenlabs: 'expert-elevenlabs-id', openai: 'onyx' } },
  }),
  resolveVoiceId: vi.fn((entry, provider) => {
    if (provider === 'elevenlabs') return entry.ids.elevenlabs;
    return entry.ids.openai;
  }),
  findByVoiceId: vi.fn(),
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn(),
  compareQuality: vi.fn(),
}));

vi.mock('@/lib/byok', () => ({
  getByokKey: vi.fn(),
  getByokExtraData: vi.fn(),
  listByokProviders: vi.fn().mockResolvedValue([]),
}));

// Inject mocks into Node's require cache before tts.ts is loaded
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id: string) {
  if (id === './tts/elevenlabs.provider' || id.endsWith('/tts/elevenlabs.provider')) {
    return { ElevenLabsProvider: MockElevenLabsProvider };
  }
  if (id === './tts/openai.provider' || id.endsWith('/tts/openai.provider')) {
    return { OpenAITtsProvider: MockOpenAITtsProvider };
  }
  return originalRequire.apply(this, arguments as any);
};

// Also mock the ES module imports
vi.mock('@/lib/providers/tts/elevenlabs.provider', () => ({
  ElevenLabsProvider: MockElevenLabsProvider,
}));

vi.mock('@/lib/providers/tts/openai.provider', () => ({
  OpenAITtsProvider: MockOpenAITtsProvider,
}));

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
  LIMITS: {
    maxDurationMinutes: 30,
    maxVoiceClones: 10,
    canDownload: true,
    canMakePrivate: true,
    canExportPdf: true,
    hasPremiumSfx: true,
  },
  TIER_LIMITS: {
    FREE: {
      maxDurationMinutes: 30,
      maxVoiceClones: 10,
      canDownload: true,
      canMakePrivate: true,
      canExportPdf: true,
      hasPremiumSfx: true,
      premiumVoiceSurcharge: 0,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createAIProvider } from '@/lib/providers/ai';
import { createTtsProvider } from '@/lib/providers/tts';
import { createStorageProvider } from '@/lib/providers/storage';

describe('Provider Factories', () => {
  describe('createAIProvider', () => {
    it('anthropic provider delegates to claude.ts', async () => {
      const provider = createAIProvider('anthropic');
      const result = await provider.generateResponse('system', [
        { role: 'user', content: 'hello' },
      ]);
      expect(result).toEqual({ content: 'test', inputTokens: 10, outputTokens: 20 });
    });
  });

  describe('createTtsProvider', () => {
    it('elevenlabs provider delegates to elevenlabs.ts', async () => {
      const provider = createTtsProvider('elevenlabs');
      const result = await provider.generateSpeech({ text: 'hello', voiceId: 'test' });
      expect(result).toEqual(Buffer.from('audio'));
    });

    it('elevenlabs provider returns distinct voice IDs per speaker', () => {
      const provider = createTtsProvider('elevenlabs');
      const hostVoice = provider.getVoiceId('HOST', 'podcast-1');
      const expertVoice = provider.getVoiceId('EXPERT', 'podcast-1');
      expect(hostVoice).toBeTruthy();
      expect(expertVoice).toBeTruthy();
      expect(hostVoice).not.toBe(expertVoice);
    });

  });

  describe('createStorageProvider', () => {
    it('r2 provider delegates to r2.ts', async () => {
      const provider = createStorageProvider('r2');
      const url = await provider.uploadFile('key', Buffer.from('data'), 'text/plain');
      expect(url).toBe('https://r2.example.com/file');
    });
  });

});
