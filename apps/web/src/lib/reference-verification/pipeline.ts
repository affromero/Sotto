import {
  classifyReference,
  computeBayesianScore,
  type ContentDomain,
  type LayerResult,
} from '@sottofm/verification-standard';
import {
  verifyUrl,
  verifyDoi,
  searchTitle,
  assessSourceQuality,
  type ReferenceInput,
  type VerificationCheck,
  type VerificationVerdict,
  type ReplacementData,
} from '@/lib/reference-validator';
import { logger } from '@/lib/logger';
import { extractClaimContexts } from './claim-extractor';
import { aiEvaluateWithDomainContext } from './ai-layer';

const MAX_CONCURRENT = 5;

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

function findBestReplacement(checks: VerificationCheck[]): ReplacementData | undefined {
  const priority: Array<'doi' | 'title_search' | 'ai'> = ['doi', 'title_search', 'ai'];
  for (const layer of priority) {
    const check = checks.find((c) => c.layer === layer && c.replacement);
    if (check?.replacement) return check.replacement;
  }
  return undefined;
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
  apiKeyOverride?: string,
  model?: string,
  provider?: string
): Promise<{ results: Map<string, VerificationResult>; rejectedRefIds: Set<string> }> {
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
    const domain = classifyReference({ doi: ref.doi, url: ref.url, type: ref.type });
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

    // Run applicable checks in parallel — each is independent with its own timeout
    const checkPromises: Promise<VerificationCheck>[] = [verifyUrl(ref)];

    if (domain === 'ACADEMIC') {
      checkPromises.push(verifyDoi(ref));
    }

    if (domain === 'ACADEMIC' || domain === 'GENERAL') {
      checkPromises.push(searchTitle(ref));
    }

    const checks = await Promise.all(checkPromises);

    return { id: ref.id, checks };
  });

  let externalCheckResults: Array<{ id: string; checks: VerificationCheck[] }>;
  try {
    externalCheckResults = await runWithConcurrencyLimit(layerTasks, MAX_CONCURRENT);
  } catch (error) {
    logger.warn('External verification APIs failed, proceeding with AI-only', {
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
  let aiResults: Map<string, VerificationCheck>;
  try {
    aiResults = await aiEvaluateWithDomainContext(refsWithDomain, topic, apiKeyOverride, model, provider);
  } catch (error) {
    logger.warn('AI evaluation failed, using external checks only', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    aiResults = new Map();
  }

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

    // Convert VerificationCheck[] → LayerResult[] for Bayesian scoring
    const layerResults: LayerResult[] = checks.map((c) => ({
      layerId: c.layer as LayerResult['layerId'],
      passed: c.passed,
      confidence: c.confidence,
    }));

    const { posterior, verdict: rawVerdict, logOddsContributions } = computeBayesianScore(domain, layerResults);

    let verdict: VerificationVerdict;

    if (rawVerdict === 'VERIFIED') {
      verdict = { status: 'VERIFIED', confidence: posterior };
    } else {
      // Check for a replacement suggestion from any layer
      const replacement = findBestReplacement(checks);
      if (replacement) {
        verdict = { status: 'REPLACED', confidence: posterior, replacement };
      } else {
        verdict = { status: 'REMOVED', confidence: posterior };
      }
    }

    results.set(ref.id, { domain, verdict, score: posterior, checks, logOddsContributions });
  }

  return { results, rejectedRefIds };
}
