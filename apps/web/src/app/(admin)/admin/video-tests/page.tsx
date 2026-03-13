import { PRESET_IDS } from '@sotto/maps/server';
import { getAllImageProviderMeta } from '@/lib/providers/image-registry';
import type { ImageModelOption } from '@/lib/providers/image-registry';
import { VideoTestBench } from './VideoTestBench';
import styles from './page.module.css';

export interface ImageModelInfo {
  id: string;
  displayName: string;
  tier: ImageModelOption['tier'];
}

export interface EnvAvailability {
  anthropic: boolean;
  mapbox: boolean;
  fal: boolean;
  pexels: boolean;
}

export default function AdminVideoTestsPage() {
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
      />
    </div>
  );
}
