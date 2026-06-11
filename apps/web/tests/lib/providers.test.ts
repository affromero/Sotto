import { describe, it, expect, vi, afterEach } from 'vitest';

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
  getProviderMeta: vi.fn().mockReturnValue({ defaultModel: 'test-model' }),
  compareQuality: vi.fn(),
  isValidProviderId: (id: string) =>
    ['elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate', 'minimax', 'mistral', 'kokoro'].includes(id),
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

const mockLlmGenerateResponse = vi.fn(
  async (_system: unknown, _messages: unknown, _options?: unknown) => ({
    content: 'test',
    inputTokens: 10,
    outputTokens: 20,
  }),
);
const mockLlmStreamResponse = vi.fn((_system: unknown, _messages: unknown, _options?: unknown) => (async function* () {
  yield 'chunk';
})());

// Mock the underlying service modules to prevent initialization errors
vi.mock('@/lib/llm', () => ({
  generateResponse: mockLlmGenerateResponse,
  streamResponse: mockLlmStreamResponse,
}));

const mockExecuteClaudeCode = vi.fn(
  async (_system: unknown, _prompt: unknown, _options?: unknown) => ({
    content: 'claude-code',
    inputTokens: 3,
    outputTokens: 4,
  }),
);

vi.mock('@/lib/claude-code-client', () => ({
  executeClaudeCode: mockExecuteClaudeCode,
  streamClaudeCode: vi.fn(),
  serializeMessages: vi.fn((messages: unknown) => JSON.stringify(messages)),
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


vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createAIProvider } from '@/lib/providers/ai';
import { createTtsProvider, resolveTtsProvider, getConfiguredTtsProviderId } from '@/lib/providers/tts';
import { createStorageProvider } from '@/lib/providers/storage';

describe('Provider Factories', () => {
  describe('createAIProvider', () => {
    it('rejects missing provider instead of defaulting to hosted AI', () => {
      expect(() => createAIProvider(undefined as unknown as string)).toThrow('AI provider type is required');
    });

    it('anthropic provider delegates to claude.ts', async () => {
      const provider = createAIProvider('anthropic');
      const result = await provider.generateResponse('system', [
        { role: 'user', content: 'hello' },
      ]);
      expect(result).toEqual({ content: 'test', inputTokens: 10, outputTokens: 20 });
    });

    it('anthropic stream provider forwards BYOK API key overrides', async () => {
      const provider = createAIProvider('anthropic');
      const chunks: string[] = [];
      for await (const chunk of provider.streamResponse('system', [
        { role: 'user', content: 'hello' },
      ], { model: 'claude-haiku-4-5-20251001', apiKeyOverride: 'user-key' })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['chunk']);
      expect(mockLlmStreamResponse).toHaveBeenCalledWith(
        'system',
        [{ role: 'user', content: 'hello' }],
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
          apiKeyOverride: 'user-key',
        }),
      );
    });

    it('claude-code provider delegates to the Claude Code client', async () => {
      const provider = createAIProvider('claude-code');
      const result = await provider.generateResponse('system', [
        { role: 'user', content: 'hello' },
      ], { model: 'claude-code:opus' });
      expect(mockExecuteClaudeCode).toHaveBeenCalledWith(
        'system',
        JSON.stringify([{ role: 'user', content: 'hello' }]),
        { model: 'opus', useWebSearch: undefined },
      );
      expect(result).toEqual({
        content: 'claude-code',
        inputTokens: 3,
        outputTokens: 4,
        model: 'claude-code:opus',
      });
    });
  });

  describe('createTtsProvider', () => {
    it('rejects missing provider instead of defaulting to hosted TTS', () => {
      expect(() => createTtsProvider(undefined as unknown as string)).toThrow('TTS provider type is required');
    });

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

  describe('resolveTtsProvider', () => {
    it('rejects missing provider instead of auto-selecting one', async () => {
      await expect(
        resolveTtsProvider({ userId: 'user-1', podcastId: 'podcast-1' })
      ).rejects.toThrow('TTS provider is required');
    });

    it('rejects auto provider instead of choosing from configured keys', async () => {
      await expect(
        resolveTtsProvider({
          userId: 'user-1',
          podcastId: 'podcast-1',
          requestedProvider: 'auto',
        })
      ).rejects.toThrow('TTS provider is required');
    });
  });

  describe('getConfiguredTtsProviderId', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('returns null when TTS_PROVIDER is unset', () => {
      vi.stubEnv('TTS_PROVIDER', '');
      expect(getConfiguredTtsProviderId()).toBeNull();
    });

    it('returns the keyless local provider when TTS_PROVIDER=kokoro', () => {
      vi.stubEnv('TTS_PROVIDER', 'kokoro');
      expect(getConfiguredTtsProviderId()).toBe('kokoro');
    });

    it('returns null for an unknown TTS_PROVIDER value', () => {
      vi.stubEnv('TTS_PROVIDER', 'bogus');
      expect(getConfiguredTtsProviderId()).toBeNull();
    });
  });

  describe('createStorageProvider', () => {
    it('r2 provider delegates to r2.ts', async () => {
      const provider = createStorageProvider('r2');
      const url = await provider.uploadFile('key', Buffer.from('data'), 'text/plain');
      expect(url).toBe('https://r2.example.com/file');
    });

    it('rejects unknown storage providers instead of switching to local storage', () => {
      expect(() => createStorageProvider('unknown')).toThrow('Unknown storage provider "unknown"');
    });
  });

});
