import { classifyReference, type ContentDomain } from 'groundcheck';

/**
 * Classify a reference for verification, ignoring a DOI its type does not
 * justify.
 *
 * `classifyReference` returns ACADEMIC for any reference carrying a DOI, and
 * ACADEMIC demands a 0.82 posterior. Script models routinely staple an invented
 * DOI onto a plain web page, which both raises the bar to 0.82 and adds a
 * failing DOI lookup — sinking a source the URL, title and AI layers all
 * confirm. Only PAPER and BOOK are ever asked for a DOI, so for every other type
 * the DOI is dropped from the classification input alone. It stays in the
 * database for the bibliography and for deduplication, a genuine journal article
 * on a recognized academic host still classifies ACADEMIC by URL pattern, and
 * the DOI layer still keys off the reference's own `doi` — so a real, resolving
 * DOI keeps its full weight.
 *
 * Shared with `scripts/replay-verification.ts` so a replay classifies exactly
 * as production does.
 */
export function classifyEpisodeReference(ref: {
  doi?: string | null;
  url?: string | null;
  type?: string | null;
}): ContentDomain {
  const doiJustifiedByType = ref.type === 'PAPER' || ref.type === 'BOOK';
  return classifyReference({
    doi: doiJustifiedByType ? ref.doi : null,
    url: ref.url,
    type: ref.type,
  });
}
