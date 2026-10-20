import { computeBayesianScore, type ContentDomain, type LayerResult } from 'groundcheck';
import {
  verifyUrl,
  verifyDoi,
  searchTitle,
  assessSourceQuality,
  type ReferenceInput,
  type VerificationCheck,
  type VerificationVerdict,
} from '@/lib/reference-validator';
import { logger } from '@/lib/logger';
import { classifyEpisodeReference } from './classify-episode-reference';
import { extractClaimContexts, type ClaimContext } from './claim-extractor';
import { aiEvaluateWithDomainContext } from './ai-layer';
import type { CapturedLearningAi } from '@/lib/learning-ai';

const MAX_CONCURRENT = 10;

async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

export interface VerificationResult {
  domain: ContentDomain;
  verdict: VerificationVerdict;
  score: number;
  checks: VerificationCheck[];
  logOddsContributions: Record<string, number>;
}

export async function runReferenceVerification(
  refs: ReferenceInput[],
  scriptTurns: Array<{ speaker: string; text: string }>,
  topic: string,
  ai: CapturedLearningAi
): Promise<{
  results: Map<string, VerificationResult>;
  rejectedRefIds: Set<string>;
  claimContexts: Map<number, ClaimContext>;
}> {
  const results = new Map<string, VerificationResult>();
  const rejectedRefIds = new Set<string>();

  // Source quality pre-filter: reject blocked domains before running verification layers
  for (const ref of refs) {
    const quality = assessSourceQuality(ref);
    if (!quality.accepted) {
      rejectedRefIds.add(ref.id);
      logger.info('Reference rejected by source quality filter', {
        refNumber: String(ref.number),
        reason: quality.reason,
      });
    }
  }

  const acceptedRefs = refs.filter((r) => !rejectedRefIds.has(r.id));

  // Classify each accepted reference by domain
  const domainMap = new Map<string, ContentDomain>();
  for (const ref of acceptedRefs) {
    const domain = classifyEpisodeReference({ doi: ref.doi, url: ref.url, type: ref.type });
    domainMap.set(ref.id, domain);
    logger.info('Reference classified', {
      refNumber: String(ref.number),
      domain,
      url: ref.url ?? 'none',
    });
  }

  // Run applicable layers per reference with concurrency limit
  const allChecks = new Map<string, VerificationCheck[]>();

  const layerTasks = acceptedRefs.map((ref) => async () => {
    const domain = domainMap.get(ref.id)!;

    // Run applicable checks in parallel — each is independent with its own
    // timeout. A layer only runs when the reference carries its input: an
    // absent URL or DOI is missing evidence (Bayesian-neutral), not proof of
    // fabrication, so the layer is skipped rather than scored as failed.
    const checkPromises: Promise<VerificationCheck>[] = [];

    if (ref.url?.trim()) {
      checkPromises.push(verifyUrl(ref));
    }

    if (domain === 'ACADEMIC' && ref.doi?.trim()) {
      checkPromises.push(verifyDoi(ref));
    }

    if (domain === 'ACADEMIC' || domain === 'GENERAL' || domain === 'EDUCATIONAL') {
      checkPromises.push(searchTitle(ref));
    }

    const checks = await Promise.all(checkPromises);

    return { id: ref.id, checks };
  });

  let externalCheckResults: Array<{ id: string; checks: VerificationCheck[] }>;
  try {
    externalCheckResults = await runWithConcurrencyLimit(layerTasks, MAX_CONCURRENT);
  } catch (error) {
    logger.warn('External verification APIs failed; affected references will fail closed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    externalCheckResults = acceptedRefs.map((ref) => ({ id: ref.id, checks: [] }));
  }

  for (const result of externalCheckResults) {
    allChecks.set(result.id, result.checks);
  }

  // Extract claim contexts from script turns
  const claimContexts = extractClaimContexts(
    scriptTurns,
    acceptedRefs.map((r) => r.number)
  );

  // Build refs-with-domain for AI batch call
  const refsWithDomain = acceptedRefs.map((ref) => ({
    ref,
    domain: domainMap.get(ref.id)!,
    claimContext: claimContexts.get(ref.number) ?? { sentences: [], speakerTurns: [] },
    priorChecks: allChecks.get(ref.id) ?? [],
  }));

  // AI layer: single batch call with per-ref domain instructions
  const aiResults = await aiEvaluateWithDomainContext(refsWithDomain, topic, ai);

  // Merge AI results into allChecks
  for (const [refId, aiCheck] of aiResults) {
    const existing = allChecks.get(refId) ?? [];
    existing.push(aiCheck);
    allChecks.set(refId, existing);
  }

  // Compute domain-aware verdicts
  for (const ref of acceptedRefs) {
    const domain = domainMap.get(ref.id)!;
    const checks = allChecks.get(ref.id) ?? [];

    const layerResults: LayerResult[] = checks.map((check) => ({
      layerId: check.layer as LayerResult['layerId'],
      passed: check.passed,
      confidence: check.confidence,
    }));

    const {
      posterior,
      verdict: rawVerdict,
      logOddsContributions,
    } = computeBayesianScore(domain, layerResults);

    let verdict: VerificationVerdict;

    // The AI check already sees the extracted claims (or "No claim sentences
    // extracted"); a reference the script never cites inline has no claims to
    // contradict, so its verdict rests on the AI source-existence judgment
    // rather than auto-failing on the empty claim list.
    const aiClaimCheck = checks.find((check) => check.layer === 'ai');
    const claimsSupported = aiClaimCheck?.passed === true;

    if (rawVerdict === 'VERIFIED' && claimsSupported) {
      verdict = { status: 'VERIFIED', confidence: posterior };
    } else {
      // Require the current numbered citation to support its claims. A failed
      // citation needs regenerated content and fresh verification.
      verdict = { status: 'REMOVED', confidence: posterior };
    }

    results.set(ref.id, { domain, verdict, score: posterior, checks, logOddsContributions });
  }

  return { results, rejectedRefIds, claimContexts };
}
