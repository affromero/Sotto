import { getAutoModelConfig } from '@/lib/auto-model-config';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { AutoModelForm } from './AutoModelForm';
import styles from './page.module.css';

export default async function AutoModelsPage() {
  const config = await getAutoModelConfig();

  // Include Groq for AI here (valid for auto models, unlike free-tier config page)
  const aiProviders = getAllAiProviderMeta()
    .filter((p) => p.id !== 'claude-code' && p.id !== 'deepgram' && p.id !== 'assemblyai')
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Auto Models</h1>
        <p className={styles.subtitle}>
          Configure which models &ldquo;Auto&rdquo; resolves to for each plan tier
        </p>
      </div>

      <AutoModelForm
        initialConfig={config}
        aiProviders={aiProviders}
        ttsProviders={ttsProviders}
        sttProviders={sttProviders}
      />

      <div className={styles.platformNote}>
        <strong>Platform Operations</strong> uses a dedicated AI model for internal tasks
        that run without user context. This can be more capable than the free/pro defaults.
        <ul>
          <li>Handle screening &mdash; classifying usernames as names, offensive, or OK</li>
          <li>Credential lookup &mdash; verifying participant credentials via web search</li>
        </ul>
      </div>
    </div>
  );
}
