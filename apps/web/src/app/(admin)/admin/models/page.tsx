import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { ModelTestPanel } from './ModelTestPanel';
import styles from './page.module.css';

export type TestableProvider = {
  category: 'ai' | 'tts' | 'stt';
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  tier: string;
};

export default function AdminModelsPage() {
  const aiProviders: TestableProvider[] = getAllAiProviderMeta().flatMap((p) =>
    p.models.map((m) => ({
      category: 'ai' as const,
      providerId: p.id,
      providerName: p.displayName,
      modelId: m.id,
      modelName: m.displayName,
      tier: m.tier,
    }))
  );

  const ttsProviders: TestableProvider[] = getAllProviderMeta().flatMap((p) =>
    p.models.map((m) => ({
      category: 'tts' as const,
      providerId: p.id,
      providerName: p.displayName,
      modelId: m.id,
      modelName: m.displayName,
      tier: m.tier,
    }))
  );

  const sttProviders: TestableProvider[] = getAllSttProviderMeta().flatMap((p) =>
    p.models.map((m) => ({
      category: 'stt' as const,
      providerId: p.id,
      providerName: p.displayName,
      modelId: m.id,
      modelName: m.displayName,
      tier: m.tier,
    }))
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Model Tester</h1>
        <p className={styles.subtitle}>
          Smoke-test all AI, TTS, and STT models using platform API keys
        </p>
      </div>

      <ModelTestPanel
        aiProviders={aiProviders}
        ttsProviders={ttsProviders}
        sttProviders={sttProviders}
      />
    </div>
  );
}
