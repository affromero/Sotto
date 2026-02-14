import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGenerateResponse = vi.fn();

vi.mock('@/lib/claude', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
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
import { parseTweetIntent } from '@/lib/tweet-parser';
import type { TweetParseResult } from '@/types/twitter';

// ---- Tests ----

describe('parseTweetIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic parsing', () => {
    it('parses a simple topic tweet into TweetParseResult', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Quantum Computing Basics',
        title: 'Introduction to Quantum Computing',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'professional',
        focusAreas: ['qubits', 'superposition'],
        sourceUrl: undefined,
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 100,
        outputTokens: 150,
      });

      const result = await parseTweetIntent(
        '@sottofm explain quantum computing basics'
      );

      expect(result).toEqual(mockResult);
    });

    it('includes parent tweet text when provided', async () => {
      const mockResult: TweetParseResult = {
        topic: 'AI Ethics in Healthcare',
        title: 'Ethical Considerations for AI in Medicine',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        tone: 'professional',
        focusAreas: ['bias', 'privacy'],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 120,
        outputTokens: 180,
      });

      const tweetText = '@sottofm can you elaborate on this?';
      const parentTweetText = 'AI is changing healthcare rapidly';

      const result = await parseTweetIntent(tweetText, parentTweetText);

      expect(result).toEqual(mockResult);
    });
  });

  describe('JSON code fence handling', () => {
    it('handles Claude returning JSON wrapped in code fences', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Blockchain Technology',
        title: 'Blockchain 101',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: ['cryptocurrency', 'smart contracts'],
      };

      mockGenerateResponse.mockResolvedValue({
        content: '```json\n' + JSON.stringify(mockResult) + '\n```',
        inputTokens: 80,
        outputTokens: 120,
      });

      const result = await parseTweetIntent('@sottofm blockchain basics');

      expect(result).toEqual(mockResult);
    });

    it('handles code fences without json language marker', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Machine Learning',
        title: 'ML Fundamentals',
        depth: 'standard',
        audienceLevel: 'intermediate',
        tone: 'professional',
        focusAreas: ['neural networks'],
      };

      mockGenerateResponse.mockResolvedValue({
        content: '```\n' + JSON.stringify(mockResult) + '\n```',
        inputTokens: 90,
        outputTokens: 130,
      });

      const result = await parseTweetIntent('@sottofm machine learning intro');

      expect(result).toEqual(mockResult);
    });

    it('handles JSON with whitespace inside code fences', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Space Exploration',
        title: 'Journey to Mars',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        tone: 'professional',
        focusAreas: ['propulsion', 'life support'],
      };

      mockGenerateResponse.mockResolvedValue({
        content: '```json\n  ' + JSON.stringify(mockResult) + '  \n```',
        inputTokens: 95,
        outputTokens: 140,
      });

      const result = await parseTweetIntent('@sottofm mars mission details');

      expect(result).toEqual(mockResult);
    });
  });

  describe('error handling', () => {
    it('throws on invalid JSON from Claude', async () => {
      mockGenerateResponse.mockResolvedValue({
        content: 'This is not valid JSON { broken',
        inputTokens: 50,
        outputTokens: 10,
      });

      await expect(
        parseTweetIntent('@sottofm some topic')
      ).rejects.toThrow('Failed to parse tweet intent — Claude returned invalid JSON');
    });

    it('throws when topic is missing from parsed result', async () => {
      const invalidResult = {
        title: 'Some Title',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(invalidResult),
        inputTokens: 60,
        outputTokens: 80,
      });

      await expect(
        parseTweetIntent('@sottofm some topic')
      ).rejects.toThrow('Failed to extract topic and title from tweet');
    });

    it('throws when title is missing from parsed result', async () => {
      const invalidResult = {
        topic: 'Some Topic',
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(invalidResult),
        inputTokens: 60,
        outputTokens: 80,
      });

      await expect(
        parseTweetIntent('@sottofm some topic')
      ).rejects.toThrow('Failed to extract topic and title from tweet');
    });

    it('throws when both topic and title are missing', async () => {
      const invalidResult = {
        depth: 'standard',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: [],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(invalidResult),
        inputTokens: 60,
        outputTokens: 80,
      });

      await expect(
        parseTweetIntent('@sottofm some topic')
      ).rejects.toThrow('Failed to extract topic and title from tweet');
    });
  });

  describe('complete parsing scenarios', () => {
    it('parses a tweet with sourceUrl', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Renewable Energy',
        title: 'The Future of Solar Power',
        depth: 'standard',
        audienceLevel: 'intermediate',
        tone: 'professional',
        focusAreas: ['solar panels', 'efficiency'],
        sourceUrl: 'https://example.com/solar-power',
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 110,
        outputTokens: 160,
      });

      const result = await parseTweetIntent(
        '@sottofm https://example.com/solar-power discuss this article'
      );

      expect(result.sourceUrl).toBe('https://example.com/solar-power');
    });

    it('parses a casual tweet with emojis', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Cooking Basics',
        title: 'Easy Cooking Tips for Beginners',
        depth: 'quick_overview',
        audienceLevel: 'beginner',
        tone: 'casual',
        focusAreas: ['knife skills', 'seasoning'],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 85,
        outputTokens: 125,
      });

      const result = await parseTweetIntent(
        '@sottofm teach me cooking basics 🍳👨‍🍳'
      );

      expect(result.tone).toBe('casual');
    });

    it('parses a deep dive expert request', async () => {
      const mockResult: TweetParseResult = {
        topic: 'Quantum Field Theory',
        title: 'Advanced Concepts in QFT',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        tone: 'professional',
        focusAreas: ['renormalization', 'gauge theory', 'symmetry breaking'],
      };

      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify(mockResult),
        inputTokens: 130,
        outputTokens: 200,
      });

      const result = await parseTweetIntent(
        '@sottofm deep dive into quantum field theory renormalization and gauge symmetry breaking'
      );

      expect(result.depth).toBe('deep_dive');
      expect(result.audienceLevel).toBe('expert');
      expect(result.focusAreas).toContain('renormalization');
    });
  });
});
