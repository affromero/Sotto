import { describe, it, expect, vi, afterEach } from 'vitest';
import { blockedProviderExecution } from '../helpers/runtime/provider-execution';

const serverConfiguration = vi.hoisted(() => ({
  values: {} as Record<string, string | undefined>,
}));
vi.mock('@/lib/server-config', () => ({
  infra: (key: string) => serverConfiguration.values[key],
}));

// Create mock TTS provider classes that will be injected via module.require
class MockElevenLabsProvider {
  providerId = 'elevenlabs';
  async generateSpeech() {
    return Buffer.from('audio');
  }
  async generateSoundEffect() {
    return Buffer.from('sfx');
  }
  getVoiceId(speaker: string, episodeId?: string) {
    if (!episodeId) {
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
  getProviderMeta: vi.fn((id: string) => {
    const allLanguages = new Set(['en', 'es', 'uk']);
    const humeLanguages = new Set(['en', 'es']);
    return {
      defaultModel: id === 'hume' ? 'octave-v2' : 'test-model',
      models:
        id === 'hume'
          ? [
              {
                id: 'octave-v2',
                displayName: 'Octave V2',
                tier: 'ultra',
                supportedLanguages: humeLanguages,
              },
            ]
          : [
              {
                id: 'test-model',
                displayName: 'Test Model',
                tier: 'premium',
                supportedLanguages: allLanguages,
              },
            ],
      modelsWithoutTextContext: [],
    };
  }),
  compareQuality: vi.fn(),
  isValidProviderId: (id: string) =>
    [
      'elevenlabs',
      'openai',
      'cartesia',
      'hume',
      'fal',
      'replicate',
      'minimax',
      'mistral',
      'kokoro',
      'local',
    ].includes(id),
}));

vi.mock('@/lib/byok', () => ({
  getByokKey: vi.fn(),
  getSharedByokKey: vi.fn().mockResolvedValue(null),
  hasSharedByokKey: vi.fn().mockResolvedValue(false),
  listByokProviders: vi.fn().mockResolvedValue([]),
}));

// Inject mocks into Node's require cache before tts.ts is loaded
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id: string) {
  if (id === '@/lib/providers/tts/elevenlabs.provider' || id.endsWith('/tts/elevenlabs.provider')) {
    return { ElevenLabsProvider: MockElevenLabsProvider };
  }
  if (id === '@/lib/providers/tts/openai.provider' || id.endsWith('/tts/openai.provider')) {
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
  })
);
const mockLlmStreamResponse = vi.fn((_system: unknown, _messages: unknown, _options?: unknown) =>
  (async function* () {
    yield 'chunk';
  })()
);

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
  })
);

vi.mock('@/lib/claude-code-client', () => ({
  isClaudeCleanupError: () => false,
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
import { resolveTtsProvider, getConfiguredTtsProviderId } from '@/lib/providers/tts';

describe('Provider Factories', () => {
  describe('createAIProvider', () => {
    it('rejects missing provider instead of defaulting to hosted AI', () => {
      expect(() => createAIProvider(undefined as unknown as string)).toThrow(
        'AI provider type is required'
      );
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
      for await (const chunk of provider.streamResponse(
        'system',
        [{ role: 'user', content: 'hello' }],
        { model: 'claude-haiku-4-5-20251001', apiKeyOverride: 'user-key' }
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['chunk']);
      expect(mockLlmStreamResponse).toHaveBeenCalledWith(
        'system',
        [{ role: 'user', content: 'hello' }],
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
          apiKeyOverride: 'user-key',
        })
      );
    });

    it('claude-code provider delegates to the Claude Code client', async () => {
      const provider = createAIProvider('claude-code');
      const result = await provider.generateResponse(
        'system',
        [{ role: 'user', content: 'hello' }],
        { model: 'claude-code:opus' }
      );
      expect(mockExecuteClaudeCode).toHaveBeenCalledWith('system', 'hello', {
        model: 'claude-code:opus',
        useWebSearch: undefined,
      });
      expect(result).toEqual({
        content: 'claude-code',
        inputTokens: 3,
        outputTokens: 4,
        model: 'claude-code:opus',
      });
    });
  });

  describe('resolveTtsProvider', () => {
    it('rejects missing provider instead of auto-selecting one', async () => {
      await expect(
        resolveTtsProvider({
          userId: 'user-1',
          episodeId: 'episode-1',
          execution: blockedProviderExecution('user-1'),
        })
      ).rejects.toThrow('TTS provider is required');
    });

    it('rejects auto provider instead of choosing from configured keys', async () => {
      await expect(
        resolveTtsProvider({
          userId: 'user-1',
          execution: blockedProviderExecution('user-1'),
          episodeId: 'episode-1',
          requestedProvider: 'auto',
        })
      ).rejects.toThrow('TTS provider is required');
    });

    it('rejects a selected TTS provider when no model supports the language', async () => {
      await expect(
        resolveTtsProvider({
          userId: 'user-1',
          execution: blockedProviderExecution('user-1'),
          episodeId: 'episode-1',
          requestedProvider: 'hume',
          language: 'uk',
        })
      ).rejects.toThrow('TTS provider "hume" does not support language "uk"');
    });
  });

  describe('getConfiguredTtsProviderId', () => {
    afterEach(() => {
      serverConfiguration.values = {};
    });

    it('returns null when the shared TTS provider is unset', () => {
      expect(getConfiguredTtsProviderId()).toBeNull();
    });

    it('returns the configured keyless local provider', () => {
      serverConfiguration.values.ttsProvider = 'kokoro';
      expect(getConfiguredTtsProviderId()).toBe('kokoro');
    });

    it('returns the configured generic local sidecar provider', () => {
      serverConfiguration.values.ttsProvider = 'local';
      expect(getConfiguredTtsProviderId()).toBe('local');
    });

    it('returns null for an unknown shared TTS provider', () => {
      serverConfiguration.values.ttsProvider = 'bogus';
      expect(getConfiguredTtsProviderId()).toBeNull();
    });
  });
});
