import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { runLearningMapUpgrade } from './upgrade-client';

async function main() {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string' },
      course: { type: 'string' },
      checkpoint: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const baseUrl = values['base-url'] ?? process.env.SOTTO_URL;
  const apiKey = process.env.SOTTO_API_KEY;
  if (!baseUrl || !apiKey)
    throw new Error(
      'Set SOTTO_API_KEY to an existing pairing key and provide --base-url or SOTTO_URL. Dry-run is the default; --apply adds only missing canonical rows.'
    );
  await runLearningMapUpgrade({
    baseUrl,
    apiKey,
    courseId: values.course,
    apply: values.apply,
    checkpointPath: resolve(
      values.checkpoint ??
        (values.apply
          ? '.sotto-learning-upgrade-apply.json'
          : '.sotto-learning-upgrade-preview.json')
    ),
    signal: AbortSignal.any([
      AbortSignal.timeout(3600000),
      ...['SIGINT', 'SIGTERM'].map((name) => {
        const controller = new AbortController();
        process.once(name, () => controller.abort());
        return controller.signal;
      }),
    ]),
  });
}
void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Learning-map maintenance failed.'}\n`
  );
  process.exitCode = 1;
});
