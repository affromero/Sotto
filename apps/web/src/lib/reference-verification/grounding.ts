import { createAIProvider } from '@/lib/providers/ai';
import { loadPrompt } from '@/lib/prompt-loader';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';
import { searchTitle, type ReferenceInput, type VerificationCheck, type ReplacementData } from '@/lib/reference-validator';
import type { ContentDomain } from '@sottofm/verification-standard';
import type { ClaimContext } from './claim-extractor';

export interface GroundingInput {
  ref: ReferenceInput;
  domain: ContentDomain;
  claimContext: ClaimContext;
  allChecks: VerificationCheck[];
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
 * Build a search query from claim context and ref title.
 * Extracts key terms, truncates to ~120 chars for API limits.
 */
function buildSearchQuery(claimContext: ClaimContext, refTitle: string): string {
  const claimText = claimContext.sentences.slice(0, 2).join(' ');
  const combined = claimText || refTitle;
  // Take first ~120 chars, break at word boundary
  if (combined.length <= 120) return combined;
  const truncated = combined.slice(0, 120);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 60 ? truncated.slice(0, lastSpace) : truncated;
}

/**
 * Phase 1: Try OpenAlex for academic/educational/general refs.
 * Constructs a synthetic ReferenceInput with claim text as title.
 */
async function openAlexGrounding(
  candidates: Array<{ ref: ReferenceInput; claimContext: ClaimContext; domain: ContentDomain }>,
): Promise<Map<string, VerificationCheck>> {
  const results = new Map<string, VerificationCheck>();

  for (const { ref, claimContext, domain } of candidates) {
    if (domain !== 'ACADEMIC' && domain !== 'EDUCATIONAL' && domain !== 'GENERAL') continue;

    const query = buildSearchQuery(claimContext, ref.title);
    if (query.length < 10) continue;

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
          confidence: titleCheck.confidence * 0.8, // Discount: claim-based search, not exact title
          detail: `Grounding via OpenAlex: found "${titleCheck.replacement.title}"`,
          replacement: titleCheck.replacement,
        });
      }
    } catch (error) {
      logger.warn('OpenAlex grounding failed for ref', {
        refNumber: String(ref.number),
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

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
 * Phase 2: AI web search for remaining ungrounded refs.
 * Batch call with useWebSearch: true.
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

  const refsContext = candidates.map(({ ref, claimContext }) => {
    const claimText = claimContext.sentences.length > 0
      ? claimContext.sentences.map((s, i) => `  [${claimContext.speakerTurns[i]}] "${s}"`).join('\n')
      : '  No specific claim extracted.';

    return `[${ref.number}] Original title: "${ref.title}"
  Original URL: ${ref.url || 'none'}
  Claims:
${claimText}`;
  }).join('\n\n');

  const userMessage = `Topic: ${topic}

References that need real sources (all verification checks failed):

${refsContext}

Find one real, verifiable source per reference. Return JSON only.`;

  const AI_TIMEOUT_MS = 90_000;

  try {
    const ai = createAIProvider(provider);
    const response = await Promise.race([
      ai.generateResponse(
        systemPrompt,
        [{ role: 'user', content: userMessage }],
        {
          maxTokens: 4096,
          apiKeyOverride,
          model,
          useWebSearch: true,
        },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Grounding AI search timed out after 90s')), AI_TIMEOUT_MS),
      ),
    ]);

    logUsage({
      service: provider ?? 'anthropic',
      model: response.model,
      category: 'reference_grounding',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      metadata: { refCount: candidates.length },
    });

    let parsed: ReturnType<typeof JSON.parse>;
    try {
      parsed = JSON.parse(extractFirstJsonObject(response.content));
    } catch {
      logger.warn('Grounding AI returned non-JSON response');
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
      const entry = candidates.find((c) => c.ref.number === grounding.refNumber);
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

    return results;
  } catch (error) {
    logger.warn('AI grounding search failed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return results;
  }
}

/**
 * Main entry point: ground failed references by searching for real sources.
 *
 * Two-phase strategy:
 * 1. OpenAlex claim search (fast, free) for ACADEMIC/EDUCATIONAL/GENERAL
 * 2. AI web search for remaining ungrounded refs
 *
 * Only processes refs where needsGrounding() is true (all checks failed).
 */
export async function groundFailedReferences(
  inputs: GroundingInput[],
  topic: string,
  apiKeyOverride?: string,
  model?: string,
  provider?: string,
): Promise<Map<string, VerificationCheck>> {
  const candidates = inputs.filter((i) => needsGrounding(i.allChecks));

  if (candidates.length === 0) {
    logger.info('No references need grounding — all have at least one passing check');
    return new Map();
  }

  logger.info('Starting reference grounding', {
    total: String(inputs.length),
    needsGrounding: String(candidates.length),
  });

  // Phase 1: OpenAlex
  const openAlexResults = await openAlexGrounding(
    candidates.map((c) => ({ ref: c.ref, claimContext: c.claimContext, domain: c.domain })),
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
  for (const [id, check] of openAlexResults) {
    allResults.set(id, check);
  }
  for (const [id, check] of aiResults) {
    if (!allResults.has(id)) {
      allResults.set(id, check);
    }
  }

  logger.info('Reference grounding complete', {
    grounded: String(allResults.size),
    viaOpenAlex: String(openAlexResults.size),
    viaAI: String(aiResults.size),
  });

  return allResults;
}
