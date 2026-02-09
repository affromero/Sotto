import { describe, it, expect } from 'vitest';
import {
  buildRenumberMap,
  cleanCitationText,
  cleanAndRenumberCitations,
  cleanAndRenumberMarkdown,
} from '@/lib/script-updater';

describe('script-updater', () => {
  describe('buildRenumberMap', () => {
    it('builds a renumber map when removing middle references', () => {
      const allNumbers = [1, 2, 3, 4, 5];
      const removedNumbers = new Set([2, 4]);

      const map = buildRenumberMap(allNumbers, removedNumbers);

      expect(map.get(1)).toBe(1);
      expect(map.get(3)).toBe(2);
      expect(map.get(5)).toBe(3);
      expect(map.has(2)).toBe(false);
      expect(map.has(4)).toBe(false);
    });

    it('builds a renumber map when removing first reference', () => {
      const allNumbers = [1, 2, 3, 4];
      const removedNumbers = new Set([1]);

      const map = buildRenumberMap(allNumbers, removedNumbers);

      expect(map.get(2)).toBe(1);
      expect(map.get(3)).toBe(2);
      expect(map.get(4)).toBe(3);
      expect(map.has(1)).toBe(false);
    });

    it('builds a renumber map when removing last reference', () => {
      const allNumbers = [1, 2, 3, 4];
      const removedNumbers = new Set([4]);

      const map = buildRenumberMap(allNumbers, removedNumbers);

      expect(map.get(1)).toBe(1);
      expect(map.get(2)).toBe(2);
      expect(map.get(3)).toBe(3);
      expect(map.has(4)).toBe(false);
    });

    it('builds a renumber map when removing consecutive references', () => {
      const allNumbers = [1, 2, 3, 4, 5, 6];
      const removedNumbers = new Set([2, 3, 4]);

      const map = buildRenumberMap(allNumbers, removedNumbers);

      expect(map.get(1)).toBe(1);
      expect(map.get(5)).toBe(2);
      expect(map.get(6)).toBe(3);
    });

    it('returns empty map when all references are removed', () => {
      const allNumbers = [1, 2, 3];
      const removedNumbers = new Set([1, 2, 3]);

      const map = buildRenumberMap(allNumbers, removedNumbers);

      expect(map.size).toBe(0);
    });

    it('returns identity map when no references are removed', () => {
      const allNumbers = [1, 2, 3, 4];
      const removedNumbers = new Set<number>();

      const map = buildRenumberMap(allNumbers, removedNumbers);

      expect(map.get(1)).toBe(1);
      expect(map.get(2)).toBe(2);
      expect(map.get(3)).toBe(3);
      expect(map.get(4)).toBe(4);
    });

    it('handles unsorted input numbers', () => {
      const allNumbers = [3, 1, 4, 2, 5];
      const removedNumbers = new Set([2, 4]);

      const map = buildRenumberMap(allNumbers, removedNumbers);

      expect(map.get(1)).toBe(1);
      expect(map.get(3)).toBe(2);
      expect(map.get(5)).toBe(3);
    });

    it('handles non-contiguous input numbers', () => {
      const allNumbers = [1, 3, 5, 7, 9];
      const removedNumbers = new Set([3, 7]);

      const map = buildRenumberMap(allNumbers, removedNumbers);

      expect(map.get(1)).toBe(1);
      expect(map.get(5)).toBe(2);
      expect(map.get(9)).toBe(3);
    });

    it('handles removing only one reference from many', () => {
      const allNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
      const removedNumbers = new Set([5]);

      const map = buildRenumberMap(allNumbers, removedNumbers);

      expect(map.get(1)).toBe(1);
      expect(map.get(4)).toBe(4);
      expect(map.get(6)).toBe(5);
      expect(map.get(8)).toBe(7);
    });
  });

  describe('cleanCitationText', () => {
    it('removes single citation markers for removed references', () => {
      const text = 'This is a fact [2] that is true.';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
      ]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('This is a fact that is true.');
    });

    it('renumbers remaining single citations', () => {
      const text = 'First fact [1] and second fact [3] and third fact [5].';
      const removedNumbers = new Set([2, 4]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
        [5, 3],
      ]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('First fact [1] and second fact [2] and third fact [3].');
    });

    it('handles grouped citations with commas', () => {
      const text = 'Multiple sources [1,2,3] confirm this.';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
      ]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('Multiple sources [1,2] confirm this.');
    });

    it('handles grouped citations with spaces', () => {
      const text = 'Multiple sources [1, 2, 3, 4] confirm this.';
      const removedNumbers = new Set([2, 4]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
      ]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('Multiple sources [1,2] confirm this.');
    });

    it('removes entire grouped citation if all numbers are removed', () => {
      const text = 'Invalid sources [2,4] should be removed.';
      const removedNumbers = new Set([2, 4]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
        [5, 3],
      ]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('Invalid sources should be removed.');
    });

    it('handles adjacent citations', () => {
      const text = 'Back to back [1][2][3] citations.';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
      ]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('Back to back [1][2] citations.');
    });

    it('cleans up double spaces left by removed citations', () => {
      const text = 'Text [2] with  extra spaces.';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map();

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('Text with extra spaces.');
    });

    it('cleans up space before punctuation', () => {
      const text = 'End of sentence [2] .';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map();

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('End of sentence.');
    });

    it('cleans up trailing spaces at line ends', () => {
      const text = 'Line with citation [2]  \nNext line';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map();

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('Line with citation\nNext line');
    });

    it('preserves text without citations', () => {
      const text = 'This text has no citations at all.';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
      ]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('This text has no citations at all.');
    });

    it('handles multiple citation types in one text', () => {
      const text = 'Single [1] grouped [2,3] and adjacent [4][5] citations.';
      const removedNumbers = new Set([2, 4]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
        [5, 3],
      ]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('Single [1] grouped [2] and adjacent [3] citations.');
    });

    it('handles empty text', () => {
      const text = '';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([[1, 1]]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('');
    });

    it('handles complex mixed citation patterns', () => {
      const text = 'Studies [1,2,3] and [4] show that [5][6] is valid.';
      const removedNumbers = new Set([2, 4, 6]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
        [5, 3],
      ]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('Studies [1,2] and show that [3] is valid.');
    });

    it('preserves punctuation after citations', () => {
      const text = 'See study [1], and also [2].';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([[1, 1]]);

      const result = cleanCitationText(text, removedNumbers, renumberMap);

      expect(result).toBe('See study [1], and also.');
    });
  });

  describe('cleanAndRenumberCitations', () => {
    it('cleans and renumbers citations across multiple script turns', () => {
      const turns = [
        { speaker: 'HOST' as const, text: 'First fact [1] here.' },
        { speaker: 'EXPERT' as const, text: 'Second fact [2] and third [3].' },
        { speaker: 'HOST' as const, text: 'More info [4] available.' },
      ];
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
        [4, 3],
      ]);

      const result = cleanAndRenumberCitations(turns, removedNumbers, renumberMap);

      expect(result).toEqual([
        { speaker: 'HOST', text: 'First fact [1] here.' },
        { speaker: 'EXPERT', text: 'Second fact and third [2].' },
        { speaker: 'HOST', text: 'More info [3] available.' },
      ]);
    });

    it('preserves turn metadata including direction', () => {
      const turns = [
        { speaker: 'HOST' as const, text: 'Fact [1].', direction: 'question' },
        { speaker: 'EXPERT' as const, text: 'Answer [2].', direction: 'explanation' },
      ];
      const removedNumbers = new Set([1]);
      const renumberMap = new Map([[2, 1]]);

      const result = cleanAndRenumberCitations(turns, removedNumbers, renumberMap);

      expect(result[0]).toEqual({ speaker: 'HOST', text: 'Fact.', direction: 'question' });
      expect(result[1]).toEqual({
        speaker: 'EXPERT',
        text: 'Answer [1].',
        direction: 'explanation',
      });
    });

    it('handles empty turns array', () => {
      const turns: Array<{ speaker: 'HOST' | 'EXPERT'; text: string }> = [];
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([[1, 1]]);

      const result = cleanAndRenumberCitations(turns, removedNumbers, renumberMap);

      expect(result).toEqual([]);
    });

    it('handles turns with no citations', () => {
      const turns = [
        { speaker: 'HOST' as const, text: 'No citations here.' },
        { speaker: 'EXPERT' as const, text: 'None here either.' },
      ];
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
      ]);

      const result = cleanAndRenumberCitations(turns, removedNumbers, renumberMap);

      expect(result).toEqual([
        { speaker: 'HOST', text: 'No citations here.' },
        { speaker: 'EXPERT', text: 'None here either.' },
      ]);
    });

    it('handles all citations being removed from all turns', () => {
      const turns = [
        { speaker: 'HOST' as const, text: 'Study [1] says.' },
        { speaker: 'EXPERT' as const, text: 'And [2] confirms.' },
      ];
      const removedNumbers = new Set([1, 2]);
      const renumberMap = new Map();

      const result = cleanAndRenumberCitations(turns, removedNumbers, renumberMap);

      expect(result[0].text).toBe('Study says.');
      expect(result[1].text).toBe('And confirms.');
    });

    it('preserves all turn properties except text', () => {
      const turns = [
        { speaker: 'HOST' as const, text: 'Ref [1]', direction: 'excited', custom: 'value' },
      ];
      const removedNumbers = new Set<number>();
      const renumberMap = new Map([[1, 1]]);

      const result = cleanAndRenumberCitations(turns, removedNumbers, renumberMap);

      expect(result[0]).toHaveProperty('speaker', 'HOST');
      expect(result[0]).toHaveProperty('text', 'Ref [1]');
      expect(result[0]).toHaveProperty('direction', 'excited');
      expect(result[0]).toHaveProperty('custom', 'value');
    });
  });

  describe('cleanAndRenumberMarkdown', () => {
    it('cleans and renumbers citations in markdown text', () => {
      const markdown = '# Heading\n\nParagraph with [1] citation.\n\nAnother with [2] and [3].';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
      ]);

      const result = cleanAndRenumberMarkdown(markdown, removedNumbers, renumberMap);

      expect(result).toBe('# Heading\n\nParagraph with [1] citation.\n\nAnother with and [2].');
    });

    it('preserves markdown formatting', () => {
      const markdown = '**Bold [1]** and *italic [2]* text.';
      const removedNumbers = new Set([1]);
      const renumberMap = new Map([[2, 1]]);

      const result = cleanAndRenumberMarkdown(markdown, removedNumbers, renumberMap);

      expect(result).toBe('**Bold ** and *italic [1]* text.');
    });

    it('handles multiline markdown with citations', () => {
      const markdown = 'Line 1 [1]\nLine 2 [2]\nLine 3 [3]';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
      ]);

      const result = cleanAndRenumberMarkdown(markdown, removedNumbers, renumberMap);

      expect(result).toBe('Line 1 [1]\nLine 2\nLine 3 [2]');
    });

    it('handles empty markdown', () => {
      const markdown = '';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([[1, 1]]);

      const result = cleanAndRenumberMarkdown(markdown, removedNumbers, renumberMap);

      expect(result).toBe('');
    });

    it('handles markdown with code blocks and citations', () => {
      const markdown = '```js\ncode [1]\n```\n\nText [2] after.';
      const removedNumbers = new Set([1]);
      const renumberMap = new Map([[2, 1]]);

      const result = cleanAndRenumberMarkdown(markdown, removedNumbers, renumberMap);

      expect(result).toContain('```js');
      expect(result).toContain('code');
      expect(result).toContain('Text [1] after.');
    });

    it('handles markdown lists with citations', () => {
      const markdown = '- Item [1]\n- Item [2]\n- Item [3]';
      const removedNumbers = new Set([2]);
      const renumberMap = new Map([
        [1, 1],
        [3, 2],
      ]);

      const result = cleanAndRenumberMarkdown(markdown, removedNumbers, renumberMap);

      expect(result).toBe('- Item [1]\n- Item\n- Item [2]');
    });
  });
});
