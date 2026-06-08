import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mock handles ----

const {
  mockClassSectionCreate,
  mockSpeakingPromptCreateMany,
} = vi.hoisted(() => {
  const classSectionCreate = vi.fn();
  const speakingPromptCreateMany = vi.fn();
  return {
    mockClassSectionCreate: classSectionCreate,
    mockSpeakingPromptCreateMany: speakingPromptCreateMany,
  };
});

const { mockGetAiKey } = vi.hoisted(() => ({ mockGetAiKey: vi.fn() }));
const { mockGetAiProviderMeta } = vi.hoisted(() => ({ mockGetAiProviderMeta: vi.fn() }));
const { mockCreateAIProvider, mockGenerateResponse } = vi.hoisted(() => {
  const generateResponse = vi.fn();
  return {
    mockCreateAIProvider: vi.fn((..._args: unknown[]) => ({ generateResponse })),
    mockGenerateResponse: generateResponse,
  };
});
const { mockLoadAndRender } = vi.hoisted(() => ({ mockLoadAndRender: vi.fn() }));
const { mockCanResolveTts, mockResolveTtsProvider } = vi.hoisted(() => ({
  mockCanResolveTts: vi.fn(),
  mockResolveTtsProvider: vi.fn(),
}));
const { mockGetAutoModelConfig } = vi.hoisted(() => ({ mockGetAutoModelConfig: vi.fn() }));
const { mockUploadFile } = vi.hoisted(() => ({ mockUploadFile: vi.fn() }));
const { mockLogUsage } = vi.hoisted(() => ({ mockLogUsage: vi.fn() }));

// ---- Module mocks ----

vi.mock('@/lib/prisma', () => ({
  prisma: {
    classSection: {
      create: (...args: unknown[]) => mockClassSectionCreate(...args),
    },
    speakingPrompt: {
      createMany: (...args: unknown[]) => mockSpeakingPromptCreateMany(...args),
    },
  },
}));

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

vi.mock('@/lib/providers/ai-registry', () => ({
  getAiProviderMeta: (...args: unknown[]) => mockGetAiProviderMeta(...args),
}));

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (...args: unknown[]) => mockCreateAIProvider(...args),
}));

vi.mock('@/lib/prompt-loader', () => ({
  loadAndRender: (...args: unknown[]) => mockLoadAndRender(...args),
}));

vi.mock('@/lib/providers/tts', () => ({
  canResolveTts: (...args: unknown[]) => mockCanResolveTts(...args),
  resolveTtsProvider: (...args: unknown[]) => mockResolveTtsProvider(...args),
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...args: unknown[]) => mockGetAutoModelConfig(...args),
}));

vi.mock('@/lib/r2', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test (must come AFTER vi.mock calls) ----

import { generateClassSpeaking } from '@/lib/class-speaking-generator';
import type { ClassSpeakingParams } from '@/lib/class-speaking-generator';

// ---- Fixtures ----

const SAMPLE_PHRASES_JSON = JSON.stringify([
  { targetPhrase: 'Hola, ¿cómo estás?', translation: 'Hello, how are you?', ipa: 'ˈola ˈkomo esˈtas' },
  { targetPhrase: 'Me llamo Ana.', translation: 'My name is Ana.', ipa: 'me ˈʎamo ˈana' },
  { targetPhrase: 'Buenos días.', translation: 'Good morning.', ipa: 'ˈbwenos ˈdias' },
  { targetPhrase: 'Hasta luego.', translation: 'See you later.', ipa: 'ˈasta ˈlweɣo' },
]);

const PARAMS: ClassSpeakingParams = {
  userId: 'u1',
  classId: 'class-1',
  level: 'A1',
  nativeLang: 'en',
  targetLang: 'es',
  objective: 'Practice everyday greetings',
  targetVocab: [
    { lemma: 'hola', gloss: 'hello' },
    { lemma: 'buenos días', gloss: 'good morning' },
  ],
};

// ---- Helpers ----

const mockGenerateSpeech = vi.fn();
const mockGetVoiceId = vi.fn(() => 'voice-abc');

function setupHappyPath({ withTts = true }: { withTts?: boolean } = {}) {
  mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
  mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'm' });
  mockLoadAndRender.mockReturnValue('You are a speaking prompt author.');
  mockGenerateResponse.mockResolvedValue({
    content: SAMPLE_PHRASES_JSON,
    inputTokens: 50,
    outputTokens: 100,
    model: 'm',
  });
  mockCanResolveTts.mockResolvedValue(withTts);
  if (withTts) {
    mockGetAutoModelConfig.mockResolvedValue({ free: { ttsProvider: 'elevenlabs' } });
    mockGenerateSpeech.mockResolvedValue(Buffer.from('audio'));
    mockResolveTtsProvider.mockResolvedValue({
      provider: { generateSpeech: mockGenerateSpeech, getVoiceId: mockGetVoiceId },
      source: 'byok',
      providerId: 'elevenlabs',
    });
    mockUploadFile.mockResolvedValue('https://r2.example.com/speaking-ref/class-1/0.mp3');
  }
  mockClassSectionCreate.mockResolvedValue({ id: 'section-1' });
  mockSpeakingPromptCreateMany.mockResolvedValue({ count: 4 });
}

