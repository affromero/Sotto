import { createHmac, randomBytes } from 'node:crypto';
import { prismaUnfiltered } from '../prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  captureSottoExecutionCredential,
  sottoExecutionCredentialFields,
} from '@/lib/sidedoor/credentials/runtime/credential-execution';
import { captureSottoProviderAdmission } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { UsageProviderContext } from './types';

const cacheSecret = randomBytes(32);

/** Establish caller authority before reading a local CLI account. */
export async function captureLocalUsageAccount<T extends object>(
  context: UsageProviderContext,
  provider: 'claude-code' | 'codex',
  readCredentials: (signal: AbortSignal) => Promise<T | null>
) {
  const signal = context.signal ?? new AbortController().signal;
  const admission = await captureSottoProviderAdmission({ ...context, credential: null, signal });
  await admission.validate(signal);
  const selected = await readCredentials(signal);
  const credentials = selected ? Object.freeze(structuredClone(selected)) : null;
  await admission.validate(signal);
  const identity = admission.identity;
  const fingerprint = (parts: readonly (string | null)[] = []) =>
    createHmac('sha256', cacheSecret)
      .update(JSON.stringify({ provider, identity, credentials, parts }))
      .digest('hex');
  return Object.freeze({ credentials, admission, signal, fingerprint });
}

/** Capture one complete account, with the same admission for HTTP and cached results. */
export async function captureUsageAccount(
  context: UsageProviderContext,
  provider: 'elevenlabs' | 'cartesia'
) {
  const capturedContext = { ...context };
  const signal = capturedContext.signal ?? new AbortController().signal;
  const credential = await sottoTransaction(
    prismaUnfiltered,
    (database) =>
      captureSottoExecutionCredential(
        database,
        capturedContext.authorize,
        'tts',
        provider,
        true,
        signal
      ),
    { signal }
  );
  const admission = await captureSottoProviderAdmission({ ...capturedContext, credential, signal });
  await admission.validate(signal);
  const resolved = credential ? sottoExecutionCredentialFields(credential) : null;
  const fields = resolved
    ? Object.freeze({
        apiKey: resolved.apiKey,
        extraData: resolved.extraData ? Object.freeze({ ...resolved.extraData }) : null,
      })
    : null;
  const selected = credential?.selected;
  const accountIdentity = {
    provider,
    identity: admission.identity,
    revision: selected?.credential.credentialRevision,
    owner: selected?.credential.owner,
    grant: selected?.sharingRevision,
    binding: credential?.binding,
    apiKey: fields?.apiKey,
    extraData: Object.entries(fields?.extraData ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  };
  return Object.freeze({
    fields,
    admission,
    signal,
    fingerprint: (parts: readonly string[] = []) =>
      createHmac('sha256', cacheSecret)
        .update(JSON.stringify([accountIdentity, parts]))
        .digest('hex'),
  });
}
