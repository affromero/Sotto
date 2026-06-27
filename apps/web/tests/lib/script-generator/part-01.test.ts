import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  }),
}));

// ---- Import under test ----
import { generateScript as generateScriptImpl } from '@/lib/script-generator';

const AI_RUNTIME = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
type GenerateScriptParams = Parameters<typeof generateScriptImpl>[0];

function generateScript(
  params: Omit<GenerateScriptParams, 'provider' | 'model'> &
    Partial<Pick<GenerateScriptParams, 'provider' | 'model'>>
) {
  return generateScriptImpl({ ...AI_RUNTIME, ...params });
}

// ---- Tests ----

describe('generateScript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('prompt construction', () => {
    it('returns structured output with turns, soundCues, references, and markdown', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Welcome to the show!', direction: 'energetic' },
          { speaker: 'EXPERT', text: 'Thanks for having me!' },
        ],
        soundCues: [
          { type: 'intro', prompt: 'warm episode intro', durationSeconds: 3, insertAfterTurn: -1 },
        ],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 800,
      });

      const result = await generateScript({
        topic: 'Quantum Computing',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        focusAreas: ['qubits', 'entanglement'],
        tone: 'professional',
        durationTarget: 15,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].speaker).toBe('HOST');
      expect(result.turns[0].direction).toBe('energetic');
      expect(result.soundCues).toHaveLength(1);
      expect(result.references).toEqual([]);
      expect(result.markdown).toContain('Welcome to the show!');
      expect(result.inputTokens).toBe(500);
      expect(result.outputTokens).toBe(800);
    });

    it('generates valid output for minimal params', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Hello' },
          { speaker: 'EXPERT', text: 'Hi there.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 300,
        outputTokens: 400,
      });

      const result = await generateScript({
        topic: 'Climate Change',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('Hello');
      expect(result.markdown).toBeDefined();
    });

    it('succeeds when source content is provided', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Today we discuss...' },
          { speaker: 'EXPERT', text: 'Great topic.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 1200,
        outputTokens: 600,
      });

      const sourceContent = 'This is a long article about AI ethics. '.repeat(100);

      const result = await generateScript({
        topic: 'AI Ethics',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['bias', 'privacy'],
        tone: 'professional',
        durationTarget: 10,
        sourceContent,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('Today we discuss...');
    });

    it('succeeds with casual tone', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Hey there!' },
          { speaker: 'EXPERT', text: 'Hey!' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      const result = await generateScript({
        topic: 'Pizza History',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: ['origins', 'variations'],
        tone: 'casual',
        durationTarget: 7,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('Hey there!');
    });

    it('succeeds with professional tone', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Welcome.' },
          { speaker: 'EXPERT', text: 'Good morning.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 450,
        outputTokens: 550,
      });

      const result = await generateScript({
        topic: 'Corporate Finance',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['valuation', 'M&A'],
        tone: 'professional',
        durationTarget: 12,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[1].text).toBe('Good morning.');
    });

    it('succeeds with socratic tone', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'What if we consider...' },
          { speaker: 'EXPERT', text: 'Interesting point.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 420,
        outputTokens: 520,
      });

      const result = await generateScript({
        topic: 'Philosophy of Mind',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        focusAreas: ['consciousness', 'qualia'],
        tone: 'socratic',
        durationTarget: 20,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('What if we consider...');
    });

    it('succeeds with storytelling tone', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Tell us a story.' },
          { speaker: 'EXPERT', text: 'Once upon a time...' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 430,
        outputTokens: 530,
      });

      const result = await generateScript({
        topic: 'The Space Race',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['Apollo', 'Cold War'],
        tone: 'storytelling',
        durationTarget: 15,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[1].text).toBe('Once upon a time...');
    });

    it('succeeds with focus areas', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: "Let's dive in!" },
          { speaker: 'EXPERT', text: 'Absolutely.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      const result = await generateScript({
        topic: 'Machine Learning',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['neural networks', 'backpropagation', 'overfitting'],
        tone: 'professional',
        durationTarget: 10,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe("Let's dive in!");
    });

    it('succeeds with duration target', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Welcome!' },
          { speaker: 'EXPERT', text: 'Thanks.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 350,
        outputTokens: 450,
      });

      const result = await generateScript({
        topic: 'Blockchain',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('Welcome!');
    });
  });

  describe('language learning instructions', () => {
    it('injects the target-language and vocabulary instructions into the system prompt for a learning episode', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify({
          turns: [
            { speaker: 'HOST', text: '[V1:Guten Morgen]!' },
            { speaker: 'EXPERT', text: 'Ja.' },
          ],
          soundCues: [],
          references: [],
          vocabulary: [],
        }),
        inputTokens: 400,
        outputTokens: 500,
      });

      await generateScript({
        topic: 'Daily greetings',
        depth: 'standard',
        audienceLevel: 'beginner',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 4,
        targetLanguage: 'de',
        languageMode: 'conversational_mix',
        forLearning: true,
        mustIncludeVocabulary: [{ word: 'sprechen', translation: 'to speak' }],
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0] as string;
      expect(systemPrompt).toContain('LANGUAGE LEARNING');
      expect(systemPrompt).toContain('[V{N}:word]');
      expect(systemPrompt).toContain('"vocabulary" array');
      // the learner's required SRS review item must reach the prompt
      expect(systemPrompt).toContain('sprechen');
    });

    it('omits language instructions for a standard English episode', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify({
          turns: [
            { speaker: 'HOST', text: 'Hello.' },
            { speaker: 'EXPERT', text: 'Hi.' },
          ],
          soundCues: [],
          references: [],
        }),
        inputTokens: 300,
        outputTokens: 400,
      });

      await generateScript({
        topic: 'Quantum Computing',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 10,
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0] as string;
      expect(systemPrompt).not.toContain('LANGUAGE LEARNING');
      expect(systemPrompt).not.toContain('[V{N}:word]');
    });
  });

  describe('citation parsing', () => {
    it('parses inline citations from script turns', async () => {
      const mockResponse = {
        turns: [
          {
            speaker: 'HOST',
            text: 'According to a recent study [1], climate change is accelerating.',
          },
          {
            speaker: 'EXPERT',
            text: 'Yes, and research shows [2,3] that temperatures are rising.',
          },
        ],
        soundCues: [],
        references: [
          {
            number: 1,
            title: 'Climate Report 2023',
            authors: ['Smith, J.'],
            year: 2023,
            url: 'https://example.com/climate',
            type: 'PAPER',
            publisher: 'Nature',
            doi: '10.1234/climate',
          },
          {
            number: 2,
            title: 'Temperature Trends',
            authors: ['Doe, A.', 'Lee, B.'],
            year: 2022,
            url: 'https://example.com/temp',
            type: 'ARTICLE',
            publisher: 'Science',
            doi: null,
          },
          {
            number: 3,
            title: 'Global Warming Data',
            authors: ['Brown, C.'],
            year: 2024,
            url: null,
            type: 'REPORT',
            publisher: 'IPCC',
            doi: null,
          },
        ],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 600,
        outputTokens: 900,
      });

      const result = await generateScript({
        topic: 'Climate Change',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        focusAreas: ['temperature', 'emissions'],
        tone: 'professional',
        durationTarget: 15,
      });

      expect(result.references).toHaveLength(3);
      expect(result.references[0]).toMatchObject({
        number: 1,
        title: 'Climate Report 2023',
        type: 'PAPER',
        doi: '10.1234/climate',
      });
      expect(result.references[1].authors).toEqual(['Doe, A.', 'Lee, B.']);
      expect(result.references[2].publisher).toBe('IPCC');
    });

    it('handles empty references array', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: "Welcome to today's show!" },
          { speaker: 'EXPERT', text: 'Thanks for having me.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      const result = await generateScript({
        topic: 'Personal Stories',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      expect(result.references).toEqual([]);
    });
  });

  describe('voice assignment', () => {
    it('alternates between HOST and EXPERT speakers', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Question one?' },
          { speaker: 'EXPERT', text: 'Answer one.' },
          { speaker: 'HOST', text: 'Question two?' },
          { speaker: 'EXPERT', text: 'Answer two.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 700,
      });

      const result = await generateScript({
        topic: 'Interview Format',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
      });

      expect(result.turns).toHaveLength(4);
      expect(result.turns[0].speaker).toBe('HOST');
      expect(result.turns[1].speaker).toBe('EXPERT');
      expect(result.turns[2].speaker).toBe('HOST');
      expect(result.turns[3].speaker).toBe('EXPERT');
    });

    it('preserves delivery directions for turns', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'This is amazing!', direction: 'excited' },
          { speaker: 'EXPERT', text: 'Indeed it is.', direction: 'thoughtful' },
          { speaker: 'HOST', text: 'Tell me more.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 450,
        outputTokens: 600,
      });

      const result = await generateScript({
        topic: 'Expressive Dialogue',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 8,
      });

      expect(result.turns[0].direction).toBe('excited');
      expect(result.turns[1].direction).toBe('thoughtful');
      expect(result.turns[2].direction).toBeUndefined();
    });
  });

  describe('segment structure', () => {
    it('returns structured script with turns, soundCues, references, markdown', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Welcome!', direction: 'warm' },
          { speaker: 'EXPERT', text: 'Great to be here.' },
        ],
        soundCues: [
          { type: 'intro', prompt: 'upbeat jingle', durationSeconds: 3, insertAfterTurn: -1 },
        ],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      const result = await generateScript({
        topic: 'Test Topic',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      expect(result).toHaveProperty('turns');
      expect(result).toHaveProperty('soundCues');
      expect(result).toHaveProperty('references');
      expect(result).toHaveProperty('markdown');
      expect(result).toHaveProperty('inputTokens');
      expect(result).toHaveProperty('outputTokens');

      expect(result.inputTokens).toBe(400);
      expect(result.outputTokens).toBe(500);
    });

    it('generates markdown with speaker labels and delivery directions', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Hello everyone!', direction: 'energetic' },
          { speaker: 'EXPERT', text: 'Thanks for tuning in.' },
          { speaker: 'HOST', text: "Let's begin.", direction: 'thoughtful' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 450,
        outputTokens: 550,
      });

      const result = await generateScript({
        topic: 'Markdown Test',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
      });

      expect(result.markdown).toContain('**HOST:** _(energetic)_ Hello everyone!');
      expect(result.markdown).toContain('**EXPERT:** Thanks for tuning in.');
      expect(result.markdown).toContain("**HOST:** _(thoughtful)_ Let's begin.");
    });

    it('adds default sound cues if none provided by Claude', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Welcome!' },
          { speaker: 'EXPERT', text: 'Thanks.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 350,
        outputTokens: 450,
      });

      const result = await generateScript({
        topic: 'Default Sound Cues',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      expect(result.soundCues).toHaveLength(2);
      expect(result.soundCues[0]).toMatchObject({
        type: 'intro',
        durationSeconds: 3,
        insertAfterTurn: -1,
      });
      expect(result.soundCues[1]).toMatchObject({
        type: 'outro',
        durationSeconds: 4,
        insertAfterTurn: 1, // after the last turn
      });
    });

    it('preserves sound cues from Claude response', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Part one' },
          { speaker: 'EXPERT', text: 'Part two' },
        ],
        soundCues: [
          { type: 'intro', prompt: 'custom intro', durationSeconds: 2, insertAfterTurn: -1 },
          { type: 'transition', prompt: 'whoosh', durationSeconds: 1, insertAfterTurn: 0 },
          { type: 'outro', prompt: 'custom outro', durationSeconds: 5, insertAfterTurn: 1 },
        ],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 700,
      });

      const result = await generateScript({
        topic: 'Custom Sound Cues',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
      });

      expect(result.soundCues).toHaveLength(3);
      expect(result.soundCues[0].prompt).toBe('custom intro');
      expect(result.soundCues[1].type).toBe('transition');
      expect(result.soundCues[2].durationSeconds).toBe(5);
    });
  });
});
