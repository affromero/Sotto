import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { classifySegmentVisuals, type SegmentInput } from '@/lib/visual-classifier';

const SEGMENTS: SegmentInput[] = [
  { segmentId: 'seg-1', order: 0, speaker: 'Host', text: 'Welcome to our podcast about AI.', duration: 5 },
  { segmentId: 'seg-2', order: 1, speaker: 'Expert', text: 'In 2023, AI saw a 300% increase in adoption.', duration: 8 },
  { segmentId: 'seg-3', order: 2, speaker: 'Host', text: 'As Einstein once said, imagination is more important than knowledge.', duration: 6 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('classifySegmentVisuals', () => {
  it('returns classifications for all segments', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          { order: 0, visualType: 'AI_ILLUSTRATION', prompt: 'Editorial illustration of AI robot', metadata: null },
          { order: 1, visualType: 'DATA_CHART', prompt: null, metadata: { chartType: 'bar', data: [{ label: '2023', value: 300 }], title: 'AI Adoption' } },
          { order: 2, visualType: 'QUOTE', prompt: null, metadata: { quoteText: 'Imagination is more important than knowledge', quoteAuthor: 'Einstein' } },
        ],
      }),
      inputTokens: 100,
      outputTokens: 200,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'AI Revolution', 'How AI is changing the world');

    expect(result.classifications).toHaveLength(3);
    expect(result.classifications[0].visualType).toBe('AI_ILLUSTRATION');
    expect(result.classifications[0].segmentId).toBe('seg-1');
    expect(result.classifications[1].visualType).toBe('DATA_CHART');
    expect(result.classifications[1].metadata).toEqual(expect.objectContaining({ chartType: 'bar' }));
    expect(result.classifications[2].visualType).toBe('QUOTE');
  });

  it('fills missing segments with TEXT_CARD fallback', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          { order: 0, visualType: 'AI_ILLUSTRATION', prompt: 'Illustration of AI', metadata: null },
          // segments 1 and 2 missing
        ],
      }),
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'AI Podcast', 'AI topic');

    expect(result.classifications).toHaveLength(3);
    expect(result.classifications[1].visualType).toBe('TEXT_CARD');
    expect(result.classifications[2].visualType).toBe('TEXT_CARD');
  });

  it('falls back to TEXT_CARD for all segments on parse error', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'This is not valid JSON',
      inputTokens: 100,
      outputTokens: 10,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'AI Podcast', 'AI topic');

    expect(result.classifications).toHaveLength(3);
    expect(result.classifications.every((c) => c.visualType === 'TEXT_CARD')).toBe(true);
  });

  it('calls Claude with haiku model and skips moderation', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({ segments: [] }),
      inputTokens: 50,
      outputTokens: 20,
      model: 'claude-haiku-4-5-20251001',
    });

    await classifySegmentVisuals(SEGMENTS, 'Test', 'Test');

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        skipModeration: true,
        maxTokens: 4096,
      }),
    );
  });

  it('returns sorted classifications by order', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          { order: 2, visualType: 'QUOTE', prompt: null, metadata: null },
          { order: 0, visualType: 'TEXT_CARD', prompt: null, metadata: null },
          { order: 1, visualType: 'AI_ILLUSTRATION', prompt: 'test', metadata: null },
        ],
      }),
      inputTokens: 100,
      outputTokens: 100,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'Test', 'Test');

    expect(result.classifications[0].order).toBe(0);
    expect(result.classifications[1].order).toBe(1);
    expect(result.classifications[2].order).toBe(2);
  });
});
