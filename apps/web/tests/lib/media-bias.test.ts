import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeDomain,
  extractDomain,
  lookupMediaBias,
  analyzeBias,
  _resetForTesting,
} from '@/lib/media-bias';

describe('media-bias', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe('normalizeDomain', () => {
    it('lowercases domain', () => {
      expect(normalizeDomain('FoxNews.COM')).toBe('foxnews.com');
    });

    it('strips www. prefix', () => {
      expect(normalizeDomain('www.nytimes.com')).toBe('nytimes.com');
    });

    it('strips trailing slashes', () => {
      expect(normalizeDomain('reuters.com/')).toBe('reuters.com');
    });

    it('handles combined normalizations', () => {
      expect(normalizeDomain('WWW.BBC.com///')).toBe('bbc.com');
    });
  });

  describe('extractDomain', () => {
    it('extracts domain from full URL', () => {
      expect(extractDomain('https://www.foxnews.com/politics/article')).toBe('foxnews.com');
    });

    it('handles URLs without www', () => {
      expect(extractDomain('https://reuters.com/world/news')).toBe('reuters.com');
    });

    it('throws on invalid URL', () => {
      expect(() => extractDomain('not-a-url')).toThrow();
    });
  });

  describe('lookupMediaBias', () => {
    it('finds Daily Wire (right bias)', () => {
      const entry = lookupMediaBias('dailywire.com');
      expect(entry).not.toBeNull();
      expect(entry!.bias).toBe('right');
      expect(entry!.name).toContain('Daily Wire');
    });

    it('finds NPR (left-center bias)', () => {
      const entry = lookupMediaBias('npr.org');
      expect(entry).not.toBeNull();
      expect(entry!.bias).toBe('left-center');
    });

    it('finds Reuters (center)', () => {
      const entry = lookupMediaBias('reuters.com');
      expect(entry).not.toBeNull();
      expect(entry!.bias).toBe('center');
    });

    it('finds BBC via alias (bbc.co.uk → bbc.com)', () => {
      const entry = lookupMediaBias('bbc.co.uk');
      expect(entry).not.toBeNull();
      expect(entry!.name).toContain('BBC');
    });

    it('normalizes www prefix for lookup', () => {
      const entry = lookupMediaBias('www.wsj.com');
      expect(entry).not.toBeNull();
      expect(entry!.bias).toBe('right-center');
    });

    it('returns null for unknown domain', () => {
      const entry = lookupMediaBias('my-random-blog-12345.com');
      expect(entry).toBeNull();
    });
  });

  describe('analyzeBias', () => {
    it('detects political topic with known biased source', () => {
      const result = analyzeBias({
        sourceUrl: 'https://dailywire.com/news/2024-election',
        topic: 'US immigration policy debate',
        focusAreas: ['border security', 'immigration reform'],
      });

      expect(result.isPolitical).toBe(true);
      expect(result.sourceBias).toBe('right');
      expect(result.sourceName).toContain('Daily Wire');
      expect(result.sourceFactuality).toBeDefined();
    });

    it('detects non-political topic', () => {
      const result = analyzeBias({
        sourceUrl: 'https://nature.com/articles/quantum-computing',
        topic: 'Quantum computing breakthroughs in 2024',
        focusAreas: ['qubits', 'error correction'],
      });

      expect(result.isPolitical).toBe(false);
    });

    it('returns null bias for unknown source', () => {
      const result = analyzeBias({
        sourceUrl: 'https://unknownsite12345.com/article',
        topic: 'Government policy on immigration',
        focusAreas: ['immigration'],
      });

      expect(result.isPolitical).toBe(true);
      expect(result.sourceBias).toBeNull();
      expect(result.sourceName).toBeNull();
    });

    it('handles invalid URL gracefully', () => {
      const result = analyzeBias({
        sourceUrl: 'not-a-valid-url',
        topic: 'Political debate',
        focusAreas: ['politics'],
      });

      expect(result.sourceBias).toBeNull();
      expect(result.sourceName).toBeNull();
    });

    it('detects geopolitics as political', () => {
      const result = analyzeBias({
        sourceUrl: 'https://reuters.com/world',
        topic: 'NATO expansion and geopolitical tensions',
        focusAreas: ['international relations', 'diplomacy'],
      });

      expect(result.isPolitical).toBe(true);
      expect(result.sourceBias).toBe('center');
    });

    it('detects human rights as political', () => {
      const result = analyzeBias({
        sourceUrl: 'https://reuters.com/world',
        topic: 'Civil rights movements and human rights',
        focusAreas: ['equality', 'discrimination'],
      });

      expect(result.isPolitical).toBe(true);
    });

    it('does not flag pure science as political', () => {
      const result = analyzeBias({
        sourceUrl: 'https://nature.com/articles/neuroscience',
        topic: 'Neuroscience of memory formation',
        focusAreas: ['brain', 'neural pathways'],
      });

      expect(result.isPolitical).toBe(false);
    });
  });
});
