import { isAccessError } from 'thesidedoor-core/access';
import { prismaUnfiltered } from './prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { issueSottoPairing, redeemSottoPairing } from '@/lib/sidedoor/access/core/pairing';

export interface IssuedPairingToken {
  token: string;
  expiresAt: Date;
}

export function createPairingToken(
  sessionToken: string,
  name = 'Paired device'
): Promise<IssuedPairingToken> {
  return sottoTransaction(prismaUnfiltered, (database) =>
    issueSottoPairing(database, sessionToken, name)
  );
}

export async function redeemPairingToken(token: string) {
  try {
    return await sottoTransaction(prismaUnfiltered, (database) =>
      redeemSottoPairing(database, token)
    );
  } catch (error) {
    if (isAccessError(error) && (error.code === 'unauthorized' || error.code === 'invalid'))
      return null;
    throw error;
  }
}
