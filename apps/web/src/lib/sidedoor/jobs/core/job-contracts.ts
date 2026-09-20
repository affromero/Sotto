/** Durable queue contracts implemented by this application version. */
export class SottoJobContractError extends Error {
  constructor(
    readonly code:
      | 'unsupported_contract'
      | 'queue_contract_mismatch'
      | 'invalid_payload'
      | 'index_conflict'
      | 'queue_unavailable',
    message: string
  ) {
    super(message);
    this.name = 'SottoJobContractError';
  }
}

export function sottoJobFailureCode(error: unknown): string {
  return error instanceof SottoJobContractError ? error.code : 'database_or_queue_failure';
}

export const SOTTO_DURABLE_JOB_VERSIONS: ReadonlyMap<string, readonly number[]> = new Map([
  ['content-extraction', [1]],
  ['deep-research', [1]],
  ['creative-planning', [1]],
  ['script-writing', [1]],
  ['compile-script', [1]],
  ['audio-generation', [1]],
  ['interactions', [1]],
  ['segment-regeneration', [1]],
  ['audio-stitching', [1, 2]],
  ['notifications', [1, 2, 3, 4]],
  ['key-validation', [1]],
  ['pdf-generation', [1, 2]],
  ['waveform-generation', [1]],
  ['episode-status', [1]],
  ['speaking-grading', [1]],
  ['worksheet-pdf', [1]],
  ['pricing-fetch', [1]],
]);

export function requireSottoJobVersion(handler: string, version: number): void {
  if (!SOTTO_DURABLE_JOB_VERSIONS.get(handler)?.includes(version))
    throw new SottoJobContractError('unsupported_contract', 'Unsupported durable job contract');
}

/** Accept only versioned durable references. */
export function isSottoDurableJob(job: { name: string; data: unknown }): boolean {
  return (
    job.name.includes('.v') ||
    (job.data !== null &&
      typeof job.data === 'object' &&
      ('operationId' in job.data || 'fingerprint' in job.data))
  );
}

export function validateSottoQueueContract(
  handler: string,
  job: { name: string; data: unknown }
): void {
  const version = /^(.*)\.v([0-9]+)$/.exec(job.name);
  if (!isSottoDurableJob(job))
    throw new SottoJobContractError('invalid_payload', 'Raw queue payloads are not supported');
  if (!version || version[1] !== handler || job.name !== `${handler}.v${Number(version[2])}`)
    throw new SottoJobContractError(
      'queue_contract_mismatch',
      'Durable job name does not match its queue'
    );
  requireSottoJobVersion(handler, Number(version[2]));
}
