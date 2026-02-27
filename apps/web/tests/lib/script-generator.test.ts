import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();

vi.mock('@/lib/llm', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  WEB_SEARCH_TOOL: { type: 'web_search_20250305', name: 'web_search' },
}));

// ---- Import under test ----
import { generateScript, generateScriptWithFeedback } from '@/lib/script-generator';

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
          { type: 'intro', prompt: 'warm podcast intro', durationSeconds: 3, insertAfterTurn: -1 },
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
        turns: [{ speaker: 'HOST', text: 'Hello' }, { speaker: 'EXPERT', text: 'Hi there.' }],
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
        turns: [{ speaker: 'HOST', text: 'Today we discuss...' }, { speaker: 'EXPERT', text: 'Great topic.' }],
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
        turns: [{ speaker: 'HOST', text: 'Hey there!' }, { speaker: 'EXPERT', text: 'Hey!' }],
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
        turns: [{ speaker: 'HOST', text: 'Welcome.' }, { speaker: 'EXPERT', text: 'Good morning.' }],
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
        turns: [{ speaker: 'HOST', text: 'What if we consider...' }, { speaker: 'EXPERT', text: 'Interesting point.' }],
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
        turns: [{ speaker: 'HOST', text: 'Tell us a story.' }, { speaker: 'EXPERT', text: 'Once upon a time...' }],
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
        turns: [{ speaker: 'HOST', text: "Let's dive in!" }, { speaker: 'EXPERT', text: 'Absolutely.' }],
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
        turns: [{ speaker: 'HOST', text: 'Welcome!' }, { speaker: 'EXPERT', text: 'Thanks.' }],
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
        turns: [{ speaker: 'HOST', text: 'Welcome!', direction: 'warm' }, { speaker: 'EXPERT', text: 'Great to be here.' }],
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
        turns: [{ speaker: 'HOST', text: 'Welcome!' }, { speaker: 'EXPERT', text: 'Thanks.' }],
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

  describe('error handling and edge cases', () => {
    it('handles empty topic gracefully', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Default content.' }, { speaker: 'EXPERT', text: 'Indeed.' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 300,
        outputTokens: 400,
      });

      const result = await generateScript({
        topic: '',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('Default content.');
    });

    it('extracts JSON from Claude response wrapped in text', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Hello!' }, { speaker: 'EXPERT', text: 'Hi!' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: `Here is the script:\n\n${JSON.stringify(mockResponse)}\n\nEnjoy!`,
        inputTokens: 400,
        outputTokens: 500,
      });

      const result = await generateScript({
        topic: 'JSON Extraction',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('Hello!');
    });

    it('handles backward compat with array-only response', async () => {
      const mockTurns = [
        { speaker: 'HOST', text: 'Old format.' },
        { speaker: 'EXPERT', text: 'Still works.' },
      ];

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockTurns),
        inputTokens: 350,
        outputTokens: 450,
      });

      const result = await generateScript({
        topic: 'Backward Compat',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.soundCues).toHaveLength(2); // defaults added
      expect(result.references).toEqual([]);
    });

    it('succeeds with source content exceeding 20000 chars', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Summary time.' }, { speaker: 'EXPERT', text: 'Agreed.' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 2000,
        outputTokens: 600,
      });

      const longContent = 'A'.repeat(25000); // 25k chars, exceeds limit

      const result = await generateScript({
        topic: 'Long Source',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
        sourceContent: longContent,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('Summary time.');
    });

    it('succeeds with audience parameter', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Hey kids!' }, { speaker: 'EXPERT', text: 'Hello!' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      const result = await generateScript({
        topic: 'Dinosaurs',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        audience: 'kids',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('Hey kids!');
    });

    it('passes web search tool to generateResponse', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Current events.' }, { speaker: 'EXPERT', text: 'Indeed.' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      await generateScript({
        topic: 'Today in Politics',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
      });

      expect(mockGenerateResponse).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        })
      );
    });

    it('passes apiKeyOverride to generateResponse', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'BYOK test.' }, { speaker: 'EXPERT', text: 'Working.' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      await generateScript({
        topic: 'BYOK Test',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
        apiKeyOverride: 'user-api-key-123',
      });

      expect(mockGenerateResponse).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ apiKeyOverride: 'user-api-key-123' })
      );
    });

    it('succeeds with sourceMetadata provided', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'From the article...' }, { speaker: 'EXPERT', text: 'Fascinating.' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 600,
      });

      const result = await generateScript({
        topic: 'Metadata Test',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
        sourceContent: 'Article body text here',
        sourceMetadata: {
          title: 'The Future of AI',
          author: 'Jane Doe',
          publishedDate: '2024-03-15',
          siteName: 'TechCrunch',
        },
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('From the article...');
    });

    it('succeeds without sourceMetadata', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'From the source...' }, { speaker: 'EXPERT', text: 'Right.' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 600,
      });

      const result = await generateScript({
        topic: 'No Metadata',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
        sourceContent: 'Plain source text',
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('From the source...');
    });

    it('succeeds with partial sourceMetadata', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Partial meta...' }, { speaker: 'EXPERT', text: 'Noted.' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 600,
      });

      const result = await generateScript({
        topic: 'Partial Meta',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
        sourceContent: 'Some text',
        sourceMetadata: {
          title: 'Only Title',
        },
      });

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].text).toBe('Partial meta...');
    });

    it('throws ZodError when AI returns malformed script', async () => {
      const malformed = {
        turns: [{ speaker: 'INVALID_SPEAKER', text: '' }],
        soundCues: 'not-an-array',
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(malformed),
        inputTokens: 400,
        outputTokens: 300,
      });

      await expect(
        generateScript({
          topic: 'Malformed Output',
          depth: 'standard',
          audienceLevel: 'intermediate',
          focusAreas: [],
          tone: 'professional',
          durationTarget: 10,
        })
      ).rejects.toThrow();
    });

    it('throws when AI returns an empty turns array', async () => {
      const emptyTurns = {
        turns: [],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(emptyTurns),
        inputTokens: 400,
        outputTokens: 300,
      });

      await expect(
        generateScript({
          topic: 'Too Short',
          depth: 'standard',
          audienceLevel: 'intermediate',
          focusAreas: [],
          tone: 'professional',
          durationTarget: 10,
        })
      ).rejects.toThrow();
    });

    it('succeeds when AI returns a single-turn monologue', async () => {
      const monologue = {
        turns: [{ speaker: 'HOST', text: 'This is a solo monologue. '.repeat(100) }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(monologue),
        inputTokens: 400,
        outputTokens: 300,
      });

      const result = await generateScript({
        topic: 'Solo Topic',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
        speakers: [{ name: 'HOST', description: 'Solo narrator' }],
      });

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].speaker).toBe('HOST');
    });
  });
});

