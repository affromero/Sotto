import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {
  ProviderAvailability,
  ProviderCreditsExhaustedError,
} from 'thesidedoor-core/providers/availability';
import { providerIdentity, providerCredentials } from 'thesidedoor-core/providers/catalog';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from '../../prisma';
import { isRecognizedAudio } from '../../audio-format';
import { measureTtsAudio } from '../../audio/tts-media';
import { sottoTransaction } from '../../sidedoor/access/state/transaction';
import { validateSottoExecutionCredential } from '../../sidedoor/credentials/runtime/credential-execution';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';

export { ProviderCreditsExhaustedError };

type SpeechCheck = { identity: string; active: boolean; dispatched: boolean; audioHash?: string };
const speechChecks = new AsyncLocalStorage<SpeechCheck>();
const operationFailures = new AsyncLocalStorage<{ provider?: string }>();
const MAX_ERROR_BYTES = 32 * 1024;

export function speechCreditsMessage(error: ProviderCreditsExhaustedError): string {
  return `${error.message} Restore provider credits and check speech in Settings, select local speech, or explicitly disable audio before generating.`;
}

/** Preserve the original adapter error only after this operation consumed a classified response. */
export function withSpeechAvailabilityFailure<Result>(
  operation: () => Promise<Result>,
  signal?: AbortSignal
): Promise<Result> {
  const observed: { provider?: string } = {};
  return operationFailures.run(observed, async () => {
    try {
      return await operation();
    } catch (cause) {
      signal?.throwIfAborted();
      if (observed.provider) throw new ProviderCreditsExhaustedError(observed.provider, { cause });
      throw cause;
    }
  });
}

/** Availability uses the same captured account, authority and SQL state as provider execution. */
export async function captureSpeechAvailability(
  execution: SottoProviderExecution,
  database?: Prisma.TransactionClient
) {
  const captured = execution.credential ? structuredClone(execution.credential) : null;
  const authorize = execution.authorize;
  const lifetime = execution.signal;
  if (!captured || ['local', 'kokoro'].includes(captured.provider)) return null;
  const query = async <Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>
  ): Promise<Result> => {
    const authorized = async (transaction: Prisma.TransactionClient) => {
      lifetime?.throwIfAborted();
      await validateSottoExecutionCredential(transaction, authorize, captured, lifetime);
      const result = await operation(transaction);
      lifetime?.throwIfAborted();
      return result;
    };
    return database
      ? authorized(database)
      : sottoTransaction(prismaUnfiltered, authorized, { signal: lifetime });
  };
  const registry = new ProviderAvailability({
    namespace: 'sotto-provider-availability-v1',
    instanceId: captured.selected.instanceId,
    backend: (id) => ({
      read: () =>
        query((transaction) =>
          sqlStateBackend(
            {
              query: (sql, values) =>
                transaction.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            'postgres',
            id
          ).read()
        ),
      compareAndSwap: (previous, next) =>
        query((transaction) =>
          sqlStateBackend(
            {
              query: (sql, values) =>
                transaction.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
            },
            'postgres',
            id
          ).compareAndSwap(previous, next)
        ),
    }),
  });
  const modality =
    captured.scope === 'tts'
      ? 'speech'
      : captured.scope === 'stt'
        ? 'transcription'
        : captured.scope === 'ai'
          ? providerIdentity(captured.provider).modalities.includes('text')
            ? 'text'
            : 'transcription'
          : captured.scope;
  const credential = JSON.stringify(
    Object.fromEntries(
      providerCredentials(captured.provider, modality)
        .fields.filter((field) => field.required)
        .map((field) => [field.id, captured.selected.credential.values[field.id]])
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
    )
  );
  const account = registry.captureAccount({
    provider: captured.provider,
    origin: new URL(captured.binding.endpoint).origin,
    credential,
  });
  const status = () => registry.status(account);
  const assertAvailable = () => registry.assertAvailable(account);
  const admitRequest = async (method: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    // Reads and polling settle existing work and never initiate a paid generation.
    if (method !== 'POST') return;
    const check = speechChecks.getStore();
    if (captured.scope === 'tts' && check?.identity === account.identity) {
      if (!check.active || check.dispatched)
        throw new Error('The speech availability check permits one provider request.');
      check.dispatched = true;
      return;
    }
    await assertAvailable();
    signal?.throwIfAborted();
  };
  const observeResponse = (response: Response, method: string, signal?: AbortSignal) => {
    if (method !== 'POST' || !response.body) return response;
    const check = speechChecks.getStore();
    const verifyAudio =
      response.status === 200 &&
      captured.scope === 'tts' &&
      check?.identity === account.identity &&
      check.active &&
      check.dispatched;
    if (response.ok && !verifyAudio) return response;
    let byteCount = 0;
    let chunks: Uint8Array[] = [];
    const hash = verifyAudio ? createHash('sha256') : null;
    const reader = response.body.getReader();
    let released = false;
    let canceled = false;
    const release = () => {
      if (released) return;
      released = true;
      reader.releaseLock();
    };
    const complete = async () => {
      signal?.throwIfAborted();
      if (hash && check?.active) {
        check.audioHash = hash.digest('hex');
        return;
      }
      if (response.ok || byteCount > MAX_ERROR_BYTES) return;
      const text = Buffer.concat(chunks).toString('utf8');
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* Plain provider bodies use shared policy. */
      }
      if (await registry.observeFailure(account, { status: response.status, body })) {
        const operation = operationFailures.getStore();
        if (operation) operation.provider = captured.provider;
      }
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) {
            if (canceled) return;
            await complete();
            release();
            controller.close();
            return;
          }
          const chunk = result.value;
          hash?.update(chunk);
          byteCount += chunk.byteLength;
          if (!response.ok && byteCount <= MAX_ERROR_BYTES) chunks.push(Buffer.from(chunk));
          else if (!response.ok) chunks = [];
          controller.enqueue(chunk);
        } catch (error) {
          release();
          controller.error(error);
        }
      },
      async cancel(reason) {
        canceled = true;
        try {
          await reader.cancel(reason);
        } finally {
          release();
        }
      },
    });
    const observed = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperties(observed, {
      url: { value: response.url },
      type: { value: response.type },
      redirected: { value: response.redirected },
    });
    return observed;
  };
  const recheck = async (operation: () => Promise<Buffer>, signal?: AbortSignal) => {
    const check: SpeechCheck = { identity: account.identity, active: true, dispatched: false };
    await registry.recheck(
      account,
      () =>
        speechChecks
          .run(check, async () => operation())
          .finally(() => {
            check.active = false;
          }),
      async (audio) => {
        if (
          !check.dispatched ||
          check.audioHash !== createHash('sha256').update(audio).digest('hex') ||
          !isRecognizedAudio(audio)
        )
          throw new Error('The availability check did not return authenticated speech audio.');
        const duration = await measureTtsAudio(audio, { signal });
        if (!Number.isFinite(duration) || duration <= 0)
          throw new Error('The availability check returned empty speech audio.');
      },
      signal
    );
  };
  return Object.freeze({
    provider: account.provider,
    providerLabel: providerIdentity(account.provider).label,
    status,
    assertAvailable,
    admitRequest,
    observeResponse,
    recheck,
  });
}
