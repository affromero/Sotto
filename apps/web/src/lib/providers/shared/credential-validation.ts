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
import type { Prisma } from '@/generated/prisma/client';
import type { CredentialScope } from '@/lib/sidedoor/access/state/state';
import { sidedoorStateStore } from '@/lib/sidedoor/access/state/store';
import { captureApiEndpoint, selectedApi } from './api-selection';
import { CARTESIA_TTS_API_VERSION } from './speech-contracts';

type Binding = { protocol: string; endpoint: string };
export type SottoCredentialDestination =
  | { kind: 'unsupported' }
  | {
      kind: 'api';
      binding: Binding;
      requiresEndpointReview: boolean;
      api: Omit<Parameters<typeof selectedApi>[0], 'apiKey'>;
    }
  | {
      kind: 'service';
      binding: Binding;
      service: Omit<ServiceCredentialSelection, 'credentials'>;
    };
export type SottoCredentialProbe =
  | { kind: 'unsupported' }
  | { kind: 'api'; binding: Binding; selection: SelectedApi }
  | { kind: 'service'; binding: Binding; selection: ServiceCredentialSelection };

const modalities = {
  tts: 'speech',
  stt: 'transcription',
  music: 'music',
  visual: 'visual',
  storage: 'storage',
  pricing: 'pricing',
} as const satisfies Record<Exclude<CredentialScope, 'ai'>, ProviderModality>;

/** Resolve the non-secret route before constructing a credential-bearing probe. */
export function captureSottoCredentialDestination(
  scope: CredentialScope,
  provider: string,
  configuredEndpoint?: string
): SottoCredentialDestination {
  const identity = providerIdentity(provider);
  const modality: ProviderModality =
    scope === 'ai'
      ? identity.modalities.includes('text')
        ? 'text'
        : 'transcription'
      : modalities[scope];
  if (providerCredentials(provider, modality).fields.length === 0) return { kind: 'unsupported' };

  const protocol = providerServiceProtocol(provider, modality);
  const usesService = protocol !== null && !(scope === 'ai' && modality === 'text');
  if (usesService && protocol) {
    const origin = serviceCredentialOrigin(protocol);
    const apiVersion =
      protocol === 'cartesia'
        ? scope === 'stt'
          ? '2026-03-01'
          : CARTESIA_TTS_API_VERSION
        : undefined;
    return {
      kind: 'service',
      binding: { endpoint: origin, protocol: apiVersion ? `${protocol}:${apiVersion}` : protocol },
      service: { origin, protocol, apiVersion },
    };
  }

  const requiresEndpointReview = scope === 'ai' && provider === 'local';
  const endpoint = requiresEndpointReview
    ? configuredEndpoint?.trim()
    : captureApiEndpoint(provider);
  if (!endpoint) throw new Error('Save the local AI endpoint before adding its API key.');
  const transport: SelectedApi['transport'] =
    provider === 'anthropic' ? 'anthropic' : provider === 'openai' ? 'responses' : 'compatible';
  return {
    kind: 'api',
    requiresEndpointReview,
    binding: { endpoint, protocol: transport },
    api: { endpoint, provider, transport, label: identity.label },
  };
}

/** Local destinations come from the caller's transaction, never an environment hint. */
export async function captureConfiguredSottoCredentialDestination(
  database: Prisma.TransactionClient,
  scope: CredentialScope,
  provider: string
): Promise<SottoCredentialDestination> {
  if (scope !== 'ai' || provider !== 'local')
    return captureSottoCredentialDestination(scope, provider);
  const state = await sidedoorStateStore(database).read();
  const setting = state.configuration.site?.aiBaseUrl;
  const endpoint = typeof setting === 'string' ? setting : undefined;
  return captureSottoCredentialDestination(scope, provider, endpoint);
}

/** Only this boundary adds captured credential values to an already selected route. */
export function bindSottoCredentialProbe(
  destination: SottoCredentialDestination,
  values: CredentialValues
): SottoCredentialProbe {
  if (destination.kind === 'unsupported') return { kind: 'unsupported' };
  const apiKey = typeof values.apiKey === 'string' ? values.apiKey : undefined;
  const binding = { ...destination.binding };
  if (destination.kind === 'api')
    return {
      kind: 'api',
      binding,
      selection: selectedApi({ ...destination.api, apiKey: apiKey ?? '' }),
    };
  return {
    kind: 'service',
    binding,
    selection: {
      ...destination.service,
      credentials: {
        apiKey,
        userId: typeof values.userId === 'string' ? values.userId : undefined,
      },
    },
  };
}

export function captureSottoCredentialProbe(
  scope: CredentialScope,
  provider: string,
  values: CredentialValues,
  configuredEndpoint?: string
): SottoCredentialProbe {
  return bindSottoCredentialProbe(
    captureSottoCredentialDestination(scope, provider, configuredEndpoint),
    values
  );
}

export async function captureConfiguredSottoCredentialProbe(
  database: Prisma.TransactionClient,
  scope: CredentialScope,
  provider: string,
  values: CredentialValues
): Promise<SottoCredentialProbe> {
  const fields = { ...values };
  const destination = await captureConfiguredSottoCredentialDestination(database, scope, provider);
  return bindSottoCredentialProbe(destination, fields);
}

export async function validateSottoCredentialProbe(
  probe: SottoCredentialProbe,
  signal?: AbortSignal
): Promise<CredentialValidation> {
  signal?.throwIfAborted();
  switch (probe.kind) {
    case 'unsupported':
      return {
        status: 'inconclusive',
        readiness: { action: 'configure', code: 'unsupported', checkedAt: Date.now() },
      };
    case 'service':
      return validateServiceCredentials(probe.selection, signal);
    case 'api':
      return createSelectedApiRegistry(probe.selection, { maxRetries: 0 }).validateCredentials(
        probe.selection.descriptor.id,
        signal
      );
  }
}