describe('generateScriptWithFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('truncates sourceContent at 20000 chars', async () => {
    const mockResponse = {
      turns: [{ speaker: 'HOST', text: 'Revised content.' }, { speaker: 'EXPERT', text: 'Noted.' }],
      soundCues: [],
      references: [],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResponse),
      inputTokens: 3000,
      outputTokens: 1200,
    });

    const longContent = 'B'.repeat(25000);

    await generateScriptWithFeedback({
      topic: 'Long Source Feedback',
      depth: 'standard',
      audienceLevel: 'intermediate',
      focusAreas: [],
      tone: 'professional',
      durationTarget: 10,
      sourceContent: longContent,
      previousScript: [{ speaker: 'HOST', text: 'Old script.' }],
      previousReferences: [],
      verificationFeedback: 'Fix the citations.',
    });

    const call = mockGenerateResponse.mock.calls[0];
    const userMessage = call[1][0].content;

    expect(userMessage).toContain('Source material:');
    const contentAfterHeader = userMessage.split('Source material:\n')[1];
    // Content is truncated at 20000 chars (though it appears within a larger message)
    expect(contentAfterHeader.length).toBeLessThanOrEqual(20100); // 20000 + small overhead
  });

  it('includes sourceMetadata in user message when provided', async () => {
    const mockResponse = {
      turns: [{ speaker: 'HOST', text: 'Revised with metadata.' }, { speaker: 'EXPERT', text: 'Updated.' }],
      soundCues: [],
      references: [],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResponse),
      inputTokens: 2000,
      outputTokens: 1000,
    });

    await generateScriptWithFeedback({
      topic: 'Metadata Feedback',
      depth: 'deep_dive',
      audienceLevel: 'expert',
      focusAreas: ['accuracy'],
      tone: 'professional',
      durationTarget: 15,
      sourceContent: 'Article content',
      sourceMetadata: {
        title: 'Research Paper',
        author: 'Dr. Smith',
        publishedDate: '2024-06-01',
        siteName: 'Nature',
      },
      previousScript: [{ speaker: 'HOST', text: 'Old.' }],
      previousReferences: [],
      verificationFeedback: 'Add more citations.',
    });

    const call = mockGenerateResponse.mock.calls[0];
    const userMessage = call[1][0].content;

    expect(userMessage).toContain('Title: Research Paper');
    expect(userMessage).toContain('Author: Dr. Smith');
    expect(userMessage).toContain('Source: Nature');
  });

  it('passes web search tool to generateResponse', async () => {
    const mockResponse = {
      turns: [{ speaker: 'HOST', text: 'Revised.' }, { speaker: 'EXPERT', text: 'Confirmed.' }],
      soundCues: [],
      references: [],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResponse),
      inputTokens: 1000,
      outputTokens: 500,
    });

    await generateScriptWithFeedback({
      topic: 'Feedback Web Search',
      depth: 'standard',
      audienceLevel: 'intermediate',
      focusAreas: [],
      tone: 'professional',
      durationTarget: 10,
      previousScript: [{ speaker: 'HOST', text: 'Old.' }],
      previousReferences: [],
      verificationFeedback: 'Verify claims.',
    });

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      })
    );
  });
});

