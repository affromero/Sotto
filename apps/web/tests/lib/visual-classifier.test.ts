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
  { segmentId: 'seg-1', order: 0, speaker: 'Host', text: 'Welcome to our episode about AI.', duration: 5 },
  { segmentId: 'seg-2', order: 1, speaker: 'Expert', text: 'In 2023, AI saw a 300% increase in adoption.', duration: 8 },
  { segmentId: 'seg-3', order: 2, speaker: 'Host', text: 'As Einstein once said, imagination is more important than knowledge.', duration: 6 },
];

const AI_RUNTIME = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('classifySegmentVisuals', () => {
  it('returns classifications with subVisuals for all segments', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          { order: 0, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'AI_ILLUSTRATION', prompt: 'Editorial illustration of AI robot', metadata: null, endStatePrompt: 'AI robot in a futuristic city at dusk' }] },
          { order: 1, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'DATA_CHART', prompt: null, metadata: '{"chartType":"bar","data":[{"label":"2023","value":300}],"title":"AI Adoption"}', endStatePrompt: null }] },
          { order: 2, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'QUOTE', prompt: null, metadata: '{"quoteText":"Imagination is more important than knowledge","quoteAuthor":"Einstein"}', endStatePrompt: null }] },
        ],
      }),
      inputTokens: 100,
      outputTokens: 200,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'AI Revolution', 'How AI is changing the world', AI_RUNTIME);

    expect(result.classifications).toHaveLength(3);
    expect(result.classifications[0].subVisuals).toHaveLength(1);
    expect(result.classifications[0].subVisuals[0].visualType).toBe('AI_ILLUSTRATION');
    expect(result.classifications[0].segmentId).toBe('seg-1');
    expect(result.classifications[1].subVisuals[0].visualType).toBe('DATA_CHART');
    expect(result.classifications[1].subVisuals[0].metadata).toEqual(expect.objectContaining({ chartType: 'bar' }));
    expect(result.classifications[2].subVisuals[0].visualType).toBe('QUOTE');
    expect(result.classifications[0].subVisuals[0].endStatePrompt).toBe('AI robot in a futuristic city at dusk');
    expect(result.classifications[1].subVisuals[0].endStatePrompt).toBeNull();
  });

  it('supports multiple sub-visuals per segment', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          {
            order: 0,
            subVisuals: [
              { subOrder: 0, startOffsetFraction: 0, durationFraction: 0.4, visualType: 'TEXT_CARD', prompt: null, metadata: '{"headline":"AI Revolution"}', endStatePrompt: null },
              { subOrder: 1, startOffsetFraction: 0.4, durationFraction: 0.6, visualType: 'AI_ILLUSTRATION', prompt: 'Futuristic AI lab', metadata: null, endStatePrompt: 'Lab at sunset' },
            ],
          },
          { order: 1, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'DATA_CHART', prompt: null, metadata: null, endStatePrompt: null }] },
          { order: 2, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'QUOTE', prompt: null, metadata: null, endStatePrompt: null }] },
        ],
      }),
      inputTokens: 100,
      outputTokens: 200,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'AI Revolution', 'AI topic', AI_RUNTIME);

    expect(result.classifications[0].subVisuals).toHaveLength(2);
    expect(result.classifications[0].subVisuals[0].visualType).toBe('TEXT_CARD');
    expect(result.classifications[0].subVisuals[0].durationFraction).toBe(0.4);
    expect(result.classifications[0].subVisuals[1].visualType).toBe('AI_ILLUSTRATION');
    expect(result.classifications[0].subVisuals[1].startOffsetFraction).toBe(0.4);
    expect(result.classifications[0].subVisuals[1].durationFraction).toBe(0.6);
  });

  it('wraps legacy flat format as single sub-visual', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          { order: 0, visualType: 'AI_ILLUSTRATION', prompt: 'Illustration of AI', metadata: null, endStatePrompt: 'Scene after' },
          { order: 1, visualType: 'TEXT_CARD', prompt: null, metadata: '{"headline":"Stats"}', endStatePrompt: null },
          { order: 2, visualType: 'QUOTE', prompt: null, metadata: '{"quoteText":"Test","quoteAuthor":"Author"}', endStatePrompt: null },
        ],
      }),
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'AI Episode', 'AI topic', AI_RUNTIME);

    expect(result.classifications).toHaveLength(3);
    // Each legacy item should be wrapped as a single sub-visual
    for (const c of result.classifications) {
      expect(c.subVisuals).toHaveLength(1);
      expect(c.subVisuals[0].subOrder).toBe(0);
      expect(c.subVisuals[0].startOffsetFraction).toBe(0);
      expect(c.subVisuals[0].durationFraction).toBe(1);
    }
    expect(result.classifications[0].subVisuals[0].visualType).toBe('AI_ILLUSTRATION');
    expect(result.classifications[0].subVisuals[0].endStatePrompt).toBe('Scene after');
  });

  it('accepts DATA_TABLE as a valid visual type with metadata', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          { order: 0, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'DATA_TABLE', prompt: null, metadata: '{"headers":{"title":"AI Adoption by Year"},"columns":[{"key":"year","label":"Year"},{"key":"rate","label":"Adoption Rate","isNumeric":true}],"rows":[{"key":"r1","values":{"year":"2022","rate":45}},{"key":"r2","values":{"year":"2023","rate":78}}]}', endStatePrompt: null }] },
          { order: 1, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'TEXT_CARD', prompt: null, metadata: null, endStatePrompt: null }] },
          { order: 2, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'TEXT_CARD', prompt: null, metadata: null, endStatePrompt: null }] },
        ],
      }),
      inputTokens: 100,
      outputTokens: 200,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'AI Stats', 'AI adoption data', AI_RUNTIME);

    expect(result.classifications).toHaveLength(3);
    expect(result.classifications[0].subVisuals[0].visualType).toBe('DATA_TABLE');
    expect(result.classifications[0].subVisuals[0].metadata).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ title: 'AI Adoption by Year' }),
      columns: expect.arrayContaining([expect.objectContaining({ key: 'year' })]),
      rows: expect.arrayContaining([expect.objectContaining({ key: 'r1' })]),
    }));
  });

  it('fills missing segments with TEXT_CARD fallback sub-visual', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          { order: 0, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'AI_ILLUSTRATION', prompt: 'Illustration of AI', metadata: null, endStatePrompt: null }] },
        ],
      }),
      inputTokens: 100,
      outputTokens: 50,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'AI Episode', 'AI topic', AI_RUNTIME);

    expect(result.classifications).toHaveLength(3);
    expect(result.classifications[1].subVisuals[0].visualType).toBe('TEXT_CARD');
    expect(result.classifications[1].subVisuals[0].endStatePrompt).toBeNull();
    expect(result.classifications[2].subVisuals[0].visualType).toBe('TEXT_CARD');
  });

  it('falls back to TEXT_CARD sub-visuals on parse error', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'This is not valid JSON',
      inputTokens: 100,
      outputTokens: 10,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'AI Episode', 'AI topic', AI_RUNTIME);

    expect(result.classifications).toHaveLength(3);
    expect(result.classifications.every((c) => c.subVisuals[0].visualType === 'TEXT_CARD')).toBe(true);
    expect(result.classifications.every((c) => c.subVisuals.length === 1)).toBe(true);
  });

  it('normalizes sub-visual fractions that do not sum to 1.0', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          {
            order: 0,
            subVisuals: [
              { subOrder: 0, startOffsetFraction: 0, durationFraction: 0.3, visualType: 'TEXT_CARD', prompt: null, metadata: null, endStatePrompt: null },
              { subOrder: 1, startOffsetFraction: 0.3, durationFraction: 0.3, visualType: 'AI_ILLUSTRATION', prompt: 'test', metadata: null, endStatePrompt: null },
              // Fractions sum to 0.6, not 1.0
            ],
          },
          { order: 1, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'TEXT_CARD', prompt: null, metadata: null, endStatePrompt: null }] },
          { order: 2, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'TEXT_CARD', prompt: null, metadata: null, endStatePrompt: null }] },
        ],
      }),
      inputTokens: 100,
      outputTokens: 100,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'Test', 'Test', AI_RUNTIME);

    // Fractions should be normalized to sum to 1.0
    const subVisuals = result.classifications[0].subVisuals;
    const sum = subVisuals.reduce((s, sv) => s + sv.durationFraction, 0);
    expect(sum).toBeCloseTo(1.0, 2);
    expect(subVisuals[0].startOffsetFraction).toBe(0);
    expect(subVisuals[1].startOffsetFraction).toBeCloseTo(0.5, 2);
  });

  it('calls AI with correct options', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({ segments: [] }),
      inputTokens: 50,
      outputTokens: 20,
      model: 'claude-haiku-4-5-20251001',
    });

    await classifySegmentVisuals(SEGMENTS, 'Test', 'Test', AI_RUNTIME);

    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        skipModeration: true,
        maxTokens: 8192,
      }),
    );
  });

  it('returns sorted classifications by order', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        segments: [
          { order: 2, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'QUOTE', prompt: null, metadata: null, endStatePrompt: null }] },
          { order: 0, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'TEXT_CARD', prompt: null, metadata: null, endStatePrompt: null }] },
          { order: 1, subVisuals: [{ subOrder: 0, startOffsetFraction: 0, durationFraction: 1, visualType: 'AI_ILLUSTRATION', prompt: 'test', metadata: null, endStatePrompt: 'finished scene' }] },
        ],
      }),
      inputTokens: 100,
      outputTokens: 100,
      model: 'claude-haiku-4-5-20251001',
    });

    const result = await classifySegmentVisuals(SEGMENTS, 'Test', 'Test', AI_RUNTIME);

    expect(result.classifications[0].order).toBe(0);
    expect(result.classifications[1].order).toBe(1);
    expect(result.classifications[2].order).toBe(2);
  });
});
