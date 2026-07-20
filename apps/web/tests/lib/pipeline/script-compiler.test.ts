import { describe, expect, it } from 'vitest';
import { compileScript, type CompileInput } from '@/lib/script-compiler';

function source(sourceId: string, status: 'verified' | 'weak' = 'verified') {
  return {
    sourceId,
    canonicalUrl: `https://example.com/${sourceId}`,
    title: `Source ${sourceId}`,
    authors: ['Researcher'],
    publisher: 'Example Press',
    publishedAt: '2025-01-01',
    year: 2025,
    type: 'ARTICLE' as const,
    domain: 'GENERAL' as const,
    verification: {
      status,
      score: status === 'verified' ? 0.95 : 0.4,
      checks: { url: true, doi: false, title: true },
    },
    excerpts: [{ excerptId: `${sourceId}-excerpt`, locator: 'p. 1', text: 'Supported fact' }],
  };
}

function input(): CompileInput {
  return {
    turns: [
      { speaker: 'HOST', text: 'The first supported fact matters [[ev_one]].' },
      { speaker: 'EXPERT', text: 'A second source independently supports it [[ev_two]].' },
    ],
    sources: [source('source-one'), source('source-two')],
    evidence: [
      {
        evidenceId: 'ev_one',
        claim: 'First fact',
        claimType: 'fact',
        sourceIds: ['source-one'],
        excerptIds: ['source-one-excerpt'],
        confidence: 0.95,
        caveats: [],
        freshness: 'current',
      },
      {
        evidenceId: 'ev_two',
        claim: 'Second fact',
        claimType: 'fact',
        sourceIds: ['source-two'],
        excerptIds: ['source-two-excerpt'],
        confidence: 0.95,
        caveats: [],
        freshness: 'current',
      },
    ],
    depth: 'eli5',
    durationTarget: 1,
  };
}

describe('compileScript evidence enforcement', () => {
  it('compiles verified evidence into numbered citations', () => {
    const result = compileScript(input());

    expect(result.success).toBe(true);
    expect(result.turns.map((turn) => turn.text)).toEqual([
      'The first supported fact matters [1].',
      'A second source independently supports it [2].',
    ]);
    expect(result.references.map((reference) => reference.sourceId)).toEqual([
      'source-one',
      'source-two',
    ]);
  });

  it('rejects evidence backed by a source that was not verified', () => {
    const value = input();
    value.sources[0] = source('source-one', 'weak');

    const result = compileScript(value);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      'Evidence ev_one references source source-one with weak verification'
    );
  });

  it('rejects evidence whose quoted excerpt does not exist in its source', () => {
    const value = input();
    value.evidence[0].excerptIds = ['missing-excerpt'];

    const result = compileScript(value);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Evidence ev_one references missing excerpt missing-excerpt');
  });

  it('emits every citation when one claim is supported by multiple sources', () => {
    const value = input();
    value.turns = [{ speaker: 'HOST', text: 'Independent sources support this claim [[ev_one]].' }];
    value.evidence = [
      {
        ...value.evidence[0],
        sourceIds: ['source-one', 'source-two'],
        excerptIds: ['source-one-excerpt', 'source-two-excerpt'],
      },
    ];

    const result = compileScript(value);

    expect(result.success).toBe(true);
    expect(result.turns[0].text).toBe('Independent sources support this claim [1][2].');
    expect(result.references).toHaveLength(2);
  });

  it('preserves a DOI embedded in a canonical doi.org URL', () => {
    const value = input();
    value.sources[0].canonicalUrl = 'https://doi.org/10.1234/example.2025.7';

    const result = compileScript(value);

    expect(result.references[0].doi).toBe('10.1234/example.2025.7');
  });
});
