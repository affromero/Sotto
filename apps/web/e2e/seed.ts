import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AccessService } from 'thesidedoor-core/access';
import { prismaUnfiltered as database } from '@/lib/prisma';
import { SottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sidedoorStateStore, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sharedConfigurationValueSchema } from '@/lib/sidedoor/access/state/state';
import { defaultAutoModelConfig } from '@/lib/auto-model-config';
import { EMPTY_INFRA, serverInfraConfigSchema } from '@/lib/site-config';

async function main() {
  const directory = process.env.SOTTO_BROWSER_DIRECTORY!;
  await sottoTransaction(database, async (tx) => {
    await sottoStorageInstance(tx).initialize(randomUUID());
    await sidedoorStateStore(tx).transact((state) => {
      state.access.householdProfiles = [];
      state.configuration.site = serverInfraConfigSchema.parse({
        ...EMPTY_INFRA,
        storageProvider: 'local',
        localStorageRoot: join(directory, 'storage'),
        aiProvider: 'local',
        aiModel: 'browser-fixture',
        aiBaseUrl: `${process.env.SOTTO_BROWSER_PROVIDER}/v1`,
        sttProvider: 'local',
        sttBaseUrl: `${process.env.SOTTO_BROWSER_PROVIDER}/v1`,
        sttModel: 'browser-fixture',
      });
      state.configuration.automaticModels =
        sharedConfigurationValueSchema.parse(defaultAutoModelConfig());
      state.revision++;
    });
  });
  const access = new AccessService({ store: new SottoAccessStore(database) });
  await access.claimOwner(
    await access.issueOperatorToken(),
    'Browser learner',
    'browser test household password',
    'household'
  );
  await database.curriculum.create({
    data: {
      nativeLang: 'en',
      targetLang: 'es',
      title: 'Spanish greetings',
      lessons: {
        create: {
          level: 'A1',
          order: 1,
          slug: 'greetings',
          title: 'Greetings',
          objective: 'Greet a friend',
          grammarPoints: ['present'],
          vocabThemes: ['greetings'],
          targetVocab: [{ lemma: 'hola', gloss: 'hello' }],
        },
      },
    },
  });
}
main().finally(() => database.$disconnect());
