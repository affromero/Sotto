import { prismaUnfiltered } from './prisma';
import {
  listSottoProfileCredentials,
  resolveSottoProfileCredential,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import type { CredentialScope } from '@/lib/sidedoor/access/state/state';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { TtsProviderId } from './providers/tts-registry';
import type { AiProviderId } from './providers/ai-registry';

export interface ByokKeyInfo {
  provider: TtsProviderId;
  isValid: boolean;
  lastUsedAt: Date | null;
  label: string | null;
}

/**
 * Retrieve and decrypt a user's BYOK key for a specific provider.
 * Returns null if the user has no key for that provider.
 */
export async function getByokKey(
  userId: string,
  provider?: TtsProviderId | string
): Promise<string | null> {
  return (await getByokCredential(userId, provider))?.apiKey ?? null;
}

export async function getByokCredential(userId: string, provider?: TtsProviderId | string) {
  const targetProvider = provider ?? 'elevenlabs';
  return selectCredential(
    userId,
    targetProvider === 'suno' ? 'music' : 'tts',
    targetProvider,
    false
  );
}

/** Caller has already authorized this learner. Keep all fields and provenance in one snapshot. */
async function selectCredential(
  userId: string,
  scope: Exclude<CredentialScope, 'stt'>,
  provider: string | undefined,
  allowSharing: boolean
) {
  return sottoTransaction(prismaUnfiltered, async (tx) => {
    let selectedProvider = provider;
    if (selectedProvider === undefined) {
      const keys = (await listSottoProfileCredentials(tx, userId, [scope], allowSharing)).filter(
        (key) => key.credential.availability === 'enabled'
      );
      const personal = keys.filter((key) => !key.shared);
      const candidates = personal.length ? personal : keys;
      candidates.sort(
        (left, right) => left.credential.metadata.createdAt - right.credential.metadata.createdAt
      );
      selectedProvider = (
        candidates.find((key) => key.credential.provider === 'anthropic') ?? candidates[0]
      )?.credential.provider;
      if (!selectedProvider) return null;
    }
    const selected = await resolveSottoProfileCredential(
      tx,
      userId,
      scope,
      selectedProvider,
      allowSharing
    );
    if (!selected) return null;
    const { credential } = selected;
    const apiKey = credential.values.apiKey;
    if (typeof apiKey !== 'string' || !apiKey.trim())
      throw new Error('The selected provider credential has no API key');
    const storage = await sottoCredentialStorage(tx, scope, selectedProvider);
    await storage.owned.recordUse(
      { ...storage.slot, owner: credential.owner },
      credential.credentialRevision,
      Date.now()
    );
    return {
      apiKey,
      provider: selectedProvider,
      ownerUserId: selected.ownerUserId,
      shared: selected.shared,
      extraData: Object.fromEntries(
        Object.entries(credential.values)
          .filter(([field]) => field !== 'apiKey')
          .map(([field, value]) => [field, String(value)])
      ),
      provenance: {
        instanceId: selected.instanceId,
        owner: credential.owner,
        modality: credential.modality,
        provider: credential.provider,
        revision: credential.credentialRevision,
        binding: credential.binding,
        sharingRevision: selected.sharingRevision,
      },
    };
  });
}

export async function getSharedByokKey(userId: string, provider?: TtsProviderId | string) {
  const selectedProvider = provider ?? 'elevenlabs';
  return selectCredential(
    userId,
    selectedProvider === 'suno' ? 'music' : 'tts',
    selectedProvider,
    true
  );
}

/**
 * List all configured BYOK providers for a user.
 */
export async function listByokProviders(
  userId: string,
  allowSharing = false
): Promise<ByokKeyInfo[]> {
  const keys = await listProviderKeys(userId, ['tts', 'music'], allowSharing);
  return keys.map((key) => ({ ...key, provider: key.provider as TtsProviderId }));
}

async function listProviderKeys(
  userId: string,
  scopes: readonly Exclude<CredentialScope, 'stt'>[],
  allowSharing: boolean
) {
  return sottoTransaction(prismaUnfiltered, async (tx) => {
    const keys = await listSottoProfileCredentials(tx, userId, scopes, allowSharing);
    return keys.map(({ credential, shared }) => ({
      provider: credential.provider,
      isValid: credential.availability === 'enabled',
      lastUsedAt:
        credential.metadata.lastUsedAt === null ? null : new Date(credential.metadata.lastUsedAt),
      label: credential.label,
      revision: credential.credentialRevision,
      verification: credential.verification,
      shared,
    }));
  });
}

/**
 * Check if a user has any BYOK key configured.
 */
export async function hasByokKey(
  userId: string,
  provider?: TtsProviderId | string
): Promise<boolean> {
  return (await listByokProviders(userId)).some(
    (key) => key.isValid && (!provider || key.provider === provider)
  );
}

export async function hasSharedByokKey(
  userId: string,
  provider?: TtsProviderId | string
): Promise<boolean> {
  return (await listProviderKeys(userId, ['tts', 'music'], true)).some(
    (key) => key.isValid && (!provider || key.provider === provider)
  );
}

// AI (LLM) credential operations backed by Sidedoor.

export interface AiKeyInfo {
  provider: AiProviderId;
  isValid: boolean;
  lastUsedAt: Date | null;
  label: string | null;
}

/**
 * Retrieve and decrypt a user's AI BYOK key.
 * If provider is specified, returns that provider's key.
 * If not, returns the first available key (anthropic preferred).
 */
export async function getAiKey(userId: string, provider?: AiProviderId) {
  const selected = await selectCredential(userId, 'ai', provider, false);
  return selected ? { ...selected, provider: selected.provider as AiProviderId } : null;
}

export async function getSharedAiKey(userId: string, provider?: AiProviderId) {
  const selected = await selectCredential(userId, 'ai', provider, true);
  return selected ? { ...selected, provider: selected.provider as AiProviderId } : null;
}

/**
 * Check if a user has any AI BYOK key configured.
 */
export async function hasAiKey(userId: string): Promise<boolean> {
  return (await listAiProviders(userId)).some((key) => key.isValid);
}

/**
 * List all configured AI providers for a user.
 */
export async function listAiProviders(userId: string, allowSharing = false): Promise<AiKeyInfo[]> {
  const keys = await listProviderKeys(userId, ['ai'], allowSharing);
  return keys.map((key) => ({ ...key, provider: key.provider as AiProviderId }));
}
