/**
 * Pedagogy styles: the science-grounded approaches and how they compose into the
 * learner-context block that generators thread through. BALANCED (and any unset
 * value) adds no methodology, so generation is unchanged from before the feature.
 */
import { describe, it, expect } from 'vitest';
import {
  PEDAGOGY_STYLES,
  getPedagogyStyle,
  isPedagogyStyle,
  formatPedagogyForPrompt,
  buildLearnerContext,
} from '@/lib/pedagogy';

describe('pedagogy styles', () => {
  it('exposes the five evidence-based styles, each with guidance and a basis', () => {
    const ids = PEDAGOGY_STYLES.map((s) => s.id);
    expect(ids).toEqual(['BALANCED', 'IMMERSION', 'GRAMMAR', 'COMMUNICATION', 'INTENSIVE']);
    for (const style of PEDAGOGY_STYLES) {
      expect(style.guidance.length).toBeGreaterThan(20);
      expect(style.basis.length).toBeGreaterThan(10);
      expect(style.label.length).toBeGreaterThan(0);
    }
  });

  it('getPedagogyStyle falls back to BALANCED for an unknown id', () => {
    expect(getPedagogyStyle('NOPE' as never).id).toBe('BALANCED');
    expect(getPedagogyStyle('IMMERSION').id).toBe('IMMERSION');
  });

  it('isPedagogyStyle accepts only the known ids', () => {
    expect(isPedagogyStyle('GRAMMAR')).toBe(true);
    expect(isPedagogyStyle('balanced')).toBe(false);
    expect(isPedagogyStyle(undefined)).toBe(false);
  });
});

describe('formatPedagogyForPrompt', () => {
  it('labels the approach and includes its guidance', () => {
    const block = formatPedagogyForPrompt('IMMERSION');
    expect(block).toContain('Immersion');
    expect(block).toContain('target language');
  });
});

describe('buildLearnerContext', () => {
  it('is empty for BALANCED with no note (generation unchanged)', () => {
    expect(buildLearnerContext('', 'BALANCED')).toBe('');
  });

  it('treats an unset/invalid style as BALANCED (empty)', () => {
    expect(buildLearnerContext('', undefined as never)).toBe('');
  });

  it('injects the methodology for a non-default style', () => {
    const ctx = buildLearnerContext('', 'GRAMMAR');
    expect(ctx).toContain('Grammar-first');
    expect(ctx).toContain('rule');
  });

  it('combines the pedagogy and the learner note', () => {
    const ctx = buildLearnerContext('I am learning for work travel.', 'COMMUNICATION');
    expect(ctx).toContain('Conversation-first');
    expect(ctx).toContain('work travel');
  });

  it('keeps just the note when the style is BALANCED', () => {
    expect(buildLearnerContext('my note', 'BALANCED')).toBe('my note');
  });
});
