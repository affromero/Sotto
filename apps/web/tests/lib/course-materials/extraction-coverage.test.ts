// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  materialExtractionLedgerSchema,
  materialPageLedgerSchema,
  type MaterialExtractionLedger,
  type MaterialPageLedger,
  type MaterialTextSource,
} from '@sotto/shared';
import {
  prepareMaterialPageText,
  validateMaterialTextChunks,
} from '@/lib/course-materials/extraction/chunks';
import {
  materialExtractionCoverage,
  materialPageCoverage,
} from '@/lib/course-materials/extraction/coverage';

const source: MaterialTextSource = {
  origin: 'EMBEDDED_TEXT',
  method: 'synthetic-page-text',
  version: '1',
};
const visual = {
  assessor: { method: 'synthetic-full-page-assessment', version: '1' },
  pageImageSha256: 'a'.repeat(64),
  extent: 'FULL_PAGE' as const,
  diagnostic: 'The entire rendered page was checked, including visible annotations.',
};
function page(pageNumber = 1, text = 'A printed sentence.'): MaterialPageLedger {
  return {
    pageNumber,
    embeddedText: { state: 'EXTRACTED' },
    visual: { state: 'TEXT_COVERED', ...visual },
    textStreams: [prepareMaterialPageText({ pageNumber, source, text }).manifest],
  };
}
function ledger(pages: MaterialPageLedger[]): MaterialExtractionLedger {
  return {
    schemaVersion: 1,
    materialSha256: 'b'.repeat(64),
    extractor: { method: 'synthetic-pages', version: '1' },
    pageCount: pages.length,
    pages,
  };
}

