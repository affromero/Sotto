import { PRESET_IDS } from '@sotto/maps/server';
import { getAllImageProviderMeta } from '@/lib/providers/image-registry';
import type { ImageModelOption } from '@/lib/providers/image-registry';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllAvatarProviderMeta } from '@/lib/providers/avatar-registry';
import { fetchAvatarModels } from '@/lib/avatar-cost-estimator';
import { VideoTestBench } from './VideoTestBench';
import styles from './page.module.css';

export interface ImageModelInfo {
  id: string;
  displayName: string;
  tier: ImageModelOption['tier'];
}

export interface AiProviderInfo {
  id: string;
  displayName: string;
  models: { id: string; displayName: string; tier: string }[];
}

export interface AvatarModelInfo {
  id: string;
  name: string;
  tier: 'standard' | 'premium';
  costPerMinute: number | null;
}

export interface EnvAvailability {
  anthropic: boolean;
  mapbox: boolean;
  fal: boolean;
  pexels: boolean;
}

export default async function AdminVideoTestsPage() {
  const envAvailability: EnvAvailability = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    mapbox: !!process.env.MAPBOX_ACCESS_TOKEN,
    fal: !!process.env.FAL_KEY,
    pexels: !!process.env.PEXELS_API_KEY,
  };

  const mapPresets = PRESET_IDS;

  const imageModels: ImageModelInfo[] = getAllImageProviderMeta().flatMap((p) =>
    p.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      tier: m.tier,
    }))
  );

  const aiProviders: AiProviderInfo[] = getAllAiProviderMeta()
    .filter((p) => p.platformEnvKey && !!process.env[p.platformEnvKey])
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      models: p.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        tier: m.tier,
      })),
    }));

  // Avatar models with live pricing — admin sees all (no tier filter)
  const avatarPricing = await fetchAvatarModels().catch(() => []);
  const avatarPricingMap = new Map(avatarPricing.map((m) => [m.modelId, m.costPerMinute]));
  const avatarModels: AvatarModelInfo[] = getAllAvatarProviderMeta()
    .filter((p) => !p.disabled)
    .flatMap((provider) =>
      provider.models.map((m) => ({
        id: m.id,
        name: m.displayName,
        tier: m.tier as 'standard' | 'premium',
        costPerMinute: avatarPricingMap.get(m.id) ?? null,
      }))
    );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Video Pipeline Tests</h1>
        <p className={styles.subtitle}>
          Test individual video pipeline components — visual classification, place resolution, map images, AI illustration, and stock footage
        </p>
      </div>

      <VideoTestBench
        envAvailability={envAvailability}
        mapPresets={mapPresets}
        imageModels={imageModels}
        aiProviders={aiProviders}
        avatarModels={avatarModels}
      />
    </div>
  );
}
