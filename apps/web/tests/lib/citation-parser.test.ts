import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { ReferenceData } from '@/types/reference';

// ---- Import under test ----
import { parseTextWithCitations } from '@/lib/citation-parser';

// ---- Tests ----

describe('citation-parser', () => {
  const mockReferences: ReferenceData[] = [
    {
      id: 'ref-1',
      number: 1,
      title: 'First Reference',
      authors: ['Author One'],
      year: 2025,
      url: 'https://example.com/ref1',
      type: 'ARTICLE',
      verificationStatus: 'VERIFIED',
      publisher: null,
      doi: null,
      verificationDetails: null,
      contentDomain: null,
    },
    {
      id: 'ref-2',
      number: 2,
      title: 'Second Reference',
      authors: ['Author Two'],
      year: 2024,
      url: 'https://example.com/ref2',
      type: 'BOOK',
      verificationStatus: 'VERIFIED',
      publisher: null,
      doi: null,
      verificationDetails: null,
      contentDomain: null,
    },
    {
      id: 'ref-3',
      number: 3,
      title: 'Third Reference',
      authors: ['Author Three'],
      year: 2023,
      url: 'https://example.com/ref3',
      type: 'ARTICLE',
      verificationStatus: 'VERIFIED',
      publisher: null,
      doi: null,
      verificationDetails: null,
      contentDomain: null,
    },
  ];

  describe('basic parsing', () => {
    it('parses single citation marker [N]', () => {
      const text = 'This is a fact [1] from research.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('This is a fact ');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(result[2]).toBe(' from research.');
    });

    it('returns text as-is when no citation markers exist', () => {
      const text = 'This text has no citations.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('This text has no citations.');
    });

    it('parses multiple separate citations', () => {
      const text = 'First fact [1] and second fact [2] in text.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(5);
      expect(result[0]).toBe('First fact ');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(result[2]).toBe(' and second fact ');
      expect(React.isValidElement(result[3])).toBe(true);
      expect(result[4]).toBe(' in text.');
    });

    it('parses citation at start of text', () => {
      const text = '[1] This starts with a citation.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(2);
      expect(React.isValidElement(result[0])).toBe(true);
      expect(result[1]).toBe(' This starts with a citation.');
    });

    it('parses citation at end of text', () => {
      const text = 'This ends with a citation [3]';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe('This ends with a citation ');
      expect(React.isValidElement(result[1])).toBe(true);
    });

    it('parses citation in middle of text', () => {
      const text = 'Beginning [2] and end.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('Beginning ');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(result[2]).toBe(' and end.');
    });
  });

  describe('consecutive citation markers', () => {
    it('handles consecutive markers [1][2]', () => {
      const text = 'Multiple sources support this [1][2] claim.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(4);
      expect(result[0]).toBe('Multiple sources support this ');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(React.isValidElement(result[2])).toBe(true);
      expect(result[3]).toBe(' claim.');
    });

    it('handles three consecutive markers [1][2][3]', () => {
      const text = 'Three sources [1][2][3] confirm.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(5);
      expect(result[0]).toBe('Three sources ');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(React.isValidElement(result[2])).toBe(true);
      expect(React.isValidElement(result[3])).toBe(true);
      expect(result[4]).toBe(' confirm.');
    });

    it('handles consecutive markers with no space between', () => {
      const text = 'Studies[1][2][3]show results.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(5);
      expect(result[0]).toBe('Studies');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(React.isValidElement(result[2])).toBe(true);
      expect(React.isValidElement(result[3])).toBe(true);
      expect(result[4]).toBe('show results.');
    });
  });

  describe('comma-separated citation lists', () => {
    it('parses [1,2] as single citation marker', () => {
      const text = 'Multiple studies [1,2] agree.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('Multiple studies ');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(result[2]).toBe(' agree.');
    });

    it('parses [1, 2, 3] with spaces', () => {
      const text = 'Research [1, 2, 3] confirms.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('Research ');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(result[2]).toBe(' confirms.');
    });

    it('handles mixed spacing in comma-separated list', () => {
      const text = 'Sources [1,2, 3] show evidence.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(React.isValidElement(result[1])).toBe(true);
    });
  });

  describe('malformed markers', () => {
    it('renders non-matching citation as plain text', () => {
      const text = 'This has [999] which does not exist.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('This has ');
      expect(result[1]).toBe('[999]');
      expect(result[2]).toBe(' which does not exist.');
    });

    it('handles [0] as plain text', () => {
      const text = 'Zero reference [0] is invalid.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(result[1]).toBe('[0]');
    });

    it('handles negative numbers as plain text', () => {
      const text = 'Negative [-1] is not valid.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Negative [-1] is not valid.');
    });

    it('handles empty brackets [] as plain text', () => {
      const text = 'Empty brackets [] are ignored.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Empty brackets [] are ignored.');
    });

    it('handles malformed [1,] with trailing comma as plain text', () => {
      const text = 'Malformed [1,] citation.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Malformed [1,] citation.');
    });

    it('handles [abc] non-numeric content', () => {
      const text = 'Non-numeric [abc] marker.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Non-numeric [abc] marker.');
    });
  });

  describe('edge cases', () => {
    it('returns array with original text for empty string', () => {
      const result = parseTextWithCitations('', mockReferences);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('');
    });

    it('handles text with only citation marker', () => {
      const text = '[1]';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(1);
      expect(React.isValidElement(result[0])).toBe(true);
    });

    it('handles very high citation numbers', () => {
      const text = 'High number [9999] citation.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(result[1]).toBe('[9999]');
    });

    it('handles citation with leading zeros [01]', () => {
      const text = 'Leading zero [01] citation.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(React.isValidElement(result[1])).toBe(true);
    });

    it('preserves whitespace around citations', () => {
      const text = 'Text   [1]   more text.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result[0]).toBe('Text   ');
      expect(result[2]).toBe('   more text.');
    });

    it('handles newlines in text', () => {
      const text = 'First line [1]\nSecond line [2]';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(4);
      expect(result[0]).toBe('First line ');
      expect(result[2]).toBe('\nSecond line ');
    });

    it('handles empty references array', () => {
      const text = 'Text with [1] citation.';
      const result = parseTextWithCitations(text, []);

      expect(result).toHaveLength(3);
      expect(result[1]).toBe('[1]');
    });
  });

  describe('complex scenarios', () => {
    it('handles multiple citations throughout long text', () => {
      const text = 'Start [1] middle [2] and another [3] plus more [1] end.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(9);
      expect(React.isValidElement(result[1])).toBe(true);
      expect(React.isValidElement(result[3])).toBe(true);
      expect(React.isValidElement(result[5])).toBe(true);
      expect(React.isValidElement(result[7])).toBe(true);
    });

    it('handles mixed valid and invalid citations', () => {
      const text = 'Valid [1] invalid [999] valid [2] again.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(7);
      expect(React.isValidElement(result[1])).toBe(true);
      expect(result[3]).toBe('[999]');
      expect(React.isValidElement(result[5])).toBe(true);
    });

    it('handles citation markers in parentheses', () => {
      const text = 'Research shows ([1], [2]) evidence.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(5);
      expect(result[0]).toBe('Research shows (');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(result[2]).toBe(', ');
      expect(React.isValidElement(result[3])).toBe(true);
      expect(result[4]).toBe(') evidence.');
    });

    it('handles citations with punctuation', () => {
      const text = 'Evidence shows [1]. Another fact [2]!';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(5);
      expect(result[0]).toBe('Evidence shows ');
      expect(React.isValidElement(result[1])).toBe(true);
      expect(result[2]).toBe('. Another fact ');
      expect(React.isValidElement(result[3])).toBe(true);
      expect(result[4]).toBe('!');
    });

    it('handles partially matching reference numbers in comma list', () => {
      const text = 'Mixed references [1, 999, 2] here.';
      const result = parseTextWithCitations(text, mockReferences);

      expect(result).toHaveLength(3);
      expect(React.isValidElement(result[1])).toBe(true);
    });
  });

  describe('regex state management', () => {
    it('resets regex state between calls', () => {
      const text1 = 'First call [1] citation.';
      const text2 = 'Second call [2] citation.';

      const result1 = parseTextWithCitations(text1, mockReferences);
      const result2 = parseTextWithCitations(text2, mockReferences);

      expect(result1).toHaveLength(3);
      expect(result2).toHaveLength(3);
      expect(React.isValidElement(result1[1])).toBe(true);
      expect(React.isValidElement(result2[1])).toBe(true);
    });

    it('handles rapid consecutive parsing calls', () => {
      const texts = ['Text [1] one.', 'Text [2] two.', 'Text [3] three.'];

      const results = texts.map((text) => parseTextWithCitations(text, mockReferences));

      results.forEach((result) => {
        expect(result).toHaveLength(3);
        expect(React.isValidElement(result[1])).toBe(true);
      });
    });
  });

  describe('server-side rendering', () => {
    it('renders to HTML without errors', () => {
      const result = parseTextWithCitations('Study [1] confirmed.', mockReferences);
      const html = renderToString(React.createElement('span', null, ...result));
      expect(html).toContain('Citation 1');
      expect(html).toContain('Study');
      expect(html).toContain('confirmed.');
    });
  });

  describe('CitationMarker component integration', () => {
    it('generates unique keys for citation markers', () => {
      const text = 'Multiple [1] citations [2] with [3] keys.';
      const result = parseTextWithCitations(text, mockReferences);

      const markers = result.filter((node) => React.isValidElement(node));
      const keys = markers.map((marker) => (marker as React.ReactElement).key);

      expect(keys).toHaveLength(3);
      expect(new Set(keys).size).toBe(3);
    });

    it('passes correct reference data to CitationMarker', () => {
      const text = 'Citation [1] here.';
      const result = parseTextWithCitations(text, mockReferences);

      const marker = result[1] as React.ReactElement;
      expect((marker.props as any).references).toHaveLength(1);
      expect((marker.props as any).references[0].id).toBe('ref-1');
    });

    it('passes multiple references for comma-separated list', () => {
      const text = 'Multiple [1, 2] refs.';
      const result = parseTextWithCitations(text, mockReferences);

      const marker = result[1] as React.ReactElement;
      expect((marker.props as any).references).toHaveLength(2);
      expect((marker.props as any).references[0].number).toBe(1);
      expect((marker.props as any).references[1].number).toBe(2);
    });
  });
});
