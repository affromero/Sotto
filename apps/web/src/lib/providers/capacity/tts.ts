import type { SfxParams, SpeechParams, TtsProvider } from '@/lib/providers/tts';
import { openSottoSemaphore } from '@/lib/sidedoor/jobs/core/redis-semaphore';
import { logger } from '@/lib/logger';

const LEASE_TTL_MS = 120_000;
const RENEW_INTERVAL_MS = Math.floor(LEASE_TTL_MS / 3);
const WAIT_DELAYS_MS = [...Array(29).keys()].map((attempt) =>
  Math.round(Math.min(1_000 * 1.5 ** attempt, 15_000))
);

export class TtsParentStoppedError extends Error {
  constructor() {
    super('Parent execution stopped while waiting for TTS capacity');
    this.name = 'TtsParentStoppedError';
  }
}

class TtsCapacityCleanupError extends AggregateError {
  constructor(errors: readonly unknown[], cause?: unknown) {
    super(errors, 'TTS capacity ownership or cleanup could not be confirmed', { cause });
    this.name = 'TtsCapacityCleanupError';
  }
}

type DecoratorOptions = {
  resource: string;
  signal?: AbortSignal;
  onCleanupError?: (error: TtsCapacityCleanupError) => void;
};

type CapacityCallParams = (SpeechParams | SfxParams) & {
  shouldStop?: () => Promise<boolean>;
};

function combinedSignal(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

function stoppedSignalError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function isConcurrencyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|too many concurrent|concurrency limit/i.test(message);
}

function isCleanupError(error: unknown): boolean {
  return error instanceof Error && /CleanupError$/.test(error.name);
}

function notifyCleanup(
  options: DecoratorOptions,
  errors: readonly unknown[],
  cause?: unknown
): TtsCapacityCleanupError {
  const cleanupError = new TtsCapacityCleanupError(errors, cause);
  try {
    options.onCleanupError?.(cleanupError);
  } catch (observerError) {
    return new TtsCapacityCleanupError([...errors, observerError], cause);
  }
  return cleanupError;
}

async function callWithCapacity<T>(
  provider: TtsProvider,
  options: DecoratorOptions,
  params: CapacityCallParams,
  run: (signal?: AbortSignal) => Promise<T>
): Promise<T> {
  const signal = combinedSignal(options.signal, params.signal);
  if (signal?.aborted) throw stoppedSignalError(signal);
  if (params.shouldStop && (await params.shouldStop())) throw new TtsParentStoppedError();

  const limit = provider.getConcurrencyLimit
    ? await provider.getConcurrencyLimit(signal)
    : provider.providerId === 'replicate'
      ? 1
      : 5;
  let session: Awaited<ReturnType<typeof openSottoSemaphore>>;
  try {
    session = await openSottoSemaphore({
      resource: options.resource,
      limit,
      ttlMs: LEASE_TTL_MS,
    });
  } catch (error) {
    if (isCleanupError(error)) throw notifyCleanup(options, [error], error);
    if (signal?.aborted) throw stoppedSignalError(signal);
    throw error;
  }

  let acquired: boolean;
  try {
    acquired = await session.wait({
      signal,
      delaysMs: WAIT_DELAYS_MS,
      shouldStop: params.shouldStop,
    });
  } catch (error) {
    if (isCleanupError(error)) throw notifyCleanup(options, [error], error);
    if (signal?.aborted) throw stoppedSignalError(signal);
    throw error;
  }
  if (!acquired) {
    if (signal?.aborted) throw stoppedSignalError(signal);
    if (params.shouldStop && (await params.shouldStop())) throw new TtsParentStoppedError();
    throw new Error('Timed out waiting for shared TTS provider capacity');
  }

  const providerController = new AbortController();
  const operationSignal = combinedSignal(signal, providerController.signal);
  let renewalError: unknown;
  let renewalNotificationError: unknown;
  let cleanupNotified = false;
  let renewal: Promise<void> | undefined;
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing || renewalError !== undefined) return;
    renewing = true;
    renewal = session
      .renew()
      .then((owned) => {
        if (!owned) throw new Error('TTS capacity lease renewal did not confirm ownership');
      })
      .catch((error: unknown) => {
        renewalError = error;
        providerController.abort(error);
        cleanupNotified = true;
        try {
          options.onCleanupError?.(new TtsCapacityCleanupError([error], error));
        } catch (observerError) {
          renewalNotificationError = observerError;
        }
      })
      .finally(() => {
        renewing = false;
      });
  }, RENEW_INTERVAL_MS);

  let value: T | undefined;
  let primaryError: unknown;
  let failed = false;
  try {
    if (operationSignal?.aborted) throw stoppedSignalError(operationSignal);
    value = await run(operationSignal);
  } catch (error) {
    failed = true;
    primaryError = error;
  } finally {
    clearInterval(timer);
  }
  if (renewal) await renewal;
  if (signal?.aborted && !failed) {
    failed = true;
    primaryError = stoppedSignalError(signal);
  }

  const cleanupErrors: unknown[] = [];
  if (renewalError !== undefined) cleanupErrors.push(renewalError);
  if (renewalNotificationError !== undefined) cleanupErrors.push(renewalNotificationError);
  try {
    await session.release();
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (cleanupErrors.length > 0) {
    if (failed) cleanupErrors.unshift(primaryError);
    if (cleanupNotified) throw new TtsCapacityCleanupError(cleanupErrors, primaryError);
    throw notifyCleanup(options, cleanupErrors, primaryError);
  }
  if (failed) throw primaryError;
  return value as T;
}

export function decorateTtsProvider(provider: TtsProvider, options: DecoratorOptions): TtsProvider {
  const run = async <T>(
    params: CapacityCallParams,
    invoke: (signal?: AbortSignal) => Promise<T>
  ): Promise<T> => {
    try {
      return await callWithCapacity(provider, options, params, invoke);
    } catch (error) {
      if (isConcurrencyError(error) && provider.observeConcurrencyError) {
        try {
          await provider.observeConcurrencyError(
            error instanceof Error ? error.message : String(error),
            combinedSignal(options.signal, params.signal)
          );
        } catch (observationError) {
          if (
            isCleanupError(observationError) ||
            combinedSignal(options.signal, params.signal)?.aborted
          )
            throw notifyCleanup(options, [error, observationError], error);
          logger.warn('Could not update observed TTS provider concurrency', {
            providerId: provider.providerId,
          });
        }
      }
      throw error;
    }
  };

  const facade: TtsProvider = {
    providerId: provider.providerId,
    generateSpeech: (params) =>
      run(params, (signal) => provider.generateSpeech({ ...params, signal })),
    getVoiceId: (...args) => provider.getVoiceId(...args),
    getModelId: () => provider.getModelId(),
  };

  if (provider.generateSpeechWithTimestamps) {
    facade.generateSpeechWithTimestamps = (params) =>
      run(params, (signal) => provider.generateSpeechWithTimestamps!({ ...params, signal }));
  }
  if (provider.generateSoundEffect) {
    facade.generateSoundEffect = (params) =>
      run(params, (signal) => provider.generateSoundEffect!({ ...params, signal }));
  }
  if (provider.getConcurrencyLimit) {
    facade.getConcurrencyLimit = (signal) => provider.getConcurrencyLimit!(signal);
  }
  if (provider.observeConcurrencyError) {
    facade.observeConcurrencyError = (message, signal) =>
      provider.observeConcurrencyError!(message, signal);
  }
  if (provider.getLastContinuityId) {
    facade.getLastContinuityId = () => provider.getLastContinuityId!();
  }
  return facade;
}
