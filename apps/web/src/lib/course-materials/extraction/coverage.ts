import {
  materialExtractionLedgerSchema,
  materialPageLedgerSchema,
  type MaterialExtractionLedger,
  type MaterialPageLedger,
} from '@sotto/shared';

/** The worker must substantiate visual states from the complete original page. */
export function materialPageCoverage(input: MaterialPageLedger) {
  const page = materialPageLedgerSchema.parse(input);
  const readable = page.textStreams.some((stream) => stream.hasNonWhitespace);
  const fullyCovered =
    page.embeddedText.state !== 'PENDING' &&
    ['TEXT_COVERED', 'RECOGNIZED', 'BLANK', 'TEXT_SOURCE'].includes(page.visual.state);
  return {
    pageNumber: page.pageNumber,
    readable,
    blank: page.visual.state === 'BLANK',
    fullyCovered,
    unresolved: !fullyCovered,
    pending: page.embeddedText.state === 'PENDING' || page.visual.state === 'UNASSESSED',
    unavailable: page.visual.state === 'UNAVAILABLE',
    failed: page.embeddedText.state === 'FAILED' || page.visual.state === 'FAILED',
  };
}

/** Ledger coverage is separate from per-chunk persistence and downstream analysis. */
export function materialExtractionCoverage(input: MaterialExtractionLedger) {
  const ledger = materialExtractionLedgerSchema.parse(input);
  const pages = ledger.pages
    .map(materialPageCoverage)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  return {
    pageCount: ledger.pageCount,
    visitedPageCount: pages.filter((page) => !page.pending).length,
    readablePageCount: pages.filter((page) => page.readable).length,
    blankPageCount: pages.filter((page) => page.blank).length,
    unresolvedPageNumbers: pages.filter((page) => page.unresolved).map((page) => page.pageNumber),
    failedPageNumbers: pages.filter((page) => page.failed).map((page) => page.pageNumber),
    unavailablePageNumbers: pages.filter((page) => page.unavailable).map((page) => page.pageNumber),
    pendingPageNumbers: pages.filter((page) => page.pending).map((page) => page.pageNumber),
    processingComplete: pages.every((page) => !page.pending),
    coverageComplete: pages.every((page) => page.fullyCovered),
  };
}
