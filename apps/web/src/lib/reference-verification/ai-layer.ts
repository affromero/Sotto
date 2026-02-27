import { generateResponse, WEB_SEARCH_TOOL } from '@/lib/llm';
import { logUsage } from '@/lib/usage-logger';
import { logger } from '@/lib/logger';
import type { ContentDomain } from '@sottofm/verification-standard';
import { DOMAIN_CONFIGS } from '@sottofm/verification-standard';
import type { ReferenceInput, VerificationCheck } from '@/lib/reference-validator';
import type { ClaimContext } from './claim-extractor';

/** Extract the first complete JSON object from a string that may contain surrounding text. */
function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch {}
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

export interface RefWithDomain {
  ref: ReferenceInput;
  domain: ContentDomain;
  claimContext: ClaimContext;
  priorChecks: VerificationCheck[];
}

export async function aiEvaluateWithDomainContext(
  refsWithDomain: RefWithDomain[],
  topic: string,
  apiKeyOverride?: string,
  model?: string
): Promise<Map<string, VerificationCheck>> {
  const results = new Map<string, VerificationCheck>();

  const refsContext = refsWithDomain
    .map(({ ref, domain, claimContext, priorChecks }) => {
      const domainConfig = DOMAIN_CONFIGS[domain];
      const checkSummary = priorChecks
        .map((c) => `  ${c.layer}: ${c.passed ? 'PASS' : 'FAIL'} (${c.detail})`)
        .join('\n');

      const claimSummary =
        claimContext.sentences.length > 0
          ? `  Claims citing this reference:\n${claimContext.sentences.map((s, i) => `    [${claimContext.speakerTurns[i]}] "${s}"`).join('\n')}`
          : '  No claim sentences extracted.';

      return `[${ref.number}] "${ref.title}"
  Domain: ${domain} — ${domainConfig.label}
  Domain instruction: ${domainConfig.aiInstruction}
  Authors: ${ref.authors.join(', ') || 'none'}
  Year: ${ref.year || 'unknown'}
  URL: ${ref.url || 'none'}
  DOI: ${ref.doi || 'none'}
  Type: ${ref.type}
  Prior checks:
${checkSummary}
${claimSummary}`;
    })
    .join('\n\n');

  const systemPrompt = `You are a reference verification agent. Your job is to evaluate whether references cited in a podcast script are real, verifiable sources that support the claims made about them.

For each reference, you will receive:
- The domain classification (ACADEMIC, NEWS, GOVERNMENT, GENERAL) and domain-specific verification instructions
- The exact claims from the podcast script that cite this reference
- Results from automated checks (URL resolution, DOI lookup, title search)

Evaluate each reference according to its domain instructions. The verification standard is domain-aware:
- ACADEMIC: Requires DOI/academic indexing evidence
- NEWS: Focus on outlet credibility and claim plausibility (DOI not expected)
- GOVERNMENT: Focus on official source verification
- GENERAL: High scrutiny for anonymous/unverifiable sources

## Web Search:
You have access to web search. For EVERY reference, search the web to verify it actually exists.
Search for the exact title, authors, publication venue, or URL. When suggesting replacements, search
for real sources on the same topic and provide verified URLs.

Respond in JSON format:
{
  "evaluations": [
    {
      "refNumber": 1,
      "verdict": "REAL" | "SUSPICIOUS" | "HALLUCINATED",
      "confidence": 0.0-1.0,
      "reasoning": "brief explanation",
      "suggestedReplacement": null | { "title": "...", "authors": ["..."], "year": ..., "url": "...", "doi": "..." }
    }
  ]
}`;

  const userMessage = `Topic: ${topic}

References to evaluate:

${refsContext}

Evaluate each reference according to its domain instructions. Return JSON only.`;

  try {
    const response = await generateResponse(
      systemPrompt,
      [{ role: 'user', content: userMessage }],
      {
        maxTokens: 4096,
        apiKeyOverride,
        model,
        tools: [WEB_SEARCH_TOOL],
      }
    );

    logUsage({
      service: 'anthropic',
      model: response.model,
      category: 'reference_validation',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      metadata: { refCount: refsWithDomain.length },
    });

    let parsed: ReturnType<typeof JSON.parse>;
    try {
      parsed = JSON.parse(extractFirstJsonObject(response.content));
    } catch {
      logger.warn('AI evaluation returned non-JSON response');
      for (const { ref } of refsWithDomain) {
        results.set(ref.id, {
          layer: 'ai',
          passed: false,
          confidence: 0,
          detail: 'AI evaluation returned unparseable response',
        });
      }
      return results;
    }

    const evaluations: Array<{
      refNumber: number;
      verdict: string;
      confidence: number;
      reasoning: string;
      suggestedReplacement?: {
        title: string;
        authors: string[];
        year: number | null;
        url: string | null;
        doi: string | null;
      } | null;
    }> = parsed.evaluations || [];

    for (const evaluation of evaluations) {
      const entry = refsWithDomain.find((r) => r.ref.number === evaluation.refNumber);
      if (!entry) continue;

      const passed = evaluation.verdict === 'REAL';
      const confidence = passed ? Math.min(evaluation.confidence, 0.85) : 0;

      const check: VerificationCheck = {
        layer: 'ai',
        passed,
        confidence,
        detail: `AI: ${evaluation.verdict} — ${evaluation.reasoning}`,
      };

      if (evaluation.suggestedReplacement) {
        check.replacement = {
          title: evaluation.suggestedReplacement.title,
          authors: evaluation.suggestedReplacement.authors || [],
          year: evaluation.suggestedReplacement.year ?? null,
          url: evaluation.suggestedReplacement.url ?? null,
          doi: evaluation.suggestedReplacement.doi ?? null,
          publisher: null,
        };
      }

      results.set(entry.ref.id, check);
    }

    // Fill in any refs not in the AI response
    for (const { ref } of refsWithDomain) {
      if (!results.has(ref.id)) {
        results.set(ref.id, {
          layer: 'ai',
          passed: false,
          confidence: 0,
          detail: 'AI evaluation did not include this reference',
        });
      }
    }

    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('AI reference evaluation failed', { error: message });

    for (const { ref } of refsWithDomain) {
      results.set(ref.id, {
        layer: 'ai',
        passed: false,
        confidence: 0,
        detail: `AI evaluation failed: ${message}`,
      });
    }
    return results;
  }
}
