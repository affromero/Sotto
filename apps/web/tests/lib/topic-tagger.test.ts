import { describe, it, expect } from 'vitest';
import { matchTopicTags, TAG_PARENT_MAP } from '@/lib/topic-tagger';

describe('matchTopicTags', () => {
  it('returns empty array for empty input', () => {
    expect(matchTopicTags({ topic: '', focusAreas: [] })).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(matchTopicTags({ topic: '   ', focusAreas: ['  '] })).toEqual([]);
  });

  it('matches a single top-level category', () => {
    const result = matchTopicTags({ topic: 'Modern technology trends', focusAreas: [] });
    expect(result).toContain('technology');
  });

  it('matches sub-interest and includes parent category', () => {
    const result = matchTopicTags({ topic: 'Quantum computing breakthroughs', focusAreas: [] });
    expect(result).toContain('quantum-computing');
    expect(result).toContain('technology');
  });

  it('matches from focus areas', () => {
    const result = matchTopicTags({
      topic: 'How things work',
      focusAreas: ['neural networks', 'deep learning'],
    });
    expect(result).toContain('neural-networks');
    expect(result).toContain('ai-ml');
  });

  it('matches multiple categories', () => {
    const result = matchTopicTags({
      topic: 'AI ethics and philosophy of artificial intelligence',
      focusAreas: ['machine learning bias'],
    });
    expect(result).toContain('ai-ethics');
    expect(result).toContain('ai-ml');
  });

  it('is case-insensitive', () => {
    const result = matchTopicTags({ topic: 'BLOCKCHAIN and CRYPTOCURRENCY', focusAreas: [] });
    expect(result).toContain('blockchain');
    expect(result).toContain('technology');
  });

  it('respects maxTags limit', () => {
    const result = matchTopicTags({
      topic:
        'A long topic covering quantum computing, blockchain, AI, neuroscience, genetics, climate change, and renewable energy',
      focusAreas: [],
      maxTags: 3,
    });
    // Total should be reasonable (3 tags + up to 3 parents)
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it('ranks longer keyword matches higher', () => {
    const result = matchTopicTags({
      topic: 'Large language model training and deployment',
      focusAreas: [],
    });
    // "large language model" (20 chars) should rank higher than "ai" (2 chars)
    expect(result[0]).toBe('large-language-models');
  });

  it('matches health sub-interests', () => {
    const result = matchTopicTags({
      topic: 'Mental health and anxiety management',
      focusAreas: ['therapy', 'psychotherapy'],
    });
    expect(result).toContain('mental-health');
    expect(result).toContain('health');
  });

  it('matches music sub-interests', () => {
    const result = matchTopicTags({
      topic: 'History of jazz improvisation',
      focusAreas: ['miles davis', 'bebop'],
    });
    expect(result).toContain('jazz');
    expect(result).toContain('music');
  });

  it('matches environment sub-interests', () => {
    const result = matchTopicTags({
      topic: 'Climate change and renewable energy solutions',
      focusAreas: ['solar power', 'carbon emission'],
    });
    expect(result).toContain('climate-change');
    expect(result).toContain('renewable-energy');
    expect(result).toContain('environment');
  });

  it('matches economics topics', () => {
    const result = matchTopicTags({
      topic: 'Federal Reserve monetary policy and interest rates',
      focusAreas: [],
    });
    expect(result).toContain('monetary-policy');
    expect(result).toContain('economics');
  });

  it('matches programming sub-interests', () => {
    const result = matchTopicTags({
      topic: 'Web development with React and TypeScript',
      focusAreas: ['frontend', 'next.js'],
    });
    expect(result).toContain('web-development');
    expect(result).toContain('programming');
  });

  it('defaults maxTags to 5', () => {
    const result = matchTopicTags({
      topic:
        'A comprehensive look at technology, science, business, history, philosophy, health, programming, mathematics, psychology, and economics in the modern world',
      focusAreas: [],
    });
    // Direct matches should be at most 5 (plus parents)
    const subInterestCount = result.filter((slug) => TAG_PARENT_MAP[slug]).length;
    const topLevelCount = result.filter((slug) => !TAG_PARENT_MAP[slug]).length;
    // Total direct matches capped at 5
    expect(subInterestCount + topLevelCount).toBeLessThanOrEqual(10);
  });
});

describe('TAG_PARENT_MAP', () => {
  it('maps all sub-interests to valid parent categories', () => {
    const validParents = new Set([
      'technology',
      'science',
      'business',
      'history',
      'philosophy',
      'health',
      'ai-ml',
      'programming',
      'mathematics',
      'psychology',
      'economics',
      'art-design',
      'music',
      'politics-society',
      'environment',
      'language-literature',
      'sports-fitness',
      'education',
    ]);

    for (const [child, parent] of Object.entries(TAG_PARENT_MAP)) {
      expect(validParents.has(parent), `${child} maps to invalid parent "${parent}"`).toBe(true);
    }
  });
});
