import { getAutoModelConfig } from '@/lib/auto-model-config';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { getAllImageProviderMeta, getImageModelCost } from '@/lib/providers/image-registry';
import { fetchAvatarModels } from '@/lib/avatar-cost-estimator';
import { getAllVideoProviderMeta } from '@/lib/providers/video-registry';
import { getAllAvatarProviderMeta } from '@/lib/providers/avatar-registry';
import { getAllMusicProviderMeta } from '@/lib/providers/music-registry';
import { AutoModelForm } from './AutoModelForm';
import styles from './page.module.css';

export default async function AutoModelsPage() {
  const config = await getAutoModelConfig();

  const aiProviders = getAllAiProviderMeta()
    .filter((p) => p.id !== 'claude-code' && p.id !== 'deepgram' && p.id !== 'assemblyai')
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      models: p.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        tier: m.tier,
        price: m.pricing ? `$${m.pricing.inputPerMTok}/$${m.pricing.outputPerMTok} per MTok` : undefined,
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

  const imageProviders = getAllImageProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
      price: `$${m.costPerMegapixel}/img`,
    })),
  }));

  const videoProviders = getAllVideoProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
      price: `$${m.costPerMinute}/min`,
    })),
  }));

  const avatarPricing = await fetchAvatarModels();
  const avatarPriceMap = new Map(avatarPricing.map((m) => [m.modelId, m]));
  const imgSurcharge = getImageModelCost(config.proImageModel) * 1; // 1 MP portrait
  const LIP_SYNC_IMG_MODELS = new Set(['fal-veed-fabric-1.0', 'fal-kling-avatar-v2-pro']);

  const avatarProviders = getAllAvatarProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => {
      const pricing = avatarPriceMap.get(m.id);
      let price: string | undefined;
      if (pricing) {
        const base = `$${pricing.costPerMinute}/min`;
        price = LIP_SYNC_IMG_MODELS.has(m.id) && imgSurcharge > 0
          ? `${base} (+$${imgSurcharge}/img)`
          : base;
      }
      return {
        id: m.id,
        displayName: m.displayName,
        tier: m.tier,
        price,
      };
    }),
  }));

  const musicProviders = getAllMusicProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: 'standard' as const,
      price: `$${m.costPerTrack}/track`,
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
        imageProviders={imageProviders}
        videoProviders={videoProviders}
        avatarProviders={avatarProviders}
        musicProviders={musicProviders}
      />

      <div className={styles.platformNote}>
        <strong>Platform Operations</strong> uses a dedicated AI model for internal tasks
        that run without user context. This can be more capable than the free/pro defaults.
        <ul>
          <li>Handle screening &mdash; classifying usernames as names, offensive, or OK</li>
          <li>Credential lookup &mdash; verifying participant credentials via web search</li>
          <li>Language detection &mdash; identifying non-English input in discovery chat and scripts</li>
        </ul>
      </div>
    </div>
  );
}
