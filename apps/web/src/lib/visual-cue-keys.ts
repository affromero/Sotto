import { prismaUnfiltered } from './prisma';
import {
  listSottoProfileCredentials,
  resolveSottoProfileCredential,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export type VisualCueProviderId = 'pexels';

export interface VisualCueKeyInfo {
  provider: VisualCueProviderId;
  isValid: boolean;
  lastUsedAt: Date | null;
  label: string | null;
}

export function isValidVisualCueProviderId(provider: string): provider is VisualCueProviderId {
  return provider === 'pexels';
}

export async function getVisualCueKey(
  userId: string,
  provider: VisualCueProviderId
): Promise<string | null> {
  return sottoTransaction(prismaUnfiltered, async (tx) => {
    const selected = await resolveSottoProfileCredential(tx, userId, 'visual', provider, true);
    if (!selected) return null;
    const { credential } = selected;
    const apiKey = credential.values.apiKey;
    if (typeof apiKey !== 'string' || !apiKey.trim())
      throw new Error('The visual provider credential has no API key');
    const storage = await sottoCredentialStorage(tx, 'visual', provider);
    await storage.owned.recordUse(
      { ...storage.slot, owner: credential.owner },
      credential.credentialRevision,
      Date.now()
    );
    return apiKey;
  });
}

export async function listVisualCueKeys(userId: string): Promise<VisualCueKeyInfo[]> {
  const keys = await sottoTransaction(prismaUnfiltered, (tx) =>
    listSottoProfileCredentials(tx, userId, ['visual'], true)
  );
  return keys
    .map(({ credential }) => credential)
    .flatMap((key) => {
      if (!isValidVisualCueProviderId(key.provider)) return [];
      return [
        {
          provider: key.provider,
          isValid: key.availability === 'enabled',
          lastUsedAt: key.metadata.lastUsedAt === null ? null : new Date(key.metadata.lastUsedAt),
          label: key.label,
        },
      ];
    });
}
