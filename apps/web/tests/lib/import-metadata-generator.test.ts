import { describe, it, expect } from 'vitest';
import { isMetadataDifferent } from '@/lib/import-metadata-generator';

describe('isMetadataDifferent', () => {
  it('returns false for identical strings', () => {
    expect(isMetadataDifferent('My Podcast', 'My Podcast')).toBe(false);
  });

  it('returns false for case-insensitive matches', () => {
    expect(isMetadataDifferent('My Podcast Title', 'my podcast title')).toBe(false);
  });

  it('returns false when punctuation is the only difference', () => {
    expect(isMetadataDifferent('My Podcast!', 'My Podcast')).toBe(false);
  });

  it('returns false when user value contains AI value (substring)', () => {
    expect(
      isMetadataDifferent(
        'Deep Dive: Quantum Computing Explained',
        'Quantum Computing Explained'
      )
    ).toBe(false);
  });

  it('returns false when AI value contains user value (substring)', () => {
    expect(
      isMetadataDifferent(
        'Quantum Computing',
        'Quantum Computing: A Deep Dive into Modern Physics'
      )
    ).toBe(false);
  });

  it('returns false when AI value is too short (< 10 chars)', () => {
    expect(isMetadataDifferent('My Great Podcast', 'Short')).toBe(false);
  });

  it('returns false when user value is "Untitled Import"', () => {
    expect(
      isMetadataDifferent('Untitled Import', 'A Fascinating Discussion About AI')
    ).toBe(false);
  });

  it('returns false when user value is empty', () => {
    expect(isMetadataDifferent('', 'A Fascinating Discussion About AI')).toBe(false);
  });

  it('returns true for meaningfully different values', () => {
    expect(
      isMetadataDifferent(
        'Episode 42',
        'The Future of Renewable Energy: Solar and Wind Power Innovations'
      )
    ).toBe(true);
  });

  it('returns true when both values are substantial but different', () => {
    expect(
      isMetadataDifferent(
        'Tech Talk with Bob',
        'Understanding Machine Learning Algorithms in Practice'
      )
    ).toBe(true);
  });
});