describe('material page extraction coverage', () => {
  it('accepts a text-only source only when the complete original byte hash is preserved', () => {
    const complete = page(1, '\uFEFFexact\u0000text 😀');
    const sha256 = complete.textStreams[0]!.textSha256;
    complete.visual = {
      state: 'TEXT_SOURCE',
      originalSha256: sha256,
      diagnostic: 'Complete original UTF-8 source.',
    };
    const input = { ...ledger([complete]), materialSha256: sha256 };
    expect(materialExtractionCoverage(input)).toMatchObject({
      processingComplete: true,
      coverageComplete: true,
    });
    expect(
      materialExtractionLedgerSchema.safeParse({ ...input, materialSha256: 'f'.repeat(64) }).success
    ).toBe(false);
    expect(
      materialExtractionLedgerSchema.safeParse({
        ...input,
        pageCount: 2,
        pages: [complete, page(2)],
      }).success
    ).toBe(false);
  });
  it('accounts for all 65 pages and retains a focus on the final page beyond one million characters', () => {
    const pages: MaterialPageLedger[] = [];
    const focuses: { pageNumber: number; text: string }[] = [];
    let totalCodePoints = 0;
    for (let pageNumber = 1; pageNumber <= 65; pageNumber += 1) {
      const text =
        'synthetic source '.repeat(1100) +
        (pageNumber === 65 ? '\nFINAL_FOCUS: obwohl versus trotzdem' : '');
      const prepared = prepareMaterialPageText({ pageNumber, source, text });
      validateMaterialTextChunks(prepared.manifest, prepared.chunks);
      for (const chunk of prepared.chunks) {
        if (chunk.text.includes('FINAL_FOCUS:')) focuses.push({ pageNumber, text: chunk.text });
      }
      totalCodePoints += prepared.manifest.codePointLength;
      pages.push({ ...page(pageNumber), textStreams: [prepared.manifest] });
    }
    expect(totalCodePoints).toBeGreaterThan(1_000_000);
    expect(focuses).toHaveLength(1);
    expect(focuses[0]).toMatchObject({ pageNumber: 65 });
    expect(focuses[0]!.text).toContain('obwohl versus trotzdem');
    expect(materialExtractionCoverage(ledger(pages.reverse()))).toMatchObject({
      pageCount: 65,
      visitedPageCount: 65,
      readablePageCount: 65,
      coverageComplete: true,
      processingComplete: true,
      unresolvedPageNumbers: [],
    });
  });
  it('never infers blankness or visual completeness from empty embedded text', () => {
    const empty = { ...page(1, ''), visual: { state: 'UNASSESSED' as const } };
    expect(materialPageCoverage(empty)).toMatchObject({
      blank: false,
      readable: false,
      fullyCovered: false,
      unresolved: true,
      pending: true,
    });
    expect(materialExtractionCoverage(ledger([empty])).coverageComplete).toBe(false);
  });
  it('keeps mixed printed and handwritten content unresolved until explicit recognition', () => {
    const mixed = {
      ...page(),
      visual: {
        ...visual,
        state: 'RECOGNITION_NEEDED' as const,
        diagnostic: 'Printed text was extracted; handwritten margin notes remain unreadable.',
      },
    };
    expect(materialPageCoverage(mixed)).toMatchObject({
      readable: true,
      fullyCovered: false,
      unresolved: true,
      pending: false,
    });
    expect(materialExtractionCoverage(ledger([mixed]))).toMatchObject({
      processingComplete: true,
      coverageComplete: false,
      unresolvedPageNumbers: [1],
    });
    const recognized = prepareMaterialPageText({
      pageNumber: 1,
      source: {
        ...source,
        origin: 'VISUAL_RECOGNITION',
        method: 'explicit-recognition',
      },
      text: 'Printed sentence.\nHandwritten margin: als oder wenn?',
    });
    const complete: MaterialPageLedger = {
      ...mixed,
      visual: { ...visual, state: 'RECOGNIZED' },
      textStreams: [...mixed.textStreams, recognized.manifest],
    };
    expect(materialPageCoverage(complete).fullyCovered).toBe(true);
    expect(complete.textStreams[0]).toEqual(mixed.textStreams[0]);
  });
  it('keeps uncertain recognized text available without claiming complete recognition', () => {
    const recognized = prepareMaterialPageText({
      pageNumber: 1,
      source: { ...source, origin: 'VISUAL_RECOGNITION' },
      text: 'wer[?]en, original unclear',
    });
    const uncertain: MaterialPageLedger = {
      pageNumber: 1,
      embeddedText: {
        state: 'FAILED',
        diagnostic: 'No embedded text available.',
      },
      visual: {
        ...visual,
        state: 'UNCERTAIN',
        diagnostic: 'The handwritten middle letter cannot be determined.',
      },
      textStreams: [recognized.manifest],
    };
    expect(materialPageCoverage(uncertain)).toMatchObject({
      readable: true,
      fullyCovered: false,
      failed: true,
    });
    expect(materialExtractionCoverage(ledger([uncertain])).unresolvedPageNumbers).toEqual([1]);
  });
  it('accepts a genuinely blank page only through explicit full-page visual evidence', () => {
    const blank: MaterialPageLedger = {
      ...page(1, ''),
      visual: {
        ...visual,
        state: 'BLANK',
        diagnostic: 'Full-page assessment found no visible content.',
      },
    };
    expect(materialPageCoverage(blank)).toMatchObject({
      blank: true,
      fullyCovered: true,
      readable: false,
    });
    expect(
      materialPageLedgerSchema.safeParse({
        ...blank,
        visual: { state: 'BLANK' },
      }).success
    ).toBe(false);
    expect(
      materialPageLedgerSchema.safeParse({
        ...blank,
        visual: { ...blank.visual, extent: 'TILE' },
      }).success
    ).toBe(false);
  });
  it('rejects blank classifications that conflict with retained content', () => {
    expect(
      materialPageLedgerSchema.safeParse({
        ...page(),
        visual: { ...visual, state: 'BLANK' },
      }).success
    ).toBe(false);
  });
  it('retains layout whitespace on an explicitly assessed blank page', () => {
    const blank: MaterialPageLedger = {
      ...page(1, ' \r\n\t '),
      visual: { ...visual, state: 'BLANK' },
    };
    expect(blank.textStreams[0]!.codePointLength).toBe(5);
    expect(materialPageCoverage(blank)).toMatchObject({
      blank: true,
      readable: false,
      fullyCovered: true,
    });
  });
  it('retains explicit failed and pending pages rather than dropping them from coverage', () => {
    const failed: MaterialPageLedger = {
      pageNumber: 2,
      embeddedText: { state: 'FAILED', diagnostic: 'Parser failure.' },
      visual: {
        ...visual,
        state: 'FAILED',
        diagnostic: 'Page rendering failed.',
      },
      textStreams: [],
    };
    const pending: MaterialPageLedger = {
      pageNumber: 3,
      embeddedText: { state: 'PENDING' },
      visual: { state: 'UNASSESSED' },
      textStreams: [],
    };
    expect(materialExtractionCoverage(ledger([pending, failed, page()]))).toMatchObject({
      pageCount: 3,
      readablePageCount: 1,
      visitedPageCount: 2,
      failedPageNumbers: [2],
      pendingPageNumbers: [3],
      unresolvedPageNumbers: [2, 3],
      processingComplete: false,
      coverageComplete: false,
    });
  });
  it('reports unavailable recognition separately from pending processing and failed extraction', () => {
    const unavailable: MaterialPageLedger = {
      ...page(),
      visual: {
        state: 'UNAVAILABLE',
        diagnostic: 'No explicitly selected image-capable recognizer is configured.',
      },
    };
    expect(materialPageCoverage(unavailable)).toMatchObject({
      readable: true,
      fullyCovered: false,
      unresolved: true,
      pending: false,
      failed: false,
      unavailable: true,
    });
    expect(materialExtractionCoverage(ledger([unavailable]))).toMatchObject({
      visitedPageCount: 1,
      readablePageCount: 1,
      unavailablePageNumbers: [1],
      failedPageNumbers: [],
      pendingPageNumbers: [],
      unresolvedPageNumbers: [1],
      processingComplete: true,
      coverageComplete: false,
    });
    expect(
      materialPageLedgerSchema.safeParse({
        ...unavailable,
        visual: { state: 'UNAVAILABLE' },
      }).success
    ).toBe(false);
  });
  it('retains failed render coverage with no fabricated page image hash', () => {
    const failed: MaterialPageLedger = {
      pageNumber: 1,
      embeddedText: {
        state: 'FAILED',
        diagnostic: 'The original page could not be parsed.',
      },
      visual: {
        ...visual,
        state: 'FAILED',
        pageImageSha256: null,
        diagnostic: 'No rendered page image was produced.',
      },
      textStreams: [],
    };
    expect(materialExtractionCoverage(ledger([failed]))).toMatchObject({
      visitedPageCount: 1,
      readablePageCount: 0,
      failedPageNumbers: [1],
      unavailablePageNumbers: [],
      unresolvedPageNumbers: [1],
      processingComplete: true,
      coverageComplete: false,
    });
  });
  it.each(['TEXT_COVERED', 'RECOGNIZED', 'BLANK', 'UNCERTAIN', 'RECOGNITION_NEEDED'] as const)(
    'requires the actual page image hash for %s evidence',
    (state) => {
      expect(
        materialPageLedgerSchema.safeParse({
          ...page(),
          visual: { ...visual, state, pageImageSha256: null },
        }).success
      ).toBe(false);
    }
  );
  it('requires completed extraction accounting even when a visual assessment exists', () => {
    const pending = {
      ...page(1, ''),
      embeddedText: { state: 'PENDING' as const },
      visual: { ...visual, state: 'BLANK' as const },
    };
    expect(materialPageCoverage(pending)).toMatchObject({
      pending: true,
      fullyCovered: false,
    });
  });
  it('rejects omitted, duplicate, out-of-range and zero expected pages', () => {
    const complete = ledger([page(1), page(2)]);
    for (const altered of [
      { ...complete, pages: [page(1)] },
      { ...complete, pages: [page(1), page(1)] },
      { ...complete, pages: [page(1), page(3)] },
      { ...complete, pageCount: 0, pages: [] },
    ])
      expect(materialExtractionLedgerSchema.safeParse(altered).success).toBe(false);
  });
  it('requires exact page and source channel identities and their manifests', () => {
    const original = page();
    for (const altered of [
      { ...original, textStreams: [] },
      {
        ...original,
        textStreams: [original.textStreams[0]!, original.textStreams[0]!],
      },
      {
        ...original,
        textStreams: [{ ...original.textStreams[0]!, pageNumber: 2 }],
      },
      { ...original, visual: { ...visual, state: 'RECOGNIZED' } },
      { ...page(1, ''), visual: { ...visual, state: 'TEXT_COVERED' } },
    ])
      expect(materialPageLedgerSchema.safeParse(altered).success).toBe(false);
  });
  it('rejects unknown ledger fields instead of admitting unversioned status claims', () => {
    expect(
      materialExtractionLedgerSchema.safeParse({
        ...ledger([page()]),
        fullyAnalyzed: true,
      }).success
    ).toBe(false);
  });
});
