import { prismaUnfiltered as database } from '@/lib/prisma';
import { createInitialCourse } from '@/lib/placement-course';
import { setSiteConfig } from '@/lib/site-config';
import { invalidateServerInfra } from '@/lib/server-config';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

/** Initial placement is permitted. No objective evidence or completed band is fabricated. */
export async function seedLearningMapCourse(target: 'fr' | 'ja', level: 'A1' | 'A2') {
  const user = await database.user.findFirstOrThrow();
  await database.user.update({
    where: { id: user.id },
    data: {
      hasCompletedOnboarding: true,
      preferredAiProvider: 'local',
      preferredAiModel: 'local:browser-fixture',
      preferredSttModel: 'browser-fixture',
    },
  });
  await setSiteConfig(
    {
      aiProvider: 'local',
      aiModel: 'browser-fixture',
      aiBaseUrl: `${process.env.SOTTO_BROWSER_PROVIDER}/v1`,
      ttsProvider: 'local',
      ttsBaseUrl: process.env.SOTTO_BROWSER_PROVIDER!,
      sttProvider: 'local',
      sttModel: 'browser-fixture',
      sttBaseUrl: `${process.env.SOTTO_BROWSER_PROVIDER}/v1`,
    },
    user.id
  );
  invalidateServerInfra();
  const curriculum = await database.curriculum.upsert({
    where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: target } },
    update: {},
    create: {
      nativeLang: 'en',
      targetLang: target,
      title: `${target === 'fr' ? 'French' : 'Japanese'} browser learning map`,
    },
  });
  const execution: SottoProviderExecution = {
    userId: user.id,
    authorize: async (transaction) => {
      await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
      return { userId: user.id };
    },
  };
  return sottoTransaction(database, (transaction) =>
    createInitialCourse(
      transaction,
      {
        userId: user.id,
        native: 'en',
        target,
        curriculumId: curriculum.id,
        level,
        source: 'MANUAL',
      },
      execution
    )
  );
}
