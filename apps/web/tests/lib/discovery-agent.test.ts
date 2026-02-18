import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();
const mockStreamResponse = vi.fn();

vi.mock('@/lib/claude', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  streamResponse: (...args: unknown[]) => mockStreamResponse(...args),
  WEB_SEARCH_TOOL: { type: 'web_search_20250305', name: 'web_search' },
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
  detectUrls,
  parseChips,
  parseMetadata,
  getDiscoveryResponse,
  streamDiscoveryResponse,
} from '@/lib/discovery-agent';

// ---- Tests ----

describe('detectUrls', () => {
  it('detects https URLs in text', () => {
    const result = detectUrls('Check out https://example.com/article for more');
    expect(result).toEqual(['https://example.com/article']);
  });

  it('detects http URLs in text', () => {
    const result = detectUrls('Visit http://example.com/page');
    expect(result).toEqual(['http://example.com/page']);
  });

  it('detects multiple URLs in one message', () => {
    const result = detectUrls('See https://a.com and https://b.com/path');
    expect(result).toEqual(['https://a.com', 'https://b.com/path']);
  });

  it('returns empty array when no URLs present', () => {
    const result = detectUrls('Just a regular message with no links');
    expect(result).toEqual([]);
  });

  it('does not detect email addresses as URLs', () => {
    const result = detectUrls('Contact me at user@example.com');
    expect(result).toEqual([]);
  });

  it('handles URLs with query params and fragments', () => {
    const result = detectUrls('https://example.com/page?q=test&lang=en#section');
    expect(result).toEqual(['https://example.com/page?q=test&lang=en#section']);
  });

  it('handles URLs at start, middle, and end of text', () => {
    const result = detectUrls(
      'https://start.com is cool, also https://middle.com is great, and https://end.com'
    );
    expect(result).toHaveLength(3);
    expect(result).toContain('https://start.com');
    expect(result).toContain('https://middle.com');
    expect(result).toContain('https://end.com');
  });

  it('deduplicates repeated URLs', () => {
    const result = detectUrls('Visit https://example.com and https://example.com again');
    expect(result).toEqual(['https://example.com']);
  });

  it('returns empty array for undefined input', () => {
    const result = detectUrls(undefined as unknown as string);
    expect(result).toEqual([]);
  });

  it('returns empty array for null input', () => {
    const result = detectUrls(null as unknown as string);
    expect(result).toEqual([]);
  });
});

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

  it('returns response content and token counts', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'What topic are you curious about? [chips: AI · Quantum · Space]',
      inputTokens: 150,
      outputTokens: 80,
    });

    const messages = [{ role: 'user' as const, content: 'I want to learn something' }];

    const result = await getDiscoveryResponse(messages);

    expect(result.content).toContain('What topic are you curious about?');
    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(80);
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

  it('completes successfully when called with a message', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'Response with search',
      inputTokens: 100,
      outputTokens: 50,
    });

    const result = await getDiscoveryResponse([{ role: 'user', content: 'What happened today?' }]);

    expect(result.content).toBe('Response with search');
  });
});

describe('streamDiscoveryResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an async iterable that yields expected chunks', async () => {
    const mockAsyncGenerator = (async function* () {
      yield 'chunk1';
      yield 'chunk2';
    })();

    mockStreamResponse.mockReturnValue(mockAsyncGenerator);

    const messages = [{ role: 'user' as const, content: 'Stream me a response' }];

    const result = streamDiscoveryResponse(messages);

    const chunks: string[] = [];
    for await (const chunk of result) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });
});
