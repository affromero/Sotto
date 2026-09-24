import { randomUUID } from 'node:crypto';
import {
  AccessService,
  executeAccessCommand,
  parseAccessCommand,
  readLocalSetupInput,
  readLocalResetInput,
} from 'thesidedoor-core/access';
import type { PrismaClient } from '@/generated/prisma/client';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import {
  finalizeInstalledPlatform,
  prepareInstalledPlatform,
} from '@/lib/sidedoor/access/migration/platform-cutover';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

/** Local operator only. Setup never runs from HTTP requests. */
export async function runSottoAccessCommand(
  args: readonly string[],
  database: PrismaClient
): Promise<string> {
  if (args.length === 1 && args[0] === 'finalize') {
    const result = await sottoTransaction(database, finalizeInstalledPlatform, {
      timeoutMs: 60_000,
    });
    return JSON.stringify({ operation: 'finalize', ...result }, null, 2);
  }
  parseAccessCommand(args);
  const access = new AccessService({ store: new SottoAccessStore(database) });
  return executeAccessCommand(access, args, {
    setupInput: readLocalSetupInput,
    resetInput: readLocalResetInput,
    initialize: async () => {
      const instanceId = randomUUID();
      const converted = await sottoTransaction(
        database,
        (tx) => prepareInstalledPlatform(tx, instanceId),
        { timeoutMs: 60_000 }
      );
      return {
        warnings: converted.credentials
          ? [`Converted ${converted.credentials} provider credential records.`]
          : ['Configure AI credentials as the owner before enabling generation.'],
      };
    },
  });
}
