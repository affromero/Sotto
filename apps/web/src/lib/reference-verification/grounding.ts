import { createAIProvider } from '@/lib/providers/ai';
import { loadPrompt } from '@/lib/prompt-loader';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';
import { searchTitle, type ReferenceInput, type VerificationCheck, type ReplacementData } from '@/lib/reference-validator';
import type { ContentDomain } from 'groundcheck';
import type { ClaimContext } from './claim-extractor';

export type GroundingReason =
  | 'all_checks_failed'
  | 'unreliable_source'
  | 'low_quality_source';

export interface GroundingInput {
  ref: ReferenceInput;
  domain: ContentDomain;
  claimContext: ClaimContext;
  allChecks: VerificationCheck[];
  reason?: GroundingReason;
}

function requireReferenceGroundingRouting(
  model?: string,
  provider?: string,
): { model: string; provider: string } {
  if (!provider || !model) {
    throw new Error('AI provider and model are required for reference grounding.');
  }
  return { model, provider };
}

/**
 * Returns true when NO check passed — external + AI all failed.
 * This means we have zero evidence the reference is real.
 */
export function needsGrounding(checks: VerificationCheck[]): boolean {
  if (checks.length === 0) return true;
  return checks.every((c) => !c.passed);
}

/**
 * Build multiple search queries from claim context, ref title, and topic.
 * Returns 1-3 queries: claim sentence, original title, and topic+keywords.
 * Each query is truncated to ~120 chars for API limits.
 */
function buildGroundingQueries(claimContext: ClaimContext, refTitle: string, topic?: string): string[] {
  const truncate = (s: string): string => {
    if (s.length <= 120) return s;
    const t = s.slice(0, 120);
    const lastSpace = t.lastIndexOf(' ');
    return lastSpace > 60 ? t.slice(0, lastSpace) : t;
  };

  const queries: string[] = [];

  // Query 1: claim sentence (best for finding supporting evidence)
  const claimText = claimContext.sentences.slice(0, 2).join(' ').trim();
  if (claimText.length >= 10) queries.push(truncate(claimText));

  // Query 2: original reference title (may find the actual source or a similar one)
  if (refTitle.length >= 10 && refTitle !== claimText) queries.push(truncate(refTitle));

  // Query 3: topic + claim keywords (broadens the search)
  if (topic && claimText.length >= 10) {
    const keywords = claimText.split(/\s+/).filter(w => w.length > 4).slice(0, 5).join(' ');
    if (keywords.length >= 10) queries.push(truncate(`${topic} ${keywords}`));
  }

  // Fallback: at least return the title
  if (queries.length === 0 && refTitle.length >= 5) queries.push(truncate(refTitle));

  return queries;
}

/**
 * Phase 1: Try OpenAlex for academic/educational/general refs.
 * Constructs a synthetic ReferenceInput with claim text as title.
 */
async function openAlexGrounding(
  candidates: Array<{ ref: ReferenceInput; claimContext: ClaimContext; domain: ContentDomain }>,
  topic?: string,
): Promise<Map<string, VerificationCheck>> {
  const results = new Map<string, VerificationCheck>();

  const eligible = candidates.filter(
    ({ domain }) => domain === 'ACADEMIC' || domain === 'EDUCATIONAL' || domain === 'GENERAL',
  );

  const tasks = eligible.map(async ({ ref, claimContext }) => {
    const queries = buildGroundingQueries(claimContext, ref.title, topic);
    if (queries.length === 0) return;

    // Try each query until one finds a result
    for (const query of queries) {
      try {
        const syntheticRef: ReferenceInput = {
          id: ref.id,
          number: ref.number,
          title: query,
          authors: [],
          year: null,
          url: null,
          doi: null,
          type: ref.type,
        };

        const titleCheck = await searchTitle(syntheticRef);

        if (titleCheck.passed && titleCheck.replacement) {
          results.set(ref.id, {
            layer: 'grounding' as VerificationCheck['layer'],
            passed: true,
            confidence: titleCheck.confidence * 0.8,
            detail: `Grounding via OpenAlex: found "${titleCheck.replacement.title}"`,
            replacement: titleCheck.replacement,
          });
          break; // Found a result, stop trying other queries
        }
      } catch (error) {
        logger.warn('OpenAlex grounding failed for ref', {
          refNumber: String(ref.number),
          query,
          error: error instanceof Error ? error.message : 'Unknown',
        });
      }
    }
  });

  await Promise.allSettled(tasks);

  return results;
}

