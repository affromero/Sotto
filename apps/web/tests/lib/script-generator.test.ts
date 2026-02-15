import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();

vi.mock('@/lib/claude', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
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
        turns: [{ speaker: 'HOST', text: 'Hello' }],
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

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].text).toBe('Hello');
      expect(result.markdown).toBeDefined();
    });

    it('includes source content when provided', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Today we discuss...' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 1200,
        outputTokens: 600,
      });

      const sourceContent = 'This is a long article about AI ethics. '.repeat(100);

      await generateScript({
        topic: 'AI Ethics',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['bias', 'privacy'],
        tone: 'professional',
        durationTarget: 10,
        sourceContent,
      });

      const call = mockGenerateResponse.mock.calls[0];
      const userMessage = call[1][0].content;

      expect(userMessage).toContain('Source material:');
    });

    it('applies casual tone to system prompt', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Hey there!' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      await generateScript({
        topic: 'Pizza History',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: ['origins', 'variations'],
        tone: 'casual',
        durationTarget: 7,
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).toContain('Keep it light, use humor freely, casual language');
    });

    it('applies professional tone to system prompt', async () => {
      const mockResponse = {
        turns: [{ speaker: 'EXPERT', text: 'Good morning.' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 450,
        outputTokens: 550,
      });

      await generateScript({
        topic: 'Corporate Finance',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['valuation', 'M&A'],
        tone: 'professional',
        durationTarget: 12,
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).toContain('Maintain a professional but warm tone');
    });

    it('applies socratic tone to system prompt', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'What if we consider...' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 420,
        outputTokens: 520,
      });

      await generateScript({
        topic: 'Philosophy of Mind',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        focusAreas: ['consciousness', 'qualia'],
        tone: 'socratic',
        durationTarget: 20,
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).toContain('Use the Socratic method');
    });

    it('applies storytelling tone to system prompt', async () => {
      const mockResponse = {
        turns: [{ speaker: 'EXPERT', text: 'Once upon a time...' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 430,
        outputTokens: 530,
      });

      await generateScript({
        topic: 'The Space Race',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['Apollo', 'Cold War'],
        tone: 'storytelling',
        durationTarget: 15,
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).toContain('Frame everything as a narrative');
    });

    it('includes focus areas in system prompt', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: "Let's dive in!" }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      await generateScript({
        topic: 'Machine Learning',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['neural networks', 'backpropagation', 'overfitting'],
        tone: 'professional',
        durationTarget: 10,
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).toContain('Focus areas: neural networks, backpropagation, overfitting');
    });

    it('includes duration target in system prompt', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Welcome!' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 350,
        outputTokens: 450,
      });

      await generateScript({
        topic: 'Blockchain',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).toContain('Target approximately 5 minutes');
      expect(systemPrompt).toContain('~750 words'); // 5 * 150
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
        turns: [{ speaker: 'HOST', text: 'Welcome!', direction: 'warm' }],
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
        turns: [{ speaker: 'HOST', text: 'Welcome!' }],
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
        insertAfterTurn: 0, // after the single turn
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
        turns: [{ speaker: 'HOST', text: 'Default content.' }],
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

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].text).toBe('Default content.');
      expect(mockGenerateResponse).toHaveBeenCalledOnce();
    });

    it('extracts JSON from Claude response wrapped in text', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Hello!' }],
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

      expect(result.turns).toHaveLength(1);
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

    it('truncates sourceContent at 20000 chars', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Summary time.' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 2000,
        outputTokens: 600,
      });

      const longContent = 'A'.repeat(25000); // 25k chars, exceeds limit

      await generateScript({
        topic: 'Long Source',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
        sourceContent: longContent,
      });

      const call = mockGenerateResponse.mock.calls[0];
      const userMessage = call[1][0].content;

      // Source material header + 20000 chars of content
      expect(userMessage).toContain('Source material:');
      const contentAfterHeader = userMessage.split('Source material:\n')[1];
      expect(contentAfterHeader.length).toBe(20000);
    });

    it('passes audience parameter to system prompt', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Hey kids!' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 400,
        outputTokens: 500,
      });

      await generateScript({
        topic: 'Dinosaurs',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        audience: 'kids',
        focusAreas: [],
        tone: 'casual',
        durationTarget: 5,
      });

      const systemPrompt = mockGenerateResponse.mock.calls[0][0];
      expect(systemPrompt).toContain('kids');
      expect(systemPrompt).toContain('CHILDREN');
    });

    it('passes apiKeyOverride to generateResponse', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'BYOK test.' }],
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

    it('includes sourceMetadata in user message when provided', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'From the article...' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 600,
      });

      await generateScript({
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

      const call = mockGenerateResponse.mock.calls[0];
      const userMessage = call[1][0].content;

      expect(userMessage).toContain('Title: The Future of AI');
      expect(userMessage).toContain('Author: Jane Doe');
      expect(userMessage).toContain('Published: 2024-03-15');
      expect(userMessage).toContain('Source: TechCrunch');
      expect(userMessage).toContain('Content:');
      expect(userMessage).toContain('Article body text here');
    });

    it('uses simple format when sourceMetadata is absent', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'From the source...' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 600,
      });

      await generateScript({
        topic: 'No Metadata',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: [],
        tone: 'professional',
        durationTarget: 10,
        sourceContent: 'Plain source text',
      });

      const call = mockGenerateResponse.mock.calls[0];
      const userMessage = call[1][0].content;

      expect(userMessage).toContain('Source material:\nPlain source text');
      expect(userMessage).not.toContain('Title:');
      expect(userMessage).not.toContain('Content:');
    });

    it('handles partial sourceMetadata (some fields undefined)', async () => {
      const mockResponse = {
        turns: [{ speaker: 'HOST', text: 'Partial meta...' }],
        soundCues: [],
        references: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResponse),
        inputTokens: 500,
        outputTokens: 600,
      });

      await generateScript({
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

      const call = mockGenerateResponse.mock.calls[0];
      const userMessage = call[1][0].content;

      expect(userMessage).toContain('Title: Only Title');
      expect(userMessage).not.toContain('Author:');
      expect(userMessage).not.toContain('Published:');
      expect(userMessage).not.toContain('Source:');
    });
  });
});

describe('generateScriptWithFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('truncates sourceContent at 20000 chars', async () => {
    const mockResponse = {
      turns: [{ speaker: 'HOST', text: 'Revised content.' }],
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
      turns: [{ speaker: 'HOST', text: 'Revised with metadata.' }],
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
});
