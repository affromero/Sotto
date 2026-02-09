import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();
const mockStreamResponse = vi.fn();

vi.mock('@/lib/claude', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  streamResponse: (...args: unknown[]) => mockStreamResponse(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- Import under test ----
import {
  parseChips,
  parseMetadata,
  getDiscoveryResponse,
  streamDiscoveryResponse,
} from '@/lib/discovery-agent';

// ---- Tests ----

describe('parseChips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses chips from message with standard format', () => {
    const message =
      'What topic are you curious about? [chips: Quantum Computing · AI Ethics · Space Exploration]';
    const result = parseChips(message);

    expect(result.text).toBe('What topic are you curious about?');
    expect(result.chips).toEqual(['Quantum Computing', 'AI Ethics', 'Space Exploration']);
  });

  it('parses chips with extra whitespace around separators', () => {
    const message = 'Choose a depth level [chips: Quick Overview  ·  Standard  ·  Deep Dive]';
    const result = parseChips(message);

    expect(result.text).toBe('Choose a depth level');
    expect(result.chips).toEqual(['Quick Overview', 'Standard', 'Deep Dive']);
  });

  it('parses chips with two options', () => {
    const message = 'Want to continue? [chips: Yes · No]';
    const result = parseChips(message);

    expect(result.text).toBe('Want to continue?');
    expect(result.chips).toEqual(['Yes', 'No']);
  });

  it('parses chips with four options', () => {
    const message = 'Pick your tone [chips: Casual · Professional · Socratic · Academic]';
    const result = parseChips(message);

    expect(result.text).toBe('Pick your tone');
    expect(result.chips).toEqual(['Casual', 'Professional', 'Socratic', 'Academic']);
  });

  it('returns empty chips array when no chips format is present', () => {
    const message = 'This is a message with no chips.';
    const result = parseChips(message);

    expect(result.text).toBe('This is a message with no chips.');
    expect(result.chips).toEqual([]);
  });

  it('returns empty chips array for empty message', () => {
    const message = '';
    const result = parseChips(message);

    expect(result.text).toBe('');
    expect(result.chips).toEqual([]);
  });

  it('handles chips with single option', () => {
    const message = 'Only one option? [chips: Continue]';
    const result = parseChips(message);

    expect(result.text).toBe('Only one option?');
    expect(result.chips).toEqual(['Continue']);
  });

  it('strips chip format from middle of longer message', () => {
    const message =
      'Let me suggest some options: [chips: Option A · Option B]\n\nWhat do you think?';
    const result = parseChips(message);

    expect(result.text).toBe('Let me suggest some options: \n\nWhat do you think?');
    expect(result.chips).toEqual(['Option A', 'Option B']);
  });
});

describe('parseMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses complete metadata block', () => {
    const message = `Great! I'll create that for you.
[METADATA]
{
  "topic": "Quantum Computing Basics",
  "depth": "standard",
  "audience_level": "beginner",
  "focus_areas": ["qubits", "superposition"],
  "tone": "professional",
  "duration_target": 10,
  "ready": true
}
[/METADATA]`;

    const result = parseMetadata(message);

    expect(result).toEqual({
      topic: 'Quantum Computing Basics',
      depth: 'standard',
      audience_level: 'beginner',
      focus_areas: ['qubits', 'superposition'],
      tone: 'professional',
      duration_target: 10,
      ready: true,
    });
  });

  it('parses metadata with quick_overview depth', () => {
    const message = `[METADATA]
{
  "topic": "AI Ethics",
  "depth": "quick_overview",
  "audience_level": "intermediate",
  "focus_areas": ["bias", "privacy"],
  "tone": "casual",
  "duration_target": 10,
  "ready": true
}
[/METADATA]`;

    const result = parseMetadata(message);

    expect(result?.depth).toBe('quick_overview');
  });

  it('parses metadata with deep_dive depth', () => {
    const message = `[METADATA]
{
  "topic": "Neural Networks",
  "depth": "deep_dive",
  "audience_level": "expert",
  "focus_areas": ["backpropagation", "optimization"],
  "tone": "professional",
  "duration_target": 10,
  "ready": true
}
[/METADATA]`;

    const result = parseMetadata(message);

    expect(result?.depth).toBe('deep_dive');
  });

  it('parses metadata with empty focus_areas', () => {
    const message = `[METADATA]
{
  "topic": "Climate Change",
  "depth": "standard",
  "audience_level": "beginner",
  "focus_areas": [],
  "tone": "professional",
  "duration_target": 10,
  "ready": true
}
[/METADATA]`;

    const result = parseMetadata(message);

    expect(result?.focus_areas).toEqual([]);
  });

  it('parses metadata with socratic tone', () => {
    const message = `[METADATA]
{
  "topic": "Philosophy of Mind",
  "depth": "standard",
  "audience_level": "intermediate",
  "focus_areas": ["consciousness"],
  "tone": "socratic",
  "duration_target": 10,
  "ready": true
}
[/METADATA]`;

    const result = parseMetadata(message);

    expect(result?.tone).toBe('socratic');
  });

  it('returns null when no metadata block is present', () => {
    const message = 'This is just a regular message with no metadata.';
    const result = parseMetadata(message);

    expect(result).toBeNull();
  });

  it('returns null when metadata block contains invalid JSON', () => {
    const message = `[METADATA]
{
  "topic": "Broken JSON",
  "depth": "standard"
  "missing_comma": true
}
[/METADATA]`;

    const result = parseMetadata(message);

    expect(result).toBeNull();
  });

  it('returns null for empty message', () => {
    const message = '';
    const result = parseMetadata(message);

    expect(result).toBeNull();
  });

  it('parses metadata when embedded in longer message', () => {
    const message = `Perfect! Let me summarize what we'll create:

A professional deep dive into quantum computing for experts, focusing on qubits and entanglement.

[METADATA]
{
  "topic": "Quantum Computing",
  "depth": "deep_dive",
  "audience_level": "expert",
  "focus_areas": ["qubits", "entanglement"],
  "tone": "professional",
  "duration_target": 10,
  "ready": true
}
[/METADATA]

Does this sound good?`;

    const result = parseMetadata(message);

    expect(result).toEqual({
      topic: 'Quantum Computing',
      depth: 'deep_dive',
      audience_level: 'expert',
      focus_areas: ['qubits', 'entanglement'],
      tone: 'professional',
      duration_target: 10,
      ready: true,
    });
  });
});