/** Extract first JSON object from text that may contain surrounding content. */
function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch { /* not pure JSON */ }
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('Unbalanced JSON object in response');
}

/**
 * Process a single batch of AI grounding candidates.
 * Returns partial results — caller merges across batches.
 */
async function aiGroundBatch(
  batch: Array<{ ref: ReferenceInput; claimContext: ClaimContext }>,
  topic: string,
  systemPrompt: string,
  apiKeyOverride?: string,
  model?: string,
  provider?: string,
): Promise<Map<string, VerificationCheck>> {
  const routing = requireReferenceGroundingRouting(model, provider);

  const results = new Map<string, VerificationCheck>();
  const BATCH_TIMEOUT_MS = 20_000;

  const refsContext = batch.map(({ ref, claimContext }) => {
    const claimText = claimContext.sentences.length > 0
      ? claimContext.sentences.map((s, i) => `  [${claimContext.speakerTurns[i]}] "${s}"`).join('\n')
      : '  No specific claim extracted.';

    return `[${ref.number}] Original title: "${ref.title}"
  Original URL: ${ref.url || 'none'}
  Claims:
${claimText}`;
  }).join('\n\n');

  const userMessage = `Topic: ${topic}

References that need real, authoritative sources:

${refsContext}

Find one real, verifiable source per reference. Return JSON only.`;

  try {
    const ai = createAIProvider(routing.provider);
    const response = await Promise.race([
      ai.generateResponse(
        systemPrompt,
        [{ role: 'user', content: userMessage }],
        { maxTokens: 4096, apiKeyOverride, model: routing.model, useWebSearch: true },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Grounding AI batch timed out after ${BATCH_TIMEOUT_MS / 1000}s`)), BATCH_TIMEOUT_MS),
      ),
    ]);

    logUsage({
      service: routing.provider,
      model: response.model,
      category: 'reference_grounding',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      metadata: { refCount: batch.length },
    });

    let parsed: ReturnType<typeof JSON.parse>;
    try {
      parsed = JSON.parse(extractFirstJsonObject(response.content));
    } catch {
      logger.warn('Grounding AI batch returned non-JSON response');
      return results;
    }

    const groundings: Array<{
      refNumber: number;
      found: boolean;
      title: string;
      authors: string[];
      year: number | null;
      url: string | null;
      doi: string | null;
      publisher: string | null;
      reasoning: string;
    }> = parsed.groundings || [];

    for (const grounding of groundings) {
      const entry = batch.find((c) => c.ref.number === grounding.refNumber);
      if (!entry || !grounding.found) continue;

      const replacement: ReplacementData = {
        title: grounding.title,
        authors: grounding.authors || [],
        year: grounding.year ?? null,
        url: grounding.url ?? null,
        doi: grounding.doi ?? null,
        publisher: grounding.publisher ?? null,
      };

      results.set(entry.ref.id, {
        layer: 'grounding' as VerificationCheck['layer'],
        passed: true,
        confidence: 0.6,
        detail: `Grounding via AI search: "${grounding.title}" — ${grounding.reasoning}`,
        replacement,
      });
    }
  } catch (error) {
    logger.warn('AI grounding batch failed', {
      error: error instanceof Error ? error.message : 'Unknown',
      batchSize: String(batch.length),
      refNumbers: batch.map((c) => String(c.ref.number)).join(','),
    });
  }

  return results;
}

/**
 * Phase 2: AI web search for remaining ungrounded refs.
 * Processes in small batches of 3 with per-batch timeouts,
 * merging partial successes so one timeout doesn't lose everything.
 */
async function aiGroundingSearch(
  candidates: Array<{ ref: ReferenceInput; claimContext: ClaimContext }>,
  topic: string,
  apiKeyOverride?: string,
  model?: string,
  provider?: string,
): Promise<Map<string, VerificationCheck>> {
  const results = new Map<string, VerificationCheck>();
  if (candidates.length === 0) return results;

  const systemPrompt = loadPrompt('verification/reference-grounding.md');
  const BATCH_SIZE = 3;

  // Split into batches and process sequentially to respect rate limits
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await aiGroundBatch(batch, topic, systemPrompt, apiKeyOverride, model, provider);

    for (const [id, check] of batchResults) {
      results.set(id, check);
    }

    logger.info('AI grounding batch complete', {
      batch: String(Math.floor(i / BATCH_SIZE) + 1),
      totalBatches: String(Math.ceil(candidates.length / BATCH_SIZE)),
      found: String(batchResults.size),
    });
  }

  return results;
}

/**
 * Generalized grounding: search for real sources to replace flagged references.
 *
 * Two-phase strategy:
 * 1. OpenAlex claim search (fast, free) for ACADEMIC/EDUCATIONAL/GENERAL
 * 2. AI web search for remaining ungrounded refs
 *
 * Works for both:
 * - reference-validation pipeline (all checks failed → reason: 'all_checks_failed')
 * - script-verification retry loop (unreliable source → reason: 'unreliable_source')
 *
 * Callers should cap input size if needed (e.g. verification loop caps at 5).
 */
export async function groundReferenceCandidates(
  inputs: GroundingInput[],
  topic: string,
  apiKeyOverride?: string,
  model?: string,
  provider?: string,
): Promise<Map<string, VerificationCheck>> {
  const candidates = inputs;

  if (candidates.length === 0) {
    return new Map();
  }
  requireReferenceGroundingRouting(model, provider);

  logger.info('Starting reference grounding', {
    total: String(inputs.length),
    candidates: String(candidates.length),
    reasons: candidates.map((c) => c.reason ?? 'all_checks_failed').join(','),
  });

  // Phase 1: OpenAlex (multi-query, claim-based)
  const openAlexResults = await openAlexGrounding(
    candidates.map((c) => ({ ref: c.ref, claimContext: c.claimContext, domain: c.domain })),
    topic,
  );

  // Phase 2: AI search for refs not grounded by OpenAlex
  const remaining = candidates.filter((c) => !openAlexResults.has(c.ref.id));
  const aiResults = await aiGroundingSearch(
    remaining.map((c) => ({ ref: c.ref, claimContext: c.claimContext })),
    topic,
    apiKeyOverride,
    model,
    provider,
  );

  // Merge results (OpenAlex takes priority)
  const allResults = new Map<string, VerificationCheck>();
  for (const [id, check] of openAlexResults) allResults.set(id, check);
  for (const [id, check] of aiResults) {
    if (!allResults.has(id)) allResults.set(id, check);
  }

  logger.info('Reference grounding complete', {
    grounded: String(allResults.size),
    viaOpenAlex: String(openAlexResults.size),
    viaAI: String(aiResults.size),
  });

  return allResults;
}

/**
 * Legacy entry point for reference-validation pipeline.
 * Filters to refs where all checks failed, then delegates to groundReferenceCandidates.
 */
export async function groundFailedReferences(
  inputs: GroundingInput[],
  topic: string,
  apiKeyOverride?: string,
  model?: string,
  provider?: string,
): Promise<Map<string, VerificationCheck>> {
  const needsWork = inputs.filter((i) => needsGrounding(i.allChecks));
  if (needsWork.length === 0) {
    logger.info('No references need grounding — all have at least one passing check');
    return new Map();
  }
  return groundReferenceCandidates(
    needsWork.map((i) => ({ ...i, reason: 'all_checks_failed' as const })),
    topic,
    apiKeyOverride,
    model,
    provider,
  );
}
