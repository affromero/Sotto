import { randomUUID } from 'node:crypto';
import { AccessService, executeAccessCommand, parseAccessCommand } from 'thesidedoor-core/access';
import type { PrismaClient } from '@/generated/prisma/client';
import { defaultAutoModelConfig } from '@/lib/auto-model-config';
import { EMPTY_INFRA } from '@/lib/site-config';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sidedoorStateStore, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sharedConfigurationValueSchema } from '@/lib/sidedoor/access/state/state';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

/** Local operator only. Setup never runs from HTTP requests. */
export async function runSottoAccessCommand(
  args: readonly string[],
  database: PrismaClient
): Promise<string> {
  parseAccessCommand(args);
  const access = new AccessService({ store: new SottoAccessStore(database) });
  return executeAccessCommand(access, args, {
    initialize: async () => {
      const instanceId = randomUUID();
      await sottoTransaction(
        database,
        async (tx) => {
          await sottoStorageInstance(tx).initialize(instanceId);
          const store = sidedoorStateStore(tx);
          await store.transact((state) => {
            let changed = false;
            const firstSetup =
              state.configuration.site === null && state.configuration.automaticModels === null;
            if (state.configuration.site === null) {
              state.configuration.site = sharedConfigurationValueSchema.parse(EMPTY_INFRA);
              changed = true;
            }
            if (state.configuration.automaticModels === null) {
              state.configuration.automaticModels =
                sharedConfigurationValueSchema.parse(defaultAutoModelConfig());
              changed = true;
            }
            if (firstSetup) {
              state.access.householdPasswordHash = null;
              state.access.householdEpoch++;
              state.access.householdProfiles = [];
              changed = true;
            }
            if (changed) state.revision++;
          });
        },
        { timeoutMs: 60_000 }
      );
      return { warnings: ['Configure AI credentials as the owner before enabling generation.'] };
    },
  });
}
