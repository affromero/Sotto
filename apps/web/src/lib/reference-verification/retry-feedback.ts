import type { VerificationResult } from './pipeline';
import type { ClaimContext } from './claim-extractor';
import type { VerificationCheck } from '@/lib/reference-validator';

interface ReferenceRecord {
  id: string;
  number: number;
  title: string;
  url: string | null;
  doi: string | null;
}

/**
 * Build structured feedback for the LLM explaining which references passed/failed
 * and what claims lost their sources, so the regeneration can fix them.
 */
export function buildReferenceRetryFeedback(params: {
  references: ReferenceRecord[];
  verificationResults: Map<string, VerificationResult>;
  rejectedRefIds: Set<string>;
  claimContexts: Map<number, ClaimContext>;
  requiredRefCount: number;
}): string {
  const { references, verificationResults, rejectedRefIds, claimContexts, requiredRefCount } = params;

  const verified: string[] = [];
  const failed: string[] = [];
  let verifiedCount = 0;

  for (const ref of references) {
    if (rejectedRefIds.has(ref.id)) {
      const claims = claimContexts.get(ref.number);
      const claimText = claims?.sentences[0] ?? 'No claim context available';
      failed.push(
        `[${ref.number}] "${ref.title}" — REJECTED (blocked domain)\n` +
        `  URL: ${ref.url ?? 'none'}\n` +
        `  Claim: "${claimText}"\n` +
        `  ACTION: Find a credible source that supports this claim`
      );
      continue;
    }

    const result = verificationResults.get(ref.id);
    if (!result) continue;

    if (result.verdict.status === 'VERIFIED' || result.verdict.status === 'REPLACED') {
      verifiedCount++;
      verified.push(
        `[${ref.number}] "${ref.title}" — ${result.verdict.status} (score: ${result.score.toFixed(2)})`
      );
    } else {
      const failureReasons = extractFailureReasons(result.checks);
      const claims = claimContexts.get(ref.number);
      const claimText = claims?.sentences[0] ?? 'No claim context available';

      failed.push(
        `[${ref.number}] "${ref.title}" — REMOVED\n` +
        `  URL: ${ref.url ?? 'none'} → ${failureReasons}\n` +
        `  AI verdict: ${result.checks.find((c) => c.layer === 'ai')?.detail ?? 'N/A'}\n` +
        `  Claim: "${claimText}"\n` +
        `  ACTION: Search web for a real source that supports this claim`
      );
    }
  }

  const lines: string[] = ['REFERENCE_VALIDATION_FEEDBACK:', ''];

  if (verified.length > 0) {
    lines.push('## Verified References (KEEP — do not modify):');
    lines.push(...verified);
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push('## Failed References (MUST REPLACE with real sources):');
    lines.push(...failed);
    lines.push('');
  }

  const failedCount = references.length - verifiedCount;
  const needed = Math.max(0, requiredRefCount - verifiedCount);
  lines.push(`## Summary: ${verifiedCount}/${references.length} verified, ${failedCount} failed. Need ${needed}+ more real sources.`);

  return lines.join('\n');
}

function extractFailureReasons(checks: VerificationCheck[]): string {
  const reasons: string[] = [];
  for (const check of checks) {
    if (!check.passed) {
      reasons.push(`${check.layer}: ${check.detail}`);
    }
  }
  return reasons.length > 0 ? reasons.join('; ') : 'all checks failed';
}

/**
 * After the LLM regenerates a script, merge previously verified references back in.
 *
 * Strategy: The LLM is instructed to KEEP verified refs. We match by DOI, URL, or title.
 * - If the LLM kept a verified ref: use the DB version (already validated)
 * - If the LLM dropped a verified ref: we do NOT force-restore it (the regenerated
 *   script may have restructured claims, making the old ref irrelevant)
 * - New refs from the LLM: keep as-is (they'll be validated on the next pass)
 *
 * Returns the merged references array ready for DB upsert.
 */
export function mergeVerifiedReferences(params: {
  previousRefs: ReferenceRecord[];
  previousResults: Map<string, VerificationResult>;
  newRefs: Array<{ number: number; title: string; authors?: string[]; year?: number | null; url?: string | null; doi?: string | null; type?: string; publisher?: string | null }>;
}): Array<{ number: number; title: string; authors: string[]; year: number | null; url: string | null; doi: string | null; type: string; publisher: string | null; isVerified: boolean }> {
  const { previousRefs, previousResults, newRefs } = params;

  // Build lookup of verified previous refs
  const verifiedPrev = new Map<string, ReferenceRecord>();
  for (const ref of previousRefs) {
    const result = previousResults.get(ref.id);
    if (result && (result.verdict.status === 'VERIFIED' || result.verdict.status === 'REPLACED')) {
      verifiedPrev.set(ref.id, ref);
    }
  }

  const merged = newRefs.map((newRef) => {
    // Try to match against a verified previous ref
    const match = findMatchingVerifiedRef(newRef, verifiedPrev, previousRefs);

    if (match) {
      // Use DB version of verified ref with the new number
      return {
        number: newRef.number,
        title: match.title,
        authors: [] as string[], // Will be filled from DB record in worker
        year: null as number | null,
        url: match.url,
        doi: match.doi,
        type: 'article',
        publisher: null as string | null,
        isVerified: true,
        matchedRefId: match.id,
      };
    }

    return {
      number: newRef.number,
      title: newRef.title,
      authors: newRef.authors ?? [],
      year: newRef.year ?? null,
      url: newRef.url ?? null,
      doi: newRef.doi ?? null,
      type: newRef.type ?? 'article',
      publisher: newRef.publisher ?? null,
      isVerified: false,
    };
  });

  return merged;
}

function findMatchingVerifiedRef(
  newRef: { title: string; url?: string | null; doi?: string | null },
  verifiedPrev: Map<string, ReferenceRecord>,
  allPrevRefs: ReferenceRecord[]
): ReferenceRecord | undefined {
  for (const prev of verifiedPrev.values()) {
    // Exact DOI match
    if (newRef.doi && prev.doi && normalizeDoi(newRef.doi) === normalizeDoi(prev.doi)) {
      return prev;
    }
    // Exact URL match
    if (newRef.url && prev.url && normalizeUrl(newRef.url) === normalizeUrl(prev.url)) {
      return prev;
    }
    // Title similarity (Jaccard >= 0.7)
    if (jaccardSimilarity(newRef.title, prev.title) >= 0.7) {
      return prev;
    }
  }
  return undefined;
}

function normalizeDoi(doi: string): string {
  return doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').trim();
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().trim();
  }
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