// ---- Tests ----

describe('generateClassSpeaking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy path', () => {
    it('returns { sectionId } on success', async () => {
      setupHappyPath();

      const result = await generateClassSpeaking(PARAMS);

      expect(result).toEqual({ sectionId: 'section-1' });
    });

    it('creates a SPEAKING ClassSection with status READY and correct seed', async () => {
      setupHappyPath();

      await generateClassSpeaking(PARAMS);

      expect(mockClassSectionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classId: 'class-1',
            skill: 'SPEAKING',
            attempt: 1,
            seed: 'class-1-SPEAKING-1',
            status: 'READY',
            spec: { objective: 'Practice everyday greetings' },
            generatedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('creates 4 SpeakingPrompt rows ordered 1..4', async () => {
      setupHappyPath();

      await generateClassSpeaking(PARAMS);

      expect(mockSpeakingPromptCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ sectionId: 'section-1', order: 1, targetPhrase: 'Hola, ¿cómo estás?' }),
            expect.objectContaining({ sectionId: 'section-1', order: 2, targetPhrase: 'Me llamo Ana.' }),
            expect.objectContaining({ sectionId: 'section-1', order: 3, targetPhrase: 'Buenos días.' }),
            expect.objectContaining({ sectionId: 'section-1', order: 4, targetPhrase: 'Hasta luego.' }),
          ]),
        }),
      );
    });

    it('calls the LLM with the correct speaking prompt template', async () => {
      setupHappyPath();

      await generateClassSpeaking(PARAMS);

      expect(mockLoadAndRender).toHaveBeenCalledWith(
        'speaking/generate-speaking-prompts.md',
        expect.objectContaining({
          COUNT: '4',
          LEVEL: 'A1',
          NATIVE: 'en',
          TARGET: 'es',
          OBJECTIVE: 'Practice everyday greetings',
        }),
      );
    });

    it('logs usage for the LLM call', async () => {
      setupHappyPath();

      await generateClassSpeaking(PARAMS);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'class-speaking-prompts',
          userId: 'u1',
          model: 'm',
        }),
      );
    });

    it('includes reference TTS URLs in prompt rows when TTS is available', async () => {
      setupHappyPath({ withTts: true });
      mockUploadFile.mockImplementation((_key: string, _buf: Buffer, _ct: string) =>
        Promise.resolve('https://r2.example.com/ref.mp3'),
      );

      await generateClassSpeaking(PARAMS);

      const call = mockSpeakingPromptCreateMany.mock.calls[0][0];
      const firstPrompt = call.data[0];
      expect(firstPrompt.referenceTtsUrl).toBe('https://r2.example.com/ref.mp3');
    });

    it('uploads reference audio to speaking-ref/<classId>/<index>.mp3', async () => {
      setupHappyPath({ withTts: true });

      await generateClassSpeaking(PARAMS);

      expect(mockUploadFile).toHaveBeenCalledWith(
        'speaking-ref/class-1/0.mp3',
        expect.any(Buffer),
        'audio/mpeg',
      );
    });
  });

  describe('when canResolveTts is false', () => {
    it('still creates 4 prompts with null referenceTtsUrl', async () => {
      setupHappyPath({ withTts: false });

      const result = await generateClassSpeaking(PARAMS);

      expect(result).toEqual({ sectionId: 'section-1' });
      expect(mockResolveTtsProvider).not.toHaveBeenCalled();
      expect(mockUploadFile).not.toHaveBeenCalled();

      const call = mockSpeakingPromptCreateMany.mock.calls[0][0];
      expect(call.data).toHaveLength(4);
      for (const row of call.data) {
        expect(row.referenceTtsUrl).toBeNull();
      }
    });
  });

  describe('TTS failure is non-fatal', () => {
    it('creates prompts with null referenceTtsUrl when TTS throws', async () => {
      setupHappyPath({ withTts: true });
      mockResolveTtsProvider.mockRejectedValue(new Error('TTS provider unavailable'));

      const result = await generateClassSpeaking(PARAMS);

      expect(result).toEqual({ sectionId: 'section-1' });
      const call = mockSpeakingPromptCreateMany.mock.calls[0][0];
      for (const row of call.data) {
        expect(row.referenceTtsUrl).toBeNull();
      }
    });

    it('creates prompts with null referenceTtsUrl when uploadFile throws', async () => {
      setupHappyPath({ withTts: true });
      mockUploadFile.mockRejectedValue(new Error('R2 upload failed'));

      const result = await generateClassSpeaking(PARAMS);

      expect(result).toEqual({ sectionId: 'section-1' });
      const call = mockSpeakingPromptCreateMany.mock.calls[0][0];
      for (const row of call.data) {
        expect(row.referenceTtsUrl).toBeNull();
      }
    });
  });

  describe('error paths', () => {
    it('throws when getAiKey returns null', async () => {
      mockGetAiKey.mockResolvedValue(null);

      await expect(generateClassSpeaking(PARAMS)).rejects.toThrow(/AI provider key/);
    });

    it('throws when the provider has no default model', async () => {
      mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
      mockGetAiProviderMeta.mockReturnValue({ defaultModel: null });

      await expect(generateClassSpeaking(PARAMS)).rejects.toThrow(/No default AI model/);
    });

    it('throws when LLM response is not valid JSON and produces no phrases', async () => {
      mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
      mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'm' });
      mockLoadAndRender.mockReturnValue('system prompt');
      mockGenerateResponse.mockResolvedValue({
        content: 'not valid json at all',
        inputTokens: 10,
        outputTokens: 10,
        model: 'm',
      });
      mockCanResolveTts.mockResolvedValue(false);

      await expect(generateClassSpeaking(PARAMS)).rejects.toThrow(/no usable phrases/);
    });

    it('throws when LLM response JSON contains no valid phrase objects', async () => {
      mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
      mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'm' });
      mockLoadAndRender.mockReturnValue('system prompt');
      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify([{ bad: 'shape' }, { also: 'bad' }]),
        inputTokens: 10,
        outputTokens: 10,
        model: 'm',
      });
      mockCanResolveTts.mockResolvedValue(false);

      await expect(generateClassSpeaking(PARAMS)).rejects.toThrow(/no usable phrases/);
    });
  });

  describe('JSON fence stripping', () => {
    it('parses phrases correctly when LLM wraps output in markdown fences', async () => {
      setupHappyPath({ withTts: false });
      mockGenerateResponse.mockResolvedValue({
        content: '```json\n' + SAMPLE_PHRASES_JSON + '\n```',
        inputTokens: 50,
        outputTokens: 100,
        model: 'm',
      });

      const result = await generateClassSpeaking(PARAMS);

      expect(result).toEqual({ sectionId: 'section-1' });
      expect(mockSpeakingPromptCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ targetPhrase: 'Hola, ¿cómo estás?' }),
          ]),
        }),
      );
    });
  });
});
