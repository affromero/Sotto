import {
  classifyReference,
  computeBayesianScore,
  type ContentDomain,
  type LayerResult,
} from 'groundcheck';
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
import { extractClaimContexts, type ClaimContext } from './claim-extractor';
import { aiEvaluateWithDomainContext } from './ai-layer';
import { groundFailedReferences, type GroundingInput } from './grounding';

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
  apiKeyOverride?: string,
  model?: string,
  provider?: string,
  requiredRefCount = Infinity
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
  let aiResults: Map<string, VerificationCheck>;
  try {
    aiResults = await aiEvaluateWithDomainContext(
      refsWithDomain,
      topic,
      apiKeyOverride,
      model,
      provider
    );
  } catch (error) {
    logger.warn('AI claim-support evaluation failed; affected references will fail closed', {
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

  // Early-exit: skip grounding if we already have enough verified refs
  let skipGrounding = false;
  if (requiredRefCount < Infinity) {
    let preliminaryPassCount = 0;
    for (const ref of acceptedRefs) {
      const domain = domainMap.get(ref.id)!;
      const checks = allChecks.get(ref.id) ?? [];
      const layerResults: LayerResult[] = checks
        .filter((c) => c.layer !== 'grounding')
        .map((c) => ({
          layerId: c.layer as LayerResult['layerId'],
          passed: c.passed,
          confidence: c.confidence,
        }));
      const { verdict } = computeBayesianScore(domain, layerResults);
      if (verdict === 'VERIFIED') preliminaryPassCount++;
    }
    if (preliminaryPassCount >= requiredRefCount) {
      skipGrounding = true;
      logger.info('Skipping grounding — enough refs already verified', {
        verified: String(preliminaryPassCount),
        required: String(requiredRefCount),
      });
    }
  }

  // Grounding step: search for real sources for refs where all checks failed
  if (!skipGrounding) {
    const groundingInputs: GroundingInput[] = acceptedRefs.map((ref) => ({
      ref,
      domain: domainMap.get(ref.id)!,
      claimContext: claimContexts.get(ref.number) ?? { sentences: [], speakerTurns: [] },
      allChecks: allChecks.get(ref.id) ?? [],
    }));
    const groundingResults = await groundFailedReferences(
      groundingInputs,
      topic,
      apiKeyOverride,
      model,
      provider
    );
    for (const [refId, check] of groundingResults) {
      const existing = allChecks.get(refId) ?? [];
      existing.push(check);
      allChecks.set(refId, existing);
    }
  }

  // Compute domain-aware verdicts
  for (const ref of acceptedRefs) {
    const domain = domainMap.get(ref.id)!;
    const checks = allChecks.get(ref.id) ?? [];

    // Convert VerificationCheck[] → LayerResult[] for Bayesian scoring
    // Filter out grounding layer — it only provides replacement data, not a scoring signal
    const layerResults: LayerResult[] = checks
      .filter((c) => c.layer !== 'grounding')
      .map((c) => ({
        layerId: c.layer as LayerResult['layerId'],
        passed: c.passed,
        confidence: c.confidence,
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
      // Replacement suggestions are evidence for an editorial retry, not proof
      // that the current numbered citation supports its claims. Fail closed and
      // require the script/references to be regenerated and re-verified.
      verdict = { status: 'REMOVED', confidence: posterior };
    }

    results.set(ref.id, { domain, verdict, score: posterior, checks, logOddsContributions });
  }

  return { results, rejectedRefIds, claimContexts };
}
