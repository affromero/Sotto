import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { parseTextWithCitations } from '@/lib/citation-parser';
import type { ReferenceData } from '@/types/reference';

const mockReferences: ReferenceData[] = [
  {
    id: 'ref-1',
    number: 1,
    title: 'A Study on AI',
    authors: ['Smith, J.'],
    year: 2023,
    url: 'https://example.com/1',
    type: 'PAPER',
    publisher: 'Nature',
    doi: '10.1234/test1',
  },
  {
    id: 'ref-2',
    number: 2,
    title: 'Machine Learning Basics',
    authors: ['Doe, A.', 'Lee, B.'],
    year: 2022,
    url: 'https://example.com/2',
    type: 'BOOK',
    publisher: 'MIT Press',
    doi: null,
  },
  {
    id: 'ref-3',
    number: 3,
    title: 'Deep Learning Review',
    authors: [],
    year: null,
    url: null,
    type: 'WEB',
    publisher: null,
    doi: null,
  },
];

describe('parseTextWithCitations', () => {
  it('returns plain text when there are no citations', () => {
    const result = parseTextWithCitations('Hello world', mockReferences);
    expect(result).toEqual(['Hello world']);
  });

  it('returns plain text when text is empty', () => {
    const result = parseTextWithCitations('', mockReferences);
    expect(result).toEqual(['']);
  });

  it('parses a single citation [1]', () => {
    const result = parseTextWithCitations('According to a study [1], AI is growing.', mockReferences);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('According to a study ');
    expect(result[2]).toBe(', AI is growing.');
    // The middle element should be a React element (CitationMarker)
    expect(React.isValidElement(result[1])).toBe(true);
  });

  it('parses grouped citations [1,2]', () => {
    const result = parseTextWithCitations('Multiple sources [1,2] support this.', mockReferences);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('Multiple sources ');
    expect(React.isValidElement(result[1])).toBe(true);
    expect(result[2]).toBe(' support this.');
  });

  it('parses grouped citations with spaces [1, 2]', () => {
    const result = parseTextWithCitations('Sources [1, 2] agree.', mockReferences);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('Sources ');
    expect(React.isValidElement(result[1])).toBe(true);
  });

  it('handles multiple separate citations', () => {
    const result = parseTextWithCitations('First [1] and second [2] and third [3].', mockReferences);
    // text, marker, text, marker, text, marker, text
    expect(result).toHaveLength(7);
    expect(result[0]).toBe('First ');
    expect(React.isValidElement(result[1])).toBe(true);
    expect(result[2]).toBe(' and second ');
    expect(React.isValidElement(result[3])).toBe(true);
    expect(result[4]).toBe(' and third ');
    expect(React.isValidElement(result[5])).toBe(true);
    expect(result[6]).toBe('.');
  });

  it('renders unmatched citations as plain text', () => {
    const result = parseTextWithCitations('See reference [99] for details.', mockReferences);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('See reference ');
    expect(result[1]).toBe('[99]'); // no matching ref, rendered as plain text
    expect(result[2]).toBe(' for details.');
  });

  it('handles citation at the start of text', () => {
    const result = parseTextWithCitations('[1] shows that AI is improving.', mockReferences);
    expect(result).toHaveLength(2);
    expect(React.isValidElement(result[0])).toBe(true);
    expect(result[1]).toBe(' shows that AI is improving.');
  });

  it('handles citation at the end of text', () => {
    const result = parseTextWithCitations('AI is improving [1]', mockReferences);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('AI is improving ');
    expect(React.isValidElement(result[1])).toBe(true);
  });

  it('handles empty references array', () => {
    const result = parseTextWithCitations('Text with [1] citation.', []);
    // No matching references, so [1] should be rendered as plain text
    expect(result).toHaveLength(3);
    expect(result[1]).toBe('[1]');
  });

  it('renders to HTML without errors', () => {
    const result = parseTextWithCitations('Study [1] confirmed.', mockReferences);
    const html = renderToString(React.createElement('span', null, ...result));
    // React SSR renders text nodes with comment separators
    expect(html).toContain('Citation 1');
    expect(html).toContain('Study');
    expect(html).toContain('confirmed.');
  });
});
