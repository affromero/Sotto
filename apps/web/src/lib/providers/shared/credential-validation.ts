import type { CredentialValidation, CredentialValues } from 'thesidedoor-core/ai';
import { createSelectedApiRegistry, type SelectedApi } from 'thesidedoor-core/ai/providers';
import {
  providerCredentials,
  providerIdentity,
  type ProviderModality,
} from 'thesidedoor-core/providers/catalog';
import {
  providerServiceProtocol,
  serviceCredentialOrigin,
  validateServiceCredentials,
  type ServiceCredentialSelection,
} from 'thesidedoor-core/providers/service-validation';
import type { CredentialScope } from '@/lib/sidedoor/access/state/state';
import type { Prisma } from '@/generated/prisma/client';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { captureApiEndpoint, selectedApi } from '@/lib/providers/shared/api-selection';
import { CARTESIA_TTS_API_VERSION } from '@/lib/providers/shared/speech-contracts';

type Binding = { protocol: string; endpoint: string };
export type SottoCredentialProbe =
  | { kind: 'api'; binding: Binding; selection: SelectedApi }
  | { kind: 'service'; binding: Binding; selection: ServiceCredentialSelection }
  | { kind: 'unsupported' };

/** Capture product transport configuration once; provider keys never come from the environment. */
export function captureSottoCredentialProbe(
  scope: CredentialScope,
  provider: string,
  values: CredentialValues,
  configuredEndpoint?: string
): SottoCredentialProbe {
  const identity = providerIdentity(provider);
  const modality: ProviderModality =
    scope === 'ai'
      ? identity.modalities.includes('text')
        ? 'text'
        : 'transcription'
      : scope === 'tts'
        ? 'speech'
        : scope === 'stt'
          ? 'transcription'
          : scope;
  const metadata = providerCredentials(provider, modality);
  if (!metadata.fields.length) return { kind: 'unsupported' };
  const protocol = providerServiceProtocol(provider, modality);
  if (protocol && !(scope === 'ai' && modality === 'text')) {
    const endpoint = serviceCredentialOrigin(protocol);
    const apiVersion =
      protocol === 'cartesia'
        ? scope === 'stt'
          ? '2026-03-01'
          : CARTESIA_TTS_API_VERSION
        : undefined;
    return {
      kind: 'service',
      binding: { protocol: apiVersion ? `${protocol}:${apiVersion}` : protocol, endpoint },
      selection: {
        protocol,
        origin: endpoint,
        credentials: {
          apiKey: typeof values.apiKey === 'string' ? values.apiKey : undefined,
          userId: typeof values.userId === 'string' ? values.userId : undefined,
        },
        apiVersion,
      },
    };
  }
  const endpoint =
    provider === 'local' && scope === 'ai'
      ? configuredEndpoint?.trim()
      : captureApiEndpoint(provider);
  if (!endpoint) throw new Error('Save the local AI endpoint before adding its API key.');
  const transport =
    provider === 'anthropic' ? 'anthropic' : provider === 'openai' ? 'responses' : 'compatible';
  return {
    kind: 'api',
    binding: { protocol: transport, endpoint },
    selection: selectedApi({
      provider,
      label: identity.label,
      transport,
      endpoint,
      apiKey: typeof values.apiKey === 'string' ? values.apiKey : '',
    }),
  };
}

/** Local credentials bind to the authoritative URL in the caller's transaction. */
export async function captureConfiguredSottoCredentialProbe(
  database: Prisma.TransactionClient,
  scope: CredentialScope,
  provider: string,
  values: CredentialValues
): Promise<SottoCredentialProbe> {
  const endpoint =
    provider === 'local' && scope === 'ai'
      ? (await sidedoorStateStore(database).read()).configuration.site?.aiBaseUrl
      : undefined;
  return captureSottoCredentialProbe(
    scope,
    provider,
    values,
    typeof endpoint === 'string' ? endpoint : undefined
  );
}

export async function validateSottoCredentialProbe(
  probe: SottoCredentialProbe,
  signal?: AbortSignal
): Promise<CredentialValidation> {
  signal?.throwIfAborted();
  if (probe.kind === 'unsupported')
    return {
      status: 'inconclusive',
      readiness: { code: 'unsupported', checkedAt: Date.now(), action: 'configure' },
    };
  if (probe.kind === 'service') return validateServiceCredentials(probe.selection, signal);
  return createSelectedApiRegistry(probe.selection, { maxRetries: 0 }).validateCredentials(
    probe.selection.descriptor.id,
    signal
  );
}
