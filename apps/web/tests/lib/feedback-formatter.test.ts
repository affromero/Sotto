import { describe, it, expect } from 'vitest';
import { formatUserFeedback } from '@/lib/feedback-formatter';

describe('formatUserFeedback', () => {
  const turns = [
    { speaker: 'HOST', text: 'Welcome to the show' },
    { speaker: 'EXPERT', text: 'Thanks for having me' },
    { speaker: 'HOST', text: 'Let us dive in' },
  ];

  it('formats general feedback only', () => {
    const result = formatUserFeedback({ feedback: 'Make it more casual' });

    expect(result).toBe('### General Feedback\nMake it more casual');
  });

  it('formats per-turn comments with speaker names', () => {
    const result = formatUserFeedback({
      turnComments: { 0: 'Too formal', 2: 'Great question' },
      turns,
    });

    expect(result).toContain('### Turn-Specific Comments');
    expect(result).toContain('Turn 0 (HOST): "Too formal"');
    expect(result).toContain('Turn 2 (HOST): "Great question"');
  });

  it('formats highlights', () => {
    const result = formatUserFeedback({
      highlights: [{ turnIndex: 1, text: 'Thanks for having me', note: 'Too generic' }],
      turns,
    });

    expect(result).toContain('### Text Annotations');
    expect(result).toContain('Turn 1, "Thanks for having me": "Too generic"');
  });

  it('formats all three levels together', () => {
    const result = formatUserFeedback({
      feedback: 'Overall too long',
      turnComments: { 1: 'Simplify this' },
      highlights: [{ turnIndex: 0, text: 'Welcome', note: 'More energy' }],
      turns,
    });

    expect(result).toContain('### General Feedback');
    expect(result).toContain('### Turn-Specific Comments');
    expect(result).toContain('### Text Annotations');
    expect(result.indexOf('General Feedback')).toBeLessThan(result.indexOf('Turn-Specific'));
    expect(result.indexOf('Turn-Specific')).toBeLessThan(result.indexOf('Text Annotations'));
  });

  it('returns empty string when no feedback provided', () => {
    const result = formatUserFeedback({});

    expect(result).toBe('');
  });

  it('skips empty/whitespace-only feedback', () => {
    const result = formatUserFeedback({
      feedback: '   ',
      turnComments: { 0: '  ' },
      highlights: [{ turnIndex: 0, text: '', note: 'note' }],
      turns,
    });

    expect(result).toBe('');
  });

  it('handles turnComments without turns gracefully', () => {
    const result = formatUserFeedback({
      turnComments: { 0: 'Some comment' },
    });

    expect(result).toBe('');
  });

  it('skips turn comments for out-of-bounds indices', () => {
    const result = formatUserFeedback({
      turnComments: { 99: 'Out of bounds' },
      turns,
    });

    expect(result).toBe('');
  });

  it('trims feedback text', () => {
    const result = formatUserFeedback({
      feedback: '  Make it shorter  ',
    });

    expect(result).toBe('### General Feedback\nMake it shorter');
  });

  it('formats source URLs section', () => {
    const result = formatUserFeedback({
      sourceUrls: ['https://example.com/article', 'https://bbc.co.uk/news'],
    });

    expect(result).toContain('### User-Provided Source URLs');
    expect(result).toContain('- https://example.com/article');
    expect(result).toContain('- https://bbc.co.uk/news');
  });

  it('skips source URLs section when array is empty', () => {
    const result = formatUserFeedback({
      sourceUrls: [],
    });

    expect(result).toBe('');
  });

  it('includes source URLs after other sections', () => {
    const result = formatUserFeedback({
      feedback: 'More references needed',
      sourceUrls: ['https://example.com'],
    });

    expect(result).toContain('### General Feedback');
    expect(result).toContain('### User-Provided Source URLs');
    expect(result.indexOf('General Feedback')).toBeLessThan(
      result.indexOf('User-Provided Source URLs')
    );
  });
});
