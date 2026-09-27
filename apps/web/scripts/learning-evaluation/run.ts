import { parseArgs } from 'node:util';
import { createSelectedApiRegistry } from 'thesidedoor-core/ai/providers';
import { providerDescriptors } from 'thesidedoor-core/ai/catalog';
import { providerCompatibleConnection } from 'thesidedoor-core/providers/catalog';
import { evaluationCases } from './cases';
import { evaluateLearningModel } from './evaluate';

class EvaluationConfigurationError extends Error {}

async function main() {
  const { values } = parseArgs({
    options: {
      live: { type: 'boolean', default: false },
      provider: { type: 'string', default: 'meta' },
      model: { type: 'string', default: 'muse-spark-1.3' },
      'api-key-env': { type: 'string' },
      repetitions: { type: 'string', default: '2' },
    },
  });
  const descriptor = providerDescriptors().find((provider) => provider.id === values.provider);
  if (!descriptor || descriptor.transport !== 'api')
    throw new EvaluationConfigurationError('Choose a canonical hosted API provider');
  if (!descriptor.models.some((model) => model.id === values.model))
    throw new EvaluationConfigurationError('Choose a registered Standard model');
  const key = values.live && values['api-key-env'] ? process.env[values['api-key-env']] : undefined;
  if (values.live && !key)
    throw new EvaluationConfigurationError(
      'Live evaluation requires --api-key-env naming an explicitly configured credential'
    );
  let fixtureIndex = 0;
  const repetitions = Number(values.repetitions);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10)
    throw new EvaluationConfigurationError('Repetitions must be an integer from 1 to 10');
  const fixtureFetch: typeof fetch = async () => {
    const test = evaluationCases[Math.floor(fixtureIndex++ / repetitions)];
    if (!test) throw new Error('Unexpected fixture request');
    return Response.json({
      choices: [
        {
          message: { role: 'assistant', content: JSON.stringify(test.fixture) },
          finish_reason: 'stop',
        },
      ],
    });
  };
  const provider = values.provider;
  const selection =
    provider === 'anthropic'
      ? {
          transport: 'anthropic' as const,
          descriptor,
          credentials: { apiKey: key ?? 'fixture-only' },
        }
      : {
          transport: 'compatible' as const,
          descriptor,
          credentials: { apiKey: key ?? 'fixture-only' },
          requiresKey: true,
          baseUrl:
            provider === 'openai'
              ? 'https://api.openai.com/v1'
              : provider === 'google'
                ? 'https://generativelanguage.googleapis.com/v1beta/openai'
                : (providerCompatibleConnection(provider)?.baseURL ?? ''),
        };
  if (!values.live && provider !== 'meta')
    throw new EvaluationConfigurationError(
      'Fixture mode uses the Meta-compatible HTTP fixture; select --live for other providers'
    );
  const registry = createSelectedApiRegistry(selection, {
    streaming: false,
    maxRetries: 0,
    ...(!values.live ? { fetch: fixtureFetch } : {}),
  });
  const report = await evaluateLearningModel({
    registry,
    provider,
    model: values.model,
    mode: values.live ? 'live' : 'fixture',
    repetitions,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.results.some((result) => result.checksFailed.length)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // SDK errors may contain upstream response bodies. Keep credentials and diagnostics off stdout.
  process.stderr.write(
    error instanceof EvaluationConfigurationError
      ? `${error.message}\n`
      : 'Learning evaluation failed. Check provider availability and request compatibility.\n'
  );
  process.exitCode = 1;
});