describe('reference deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deduplicates references with the same DOI and remaps citations', async () => {
    const mockResponse = {
      turns: [
        { speaker: 'HOST', text: 'Study A found X [1] and study B confirmed it [2].' },
        { speaker: 'EXPERT', text: 'Indeed, both studies agree [1,2].' },
      ],
      soundCues: [],
      references: [
        { number: 1, title: 'Original Study', authors: ['Smith'], year: 2023, url: 'https://example.com/a', type: 'PAPER', publisher: 'Nature', doi: '10.1234/abc' },
        { number: 2, title: 'Same study different title', authors: ['Smith J'], year: 2023, url: 'https://example.com/b', type: 'PAPER', publisher: 'Nature', doi: '10.1234/abc' },
      ],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResponse),
      inputTokens: 500,
      outputTokens: 800,
    });

    const result = await generateScript({
      topic: 'Dedup DOI',
      depth: 'standard',
      audienceLevel: 'intermediate',
      focusAreas: [],
      tone: 'professional',
      durationTarget: 10,
    });

    expect(result.references).toHaveLength(1);
    expect(result.references[0].number).toBe(1);
    expect(result.references[0].doi).toBe('10.1234/abc');
    // Both [1] and [2] should now be [1]
    expect(result.turns[0].text).toBe('Study A found X [1] and study B confirmed it [1].');
    expect(result.turns[1].text).toBe('Indeed, both studies agree [1].');
  });

  it('deduplicates references with the same URL when no DOI', async () => {
    const mockResponse = {
      turns: [
        { speaker: 'HOST', text: 'Source one [1] and source two [2] and unique [3].' },
        { speaker: 'EXPERT', text: 'Right, per [1,3].' },
      ],
      soundCues: [],
      references: [
        { number: 1, title: 'Article A', authors: ['Author A'], year: 2023, url: 'https://example.com/same', type: 'WEB', publisher: null, doi: null },
        { number: 2, title: 'Article B', authors: ['Author B'], year: 2023, url: 'https://example.com/same', type: 'WEB', publisher: null, doi: null },
        { number: 3, title: 'Unique', authors: ['Author C'], year: 2024, url: 'https://other.com', type: 'ARTICLE', publisher: null, doi: null },
      ],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResponse),
      inputTokens: 500,
      outputTokens: 800,
    });

    const result = await generateScript({
      topic: 'Dedup URL',
      depth: 'standard',
      audienceLevel: 'intermediate',
      focusAreas: [],
      tone: 'professional',
      durationTarget: 10,
    });

    expect(result.references).toHaveLength(2);
    expect(result.references[0].title).toBe('Article A');
    expect(result.references[1].title).toBe('Unique');
    // [2] → [1], [3] → [2]
    expect(result.turns[0].text).toBe('Source one [1] and source two [1] and unique [2].');
    expect(result.turns[1].text).toBe('Right, per [1,2].');
  });

  it('deduplicates references with the same title when no DOI or URL', async () => {
    const mockResponse = {
      turns: [
        { speaker: 'HOST', text: 'The book [1] is great.' },
        { speaker: 'EXPERT', text: 'Same book cited again [2].' },
      ],
      soundCues: [],
      references: [
        { number: 1, title: 'Machine Learning Fundamentals', authors: ['Goodfellow'], year: 2016, url: null, type: 'BOOK', publisher: 'MIT Press', doi: null },
        { number: 2, title: 'machine learning fundamentals', authors: ['Goodfellow I'], year: 2016, url: null, type: 'BOOK', publisher: 'MIT Press', doi: null },
      ],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResponse),
      inputTokens: 500,
      outputTokens: 800,
    });

    const result = await generateScript({
      topic: 'Dedup Title',
      depth: 'standard',
      audienceLevel: 'intermediate',
      focusAreas: [],
      tone: 'professional',
      durationTarget: 10,
    });

    expect(result.references).toHaveLength(1);
    expect(result.turns[1].text).toBe('Same book cited again [1].');
  });

  it('does not alter references or citations when there are no duplicates', async () => {
    const mockResponse = {
      turns: [
        { speaker: 'HOST', text: 'First source [1].' },
        { speaker: 'EXPERT', text: 'Second source [2].' },
      ],
      soundCues: [],
      references: [
        { number: 1, title: 'Unique A', authors: ['A'], year: 2023, url: 'https://a.com', type: 'PAPER', publisher: null, doi: '10.1/a' },
        { number: 2, title: 'Unique B', authors: ['B'], year: 2024, url: 'https://b.com', type: 'PAPER', publisher: null, doi: '10.1/b' },
      ],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResponse),
      inputTokens: 500,
      outputTokens: 800,
    });

    const result = await generateScript({
      topic: 'No Dupes',
      depth: 'standard',
      audienceLevel: 'intermediate',
      focusAreas: [],
      tone: 'professional',
      durationTarget: 10,
    });

    expect(result.references).toHaveLength(2);
    expect(result.turns[0].text).toBe('First source [1].');
    expect(result.turns[1].text).toBe('Second source [2].');
  });

  it('deduplicates references in generateScriptWithFeedback too', async () => {
    const mockResponse = {
      turns: [
        { speaker: 'HOST', text: 'Revised with [1] and [2].' },
        { speaker: 'EXPERT', text: 'Confirmed [2].' },
      ],
      soundCues: [],
      references: [
        { number: 1, title: 'Study X', authors: ['X'], year: 2023, url: null, type: 'PAPER', publisher: null, doi: '10.1/same' },
        { number: 2, title: 'Study Y', authors: ['Y'], year: 2023, url: null, type: 'PAPER', publisher: null, doi: '10.1/same' },
      ],
    };

    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify(mockResponse),
      inputTokens: 1000,
      outputTokens: 500,
    });

    const result = await generateScriptWithFeedback({
      topic: 'Dedup Feedback',
      depth: 'standard',
      audienceLevel: 'intermediate',
      focusAreas: [],
      tone: 'professional',
      durationTarget: 10,
      previousScript: [{ speaker: 'HOST', text: 'Old.' }],
      previousReferences: [],
      verificationFeedback: 'Fix sources.',
    });

    expect(result.references).toHaveLength(1);
    expect(result.turns[0].text).toBe('Revised with [1] and [1].');
    expect(result.turns[1].text).toBe('Confirmed [1].');
  });
});
