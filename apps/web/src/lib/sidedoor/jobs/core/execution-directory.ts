import { resolve } from 'node:path';

export function resolveSottoExecutionDirectory(): string {
  return resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.SIDEDOOR_EXECUTION_DIR || '.sotto/executions'
  );
}
