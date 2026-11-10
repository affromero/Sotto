import { prismaUnfiltered } from './prisma';
import {
  resolveSottoProfileCredential,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { AccessError } from 'thesidedoor-core/access';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

export type VisualCueProviderId = 'pexels';

export async function getVisualCueKey(
  userId: string,
  provider: VisualCueProviderId,
  execution: SottoProviderExecution
): Promise<string | null> {
  if (execution.userId !== userId) throw new AccessError('forbidden');
  return sottoTransaction(
    prismaUnfiltered,
    async (tx) => {
      const actor = await execution.authorize(tx);
      if (actor.userId !== userId) throw new AccessError('forbidden');
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
    },
    { signal: execution.signal }
  );
}