describe('getDiscoveryResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls generateResponse with system prompt and messages', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'What topic are you curious about? [chips: AI · Quantum · Space]',
      inputTokens: 150,
      outputTokens: 80,
    });

    const messages = [{ role: 'user' as const, content: 'I want to learn something' }];

    const result = await getDiscoveryResponse(messages);

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.stringContaining("You are Sotto's podcast discovery agent"),
      messages,
      { maxTokens: 1024 }
    );
    expect(result.content).toContain('What topic are you curious about?');
    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(80);
  });

  it('passes conversation history correctly', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'Great! What depth level? [chips: Quick · Standard · Deep]',
      inputTokens: 200,
      outputTokens: 60,
    });

    const messages = [
      { role: 'user' as const, content: 'I want to learn about AI' },
      { role: 'assistant' as const, content: 'What aspect of AI?' },
      { role: 'user' as const, content: 'Machine learning' },
    ];

    await getDiscoveryResponse(messages);

    expect(mockGenerateResponse).toHaveBeenCalledWith(expect.any(String), messages, {
      maxTokens: 1024,
    });
  });

  it('uses maxTokens: 1024', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'Response',
      inputTokens: 100,
      outputTokens: 50,
    });

    await getDiscoveryResponse([{ role: 'user', content: 'Hello' }]);

    expect(mockGenerateResponse).toHaveBeenCalledWith(expect.any(String), expect.any(Array), {
      maxTokens: 1024,
    });
  });

  it('returns token counts from Claude response', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'Test response',
      inputTokens: 250,
      outputTokens: 120,
    });

    const result = await getDiscoveryResponse([{ role: 'user', content: 'Test' }]);

    expect(result.inputTokens).toBe(250);
    expect(result.outputTokens).toBe(120);
  });
});

describe('streamDiscoveryResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls streamResponse with system prompt and messages', () => {
    const mockAsyncGenerator = (async function* () {
      yield 'chunk1';
      yield 'chunk2';
    })();

    mockStreamResponse.mockReturnValue(mockAsyncGenerator);

    const messages = [{ role: 'user' as const, content: 'Stream me a response' }];

    const result = streamDiscoveryResponse(messages);

    expect(mockStreamResponse).toHaveBeenCalledWith(
      expect.stringContaining("You are Sotto's podcast discovery agent"),
      messages,
      { maxTokens: 1024 }
    );
    expect(result).toBe(mockAsyncGenerator);
  });

  it('uses maxTokens: 1024', () => {
    const mockAsyncGenerator = (async function* () {
      yield 'test';
    })();

    mockStreamResponse.mockReturnValue(mockAsyncGenerator);

    streamDiscoveryResponse([{ role: 'user', content: 'Test' }]);

    expect(mockStreamResponse).toHaveBeenCalledWith(expect.any(String), expect.any(Array), {
      maxTokens: 1024,
    });
  });

  it('passes multi-turn conversation correctly', () => {
    const mockAsyncGenerator = (async function* () {
      yield 'response';
    })();

    mockStreamResponse.mockReturnValue(mockAsyncGenerator);

    const messages = [
      { role: 'user' as const, content: 'First message' },
      { role: 'assistant' as const, content: 'First response' },
      { role: 'user' as const, content: 'Second message' },
    ];

    streamDiscoveryResponse(messages);

    expect(mockStreamResponse).toHaveBeenCalledWith(expect.any(String), messages, {
      maxTokens: 1024,
    });
  });
});
