import { prisma } from '@/lib/prisma';
import { getFreeTierConfig } from '@/lib/free-tier-config';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { ConfigForm } from './ConfigForm';
import styles from './page.module.css';

export default async function AdminConfigPage() {
  const config = await getFreeTierConfig();

  const aiProviders = getAllAiProviderMeta()
    .filter((p) => p.id !== 'groq') // Groq is STT-only
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      models: p.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        tier: m.tier,
      })),
    }));

  const ttsProviders = getAllProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
    })),
  }));

  const sttProviders = getAllSttProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
    })),
  }));

  const totalUsers = await prisma.user.count();
  const freeUsers = await prisma.user.count({
    where: { freeGenerationsUsed: { gt: 0 } },
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Free Tier Config</h1>
          <p className={styles.subtitle}>
            {freeUsers} of {totalUsers} users have used free generations
          </p>
        </div>
      </div>

      <ConfigForm
        initialConfig={config}
        aiProviders={aiProviders}
        ttsProviders={ttsProviders}
        sttProviders={sttProviders}
      />
    </div>
  );
}
