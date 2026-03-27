import { describe, it, expect } from 'vitest';
import { textToMarkdown } from '@/lib/extractors/text-to-markdown';

describe('textToMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(textToMarkdown('')).toBe('');
    expect(textToMarkdown('   ')).toBe('');
  });

  it('preserves paragraph structure from double newlines', () => {
    const input = 'First paragraph here.\n\nSecond paragraph here.';
    const result = textToMarkdown(input);

    expect(result).toContain('First paragraph here.');
    expect(result).toContain('Second paragraph here.');
    expect(result).toContain('\n\n');
  });

  it('detects heading-like short lines before longer text', () => {
    const input = 'Introduction\nThis is a much longer paragraph that follows the short heading line above and provides detail.';
    const result = textToMarkdown(input);

    expect(result).toContain('## Introduction');
  });

  it('does not mark lines ending with punctuation as headings', () => {
    const input = 'This is a sentence.\nFollowed by another longer sentence with more words and detail.';
    const result = textToMarkdown(input);

    expect(result).not.toContain('##');
  });

  it('does not mark long lines as headings', () => {
    const input = 'This is a very long line that exceeds eighty characters and should never be treated as a heading candidate at all\nShort follow-up.';
    const result = textToMarkdown(input);

    expect(result).not.toContain('##');
  });

  it('preserves dash list items', () => {
    const input = '- Item one\n- Item two\n- Item three';
    const result = textToMarkdown(input);

    expect(result).toContain('- Item one');
    expect(result).toContain('- Item two');
    expect(result).toContain('- Item three');
  });

  it('preserves numbered list items', () => {
    const input = '1. First\n2. Second\n3. Third';
    const result = textToMarkdown(input);

    expect(result).toContain('1. First');
    expect(result).toContain('2. Second');
  });

  it('normalizes bullet style (• and +) to dash', () => {
    const input = '• Bullet one\n+ Bullet two';
    const result = textToMarkdown(input);

    expect(result).toContain('- Bullet one');
    expect(result).toContain('- Bullet two');
  });

  it('collapses triple+ newlines to double newlines', () => {
    const input = 'Paragraph one.\n\n\n\n\nParagraph two.';
    const result = textToMarkdown(input);

    expect(result).not.toContain('\n\n\n');
    expect(result).toContain('\n\n');
  });

  it('handles single paragraph text', () => {
    const input = 'Just a single paragraph with no special formatting.';
    const result = textToMarkdown(input);

    expect(result).toBe('Just a single paragraph with no special formatting.');
  });

  it('handles mixed content with headings, paragraphs, and lists', () => {
    const input = [
      'Overview',
      'This article discusses several important topics in great detail and provides analysis.',
      '',
      'Key points:',
      '- First point',
      '- Second point',
      '- Third point',
      '',
      'The conclusion summarizes everything discussed above.',
    ].join('\n');

    const result = textToMarkdown(input);

    expect(result).toContain('## Overview');
    expect(result).toContain('- First point');
    expect(result).toContain('conclusion');
  });
});
