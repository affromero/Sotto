import { prismaUnfiltered } from './prisma';
import {
  resolveSottoProfileCredential,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export type VisualCueProviderId = 'pexels';

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
