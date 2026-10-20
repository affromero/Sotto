import { describe, expect, it } from 'vitest';
import {
  materialFocusAnalysisCoverageSchema,
  materialFocusSelectionSchema,
  materialMergedSourceFocusSchema,
  materialFocusChunkReceiptSchema,
  materialSourceFocusCandidateSchema,
} from '@sotto/shared';

const sha = (digit: string) => digit.repeat(64);
const coverage = {
  expectedChunks: 2,
  analyzedChunks: 1,
  expectedCodePoints: 30,
  analyzedCodePoints: 10,
  pendingUnitIds: [sha('a')],
  failedUnitIds: [],
  emptyStreams: [],
  unresolvedPages: [],
  readableTextComplete: false,
  originalContentComplete: false,
  sufficientSource: true,
  status: 'INCOMPLETE',
};
describe('frozen private source analysis contracts', () => {
  it('rejects lone surrogates in model-authored display and semantic fields before database projection', () => {
    const citation = {
      unitId: 'a'.repeat(64),
      sourceKind: 'PASTE',
      sourceId: 'source',
      sourceSha256: 'b'.repeat(64),
      materialId: null,
      runId: null,
      streamId: 'stream',
      pageNumber: 1,
      origin: 'SOURCE_TEXT',
      chunkIndex: 0,
      chunkSha256: 'c'.repeat(64),
      pageTextSha256: 'c'.repeat(64),
      codePointStart: 0,
      codePointEnd: 1,
      utf8ByteStart: 0,
      utf8ByteEnd: 1,
      quote: 'A',
    };
    const valid = {
      localId: 'focus',
      kind: 'GRAMMAR',
      title: 'Readable 😀 title',
      description: 'A precise source-supported structure.',
      communicativeIntent: null,
      heading: null,
      grammarKeys: [],
      objectiveIds: [],
      groupIds: [],
      citations: [citation],
      continuation: null,
    };
    expect(materialSourceFocusCandidateSchema.parse(valid).title).toBe('Readable 😀 title');
    for (const field of ['title', 'description', 'communicativeIntent'] as const)
      expect(() =>
        materialSourceFocusCandidateSchema.parse({ ...valid, [field]: 'broken\uD800' })
      ).toThrow();
    for (const field of ['grammarKeys', 'objectiveIds', 'groupIds'] as const)
      expect(() =>
        materialSourceFocusCandidateSchema.parse({ ...valid, [field]: ['broken\uDFFF'] })
      ).toThrow();
    expect(() =>
      materialSourceFocusCandidateSchema.parse({
        ...valid,
        heading: { title: 'broken\uD800', citations: [citation] },
      })
    ).toThrow();
  });
  it('rejects a complete coverage claim while a chunk is pending or unresolved', () => {
    expect(materialFocusAnalysisCoverageSchema.parse(coverage)).toEqual(coverage);
    for (const changed of [
      { ...coverage, status: 'COMPLETE' },
      { ...coverage, readableTextComplete: true },
      { ...coverage, pendingUnitIds: [] },
      { ...coverage, failedUnitIds: [sha('a')] },
    ])
      expect(() => materialFocusAnalysisCoverageSchema.parse(changed)).toThrow();
  });

  it('distinguishes readable text completion from unresolved handwriting and insufficient source', () => {
    const partial = {
      ...coverage,
      analyzedChunks: 2,
      analyzedCodePoints: 30,
      pendingUnitIds: [],
      unresolvedPages: [{ sourceId: 'material', pageNumber: 1, state: 'UNCERTAIN' }],
      readableTextComplete: true,
      status: 'PARTIAL',
    };
    expect(materialFocusAnalysisCoverageSchema.parse(partial).originalContentComplete).toBe(false);
    expect(() =>
      materialFocusAnalysisCoverageSchema.parse({
        ...partial,
        originalContentComplete: true,
      })
    ).toThrow();
    expect(
      materialFocusAnalysisCoverageSchema.parse({
        ...partial,
        sufficientSource: false,
        status: 'INSUFFICIENT_SOURCE',
      }).status
    ).toBe('INSUFFICIENT_SOURCE');
  });

  it('accepts canonical captured selection without requiring stale credential secrets or inventing another revision', () => {
    const selection = {
      provider: 'local',
      model: 'owned-fixture',
      credentialFingerprint: null,
    };
    expect(materialFocusSelectionSchema.parse(selection)).toEqual(selection);
    expect(
      materialFocusSelectionSchema.parse({
        ...selection,
        moderationCredentialFingerprint: sha('a'),
      }).moderationCredentialFingerprint
    ).toBe(sha('a'));
    expect(() =>
      materialFocusSelectionSchema.parse({
        ...selection,
        endpoint: 'https://user:secret@example.com/v1',
      })
    ).toThrow();
    expect(() =>
      materialFocusSelectionSchema.parse({
        ...selection,
        endpoint: 'https://example.com/v1?key=secret',
      })
    ).toThrow();
  });

  it('cannot freeze source exposure as learner mastery or a receipt before validated output exists', () => {
    expect(() =>
      materialMergedSourceFocusSchema.parse({
        id: sha('a'),
        mastery: true,
        exposureOnly: false,
      })
    ).toThrow();
    const unknown = {
      unitId: sha('a'),
      inputDigest: sha('b'),
      status: 'UNKNOWN',
      resultSha256: null,
      diagnostic: 'An admitted provider invocation has an unknown outcome.',
    };
    expect(materialFocusChunkReceiptSchema.parse(unknown).status).toBe('UNKNOWN');
    expect(() =>
      materialFocusChunkReceiptSchema.parse({ ...unknown, status: 'ANALYZED' })
    ).toThrow();
    expect(() =>
      materialFocusChunkReceiptSchema.parse({
        ...unknown,
        resultSha256: sha('c'),
      })
    ).toThrow();
  });
});
