import { createAIProvider } from '@/lib/providers/ai';
import { loadPrompt } from '@/lib/prompt-loader';
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
  model?: string,
  provider?: string
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

  const systemPrompt = loadPrompt('verification/reference-verification-ai.md');

  const userMessage = `Topic: ${topic}

References to evaluate:

${refsContext}

Evaluate each reference according to its domain instructions. Return JSON only.`;

  const AI_TIMEOUT_MS = 60_000;

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
        }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI evaluation timed out after 60s')), AI_TIMEOUT_MS)
      ),
    ]);

    logUsage({
      service: provider ?? 'anthropic',
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
