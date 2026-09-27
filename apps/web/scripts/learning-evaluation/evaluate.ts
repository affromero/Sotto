import { z } from 'zod';
import type { ProviderRegistry, TokenUsage } from 'thesidedoor-core/ai';
import { modelPresets } from 'thesidedoor-core/ai/catalog';
import { evaluationCases, type EvaluationCase } from './cases';

export function assessLearningOutput(test: EvaluationCase, content: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return ['invalid-json'];
  }
  const parsed = test.schema.safeParse(value);
  if (!parsed.success) return ['invalid-schema'];
  return test.check(parsed.data);
}

export async function evaluateLearningModel(input: {
  registry: ProviderRegistry;
  provider: string;
  model: string;
  mode: 'fixture' | 'live';
  repetitions: number;
  signal?: AbortSignal;
}) {
  if (!Number.isInteger(input.repetitions) || input.repetitions < 1 || input.repetitions > 10)
    throw new Error('Repetitions must be an integer from 1 to 10');
  const pricing = modelPresets(input.provider).find((model) => model.id === input.model)?.pricing;
  const results = [];
  for (const test of evaluationCases) {
    for (let repetition = 0; repetition < input.repetitions; repetition++) {
      const start = performance.now();
      let content = '';
      let usage: TokenUsage = { inputTokens: null, outputTokens: null };
      let finish: string | undefined;
      for await (const event of input.registry.generate({
        provider: input.provider,
        model: input.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: test.prompt }] }],
        schema: z.toJSONSchema(test.schema),
        schemaName: test.id,
        maxOutputTokens: 4096,
        maxOutputBytes: 32768,
        timeoutMs: 120000,
        signal: input.signal,
      })) {
        if (event.type === 'text') content += event.text;
        if (event.type === 'usage') usage = event.usage;
        if (event.type === 'finish') {
          finish = event.reason;
          if (event.usage) usage = event.usage;
        }
      }
      results.push({
        case: test.id,
        repetition: repetition + 1,
        checksFailed: [
          ...assessLearningOutput(test, content),
          ...(finish !== 'complete' ? ['incomplete-generation'] : []),
        ],
        output: content,
        latencyMs: input.mode === 'live' ? Math.round(performance.now() - start) : null,
        usage: input.mode === 'live' ? usage : null,
        estimatedUncachedCostUsd:
          input.mode === 'live' &&
          pricing &&
          usage.inputTokens !== null &&
          usage.outputTokens !== null
            ? (usage.inputTokens * pricing.inputPerMTok +
                usage.outputTokens * pricing.outputPerMTok) /
              1_000_000
            : null,
      });
    }
  }
  return {
    mode: input.mode,
    provider: input.provider,
    model: input.model,
    evidence:
      input.mode === 'fixture'
        ? 'Synthetic fixture validation. No model quality, latency or cost measured.'
        : 'Synthetic prompt measurements. Manual CEFR and pedagogy review still required.',
    results,
  };
}
