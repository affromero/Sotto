import { describe, it, expect } from 'vitest';
import {
  buildRenumberMap,
  cleanCitationText,
  cleanAndRenumberCitations,
  cleanAndRenumberMarkdown,
} from '@/lib/script-updater';

describe('buildRenumberMap', () => {
  it('creates contiguous numbering after removals', () => {
    const map = buildRenumberMap([1, 2, 3, 4, 5], new Set([2, 4]));
    expect(map.get(1)).toBe(1);
    expect(map.get(3)).toBe(2);
    expect(map.get(5)).toBe(3);
    expect(map.has(2)).toBe(false);
    expect(map.has(4)).toBe(false);
  });

  it('returns identity map when nothing is removed', () => {
    const map = buildRenumberMap([1, 2, 3], new Set());
    expect(map.get(1)).toBe(1);
    expect(map.get(2)).toBe(2);
    expect(map.get(3)).toBe(3);
  });

  it('handles removing all references', () => {
    const map = buildRenumberMap([1, 2, 3], new Set([1, 2, 3]));
    expect(map.size).toBe(0);
  });

  it('handles removing the first reference', () => {
    const map = buildRenumberMap([1, 2, 3], new Set([1]));
    expect(map.get(2)).toBe(1);
    expect(map.get(3)).toBe(2);
  });

  it('handles removing the last reference', () => {
    const map = buildRenumberMap([1, 2, 3], new Set([3]));
    expect(map.get(1)).toBe(1);
    expect(map.get(2)).toBe(2);
  });

  it('handles non-contiguous input numbers', () => {
    const map = buildRenumberMap([1, 3, 5, 7], new Set([3]));
    expect(map.get(1)).toBe(1);
    expect(map.get(5)).toBe(2);
    expect(map.get(7)).toBe(3);
  });
});

describe('cleanCitationText', () => {
  const removed = new Set([2, 4]);
  const renumberMap = new Map([[1, 1], [3, 2], [5, 3]]);

  it('removes single dangling citation', () => {
    const result = cleanCitationText('See this study [2] for more.', removed, renumberMap);
    expect(result).toBe('See this study for more.');
  });

  it('renumbers single citation', () => {
    const result = cleanCitationText('According to [3], this is true.', removed, renumberMap);
    expect(result).toBe('According to [2], this is true.');
  });

  it('keeps citation that is not removed', () => {
    const result = cleanCitationText('See [1] for details.', removed, renumberMap);
    expect(result).toBe('See [1] for details.');
  });

  it('handles grouped citations with removals', () => {
    const result = cleanCitationText('Studies [1,2,3] show that...', removed, renumberMap);
    expect(result).toBe('Studies [1,2] show that...');
  });

  it('handles grouped citations where all are removed', () => {
    const result = cleanCitationText('Studies [2,4] show that...', removed, renumberMap);
    expect(result).toBe('Studies show that...');
  });

  it('handles grouped citations with spaces', () => {
    const result = cleanCitationText('Studies [1, 3, 5] confirm...', removed, renumberMap);
    expect(result).toBe('Studies [1,2,3] confirm...');
  });

  it('cleans up double spaces after removal', () => {
    const result = cleanCitationText('One [2] two', removed, renumberMap);
    expect(result).toBe('One two');
  });

  it('cleans up space before punctuation after removal', () => {
    const result = cleanCitationText('Results [2]. Next sentence.', removed, renumberMap);
    expect(result).toBe('Results. Next sentence.');
  });

  it('handles text with no citations', () => {
    const result = cleanCitationText('No citations here.', removed, renumberMap);
    expect(result).toBe('No citations here.');
  });

  it('handles multiple citations in one text', () => {
    const result = cleanCitationText('See [1] and [3] and [5].', removed, renumberMap);
    expect(result).toBe('See [1] and [2] and [3].');
  });

  it('handles adjacent citations', () => {
    const result = cleanCitationText('See [1][3][5] for details.', removed, renumberMap);
    expect(result).toBe('See [1][2][3] for details.');
  });
});

describe('cleanAndRenumberCitations', () => {
  it('updates text in all turns', () => {
    const turns = [
      { speaker: 'HOST' as const, text: 'Study [1] shows...' },
      { speaker: 'EXPERT' as const, text: 'And [2] confirms [3].' },
    ];

    const removed = new Set([2]);
    const renumberMap = new Map([[1, 1], [3, 2]]);

    const result = cleanAndRenumberCitations(turns, removed, renumberMap);

    expect(result[0].text).toBe('Study [1] shows...');
    expect(result[1].text).toBe('And confirms [2].');
    expect(result[0].speaker).toBe('HOST');
    expect(result[1].speaker).toBe('EXPERT');
  });

  it('preserves direction field', () => {
    const turns = [
      { speaker: 'HOST' as const, text: 'Ref [1]', direction: 'excited' },
    ];

    const result = cleanAndRenumberCitations(turns, new Set(), new Map([[1, 1]]));
    expect(result[0].direction).toBe('excited');
  });
});

describe('cleanAndRenumberMarkdown', () => {
  it('cleans citations in markdown text', () => {
    const markdown = '# Title\n\nSee [1] and [2] and [3].\n\n## Section\n\nMore [4] refs [5].';
    const removed = new Set([2, 4]);
    const renumberMap = new Map([[1, 1], [3, 2], [5, 3]]);

    const result = cleanAndRenumberMarkdown(markdown, removed, renumberMap);
    expect(result).toBe('# Title\n\nSee [1] and and [2].\n\n## Section\n\nMore refs [3].');
  });
});
