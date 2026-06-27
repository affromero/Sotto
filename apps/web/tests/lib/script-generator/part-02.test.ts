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

  describe('error handling and edge cases', () => {
    it('handles empty topic gracefully', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Default content.' },
          { speaker: 'EXPERT', text: 'Indeed.' },
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
        turns: [
          { speaker: 'HOST', text: 'Hello!' },
          { speaker: 'EXPERT', text: 'Hi!' },
        ],
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
        turns: [
          { speaker: 'HOST', text: 'Summary time.' },
          { speaker: 'EXPERT', text: 'Agreed.' },
        ],
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
        turns: [
          { speaker: 'HOST', text: 'Hey kids!' },
          { speaker: 'EXPERT', text: 'Hello!' },
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

    it('injects bias guidance for political source with non-center bias', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Political topic.' },
          { speaker: 'EXPERT', text: 'Indeed.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 600,
      });

      await generateScript({
        topic: 'US Immigration Policy',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['immigration'],
        tone: 'professional',
        durationTarget: 10,
        sourceContent: 'Article about immigration reform',
        sourceMetadata: {
          title: 'Immigration Reform',
          siteName: 'The Daily Wire',
          biasAnalysis: {
            isPolitical: true,
            sourceBias: 'right',
            sourceFactuality: 'mixed',
            sourceName: 'The Daily Wire',
          },
        },
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).toContain('Political Balance Guidance');
      expect(systemPrompt).toContain('The Daily Wire');
      expect(systemPrompt).toContain('right');
    });

    it('does not inject bias guidance for non-political topics', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Science topic.' },
          { speaker: 'EXPERT', text: 'Indeed.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 600,
      });

      await generateScript({
        topic: 'Quantum Computing Breakthroughs',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['qubits'],
        tone: 'professional',
        durationTarget: 10,
        sourceMetadata: {
          title: 'Quantum Paper',
          biasAnalysis: {
            isPolitical: false,
            sourceBias: 'left',
            sourceFactuality: 'high',
            sourceName: 'Some Source',
          },
        },
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).not.toContain('Political Balance Guidance');
    });

    it('does not inject bias guidance for center sources', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'News.' },
          { speaker: 'EXPERT', text: 'Indeed.' },
        ],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 600,
      });

      await generateScript({
        topic: 'Immigration Policy Update',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['immigration'],
        tone: 'professional',
        durationTarget: 10,
        sourceMetadata: {
          title: 'Reuters Article',
          biasAnalysis: {
            isPolitical: true,
            sourceBias: 'center',
            sourceFactuality: 'very-high',
            sourceName: 'Reuters',
          },
        },
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).not.toContain('Political Balance Guidance');
    });

    it('passes web search tool to generateResponse', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'Current events.' },
          { speaker: 'EXPERT', text: 'Indeed.' },
        ],
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
          useWebSearch: true,
        })
      );
    });

    it('passes apiKeyOverride to generateResponse', async () => {
      const mockResponse = {
        turns: [
          { speaker: 'HOST', text: 'BYOK test.' },
          { speaker: 'EXPERT', text: 'Working.' },
        ],
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
        turns: [
          { speaker: 'HOST', text: 'From the article...' },
          { speaker: 'EXPERT', text: 'Fascinating.' },
        ],
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
        turns: [
          { speaker: 'HOST', text: 'From the source...' },
          { speaker: 'EXPERT', text: 'Right.' },
        ],
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
        turns: [
          { speaker: 'HOST', text: 'Partial meta...' },
          { speaker: 'EXPERT', text: 'Noted.' },
        ],
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
        {
          number: 1,
          title: 'Original Study',
          authors: ['Smith'],
          year: 2023,
          url: 'https://example.com/a',
          type: 'PAPER',
          publisher: 'Nature',
          doi: '10.1234/abc',
        },
        {
          number: 2,
          title: 'Same study different title',
          authors: ['Smith J'],
          year: 2023,
          url: 'https://example.com/b',
          type: 'PAPER',
          publisher: 'Nature',
          doi: '10.1234/abc',
        },
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
        {
          number: 1,
          title: 'Article A',
          authors: ['Author A'],
          year: 2023,
          url: 'https://example.com/same',
          type: 'WEB',
          publisher: null,
          doi: null,
        },
        {
          number: 2,
          title: 'Article B',
          authors: ['Author B'],
          year: 2023,
          url: 'https://example.com/same',
          type: 'WEB',
          publisher: null,
          doi: null,
        },
        {
          number: 3,
          title: 'Unique',
          authors: ['Author C'],
          year: 2024,
          url: 'https://other.com',
          type: 'ARTICLE',
          publisher: null,
          doi: null,
        },
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
        {
          number: 1,
          title: 'Machine Learning Fundamentals',
          authors: ['Goodfellow'],
          year: 2016,
          url: null,
          type: 'BOOK',
          publisher: 'MIT Press',
          doi: null,
        },
        {
          number: 2,
          title: 'machine learning fundamentals',
          authors: ['Goodfellow I'],
          year: 2016,
          url: null,
          type: 'BOOK',
          publisher: 'MIT Press',
          doi: null,
        },
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
        {
          number: 1,
          title: 'Unique A',
          authors: ['A'],
          year: 2023,
          url: 'https://a.com',
          type: 'PAPER',
          publisher: null,
          doi: '10.1/a',
        },
        {
          number: 2,
          title: 'Unique B',
          authors: ['B'],
          year: 2024,
          url: 'https://b.com',
          type: 'PAPER',
          publisher: null,
          doi: '10.1/b',
        },
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
});
