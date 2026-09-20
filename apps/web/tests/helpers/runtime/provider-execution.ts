import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

/** Unit fixtures must stop at their provider boundary, never issue an authenticated request. */
export function blockedProviderExecution(userId: string): SottoProviderExecution {
  return {
    userId,
    authorize: async () => {
      throw new Error('Provider execution escaped the unit test boundary');
    },
  };
}
