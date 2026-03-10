import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { DemoStudio } from './DemoStudio';
import styles from './page.module.css';

export const metadata = { title: 'Demo Video Studio — Sotto Admin' };

export default function ShowcasePage() {
  const providers = getAllProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    qualityTier: p.qualityTier,
    defaultModel: p.defaultModel,
    models: p.models.map((m) => ({ id: m.id, displayName: m.displayName })),
  }));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Demo Video Studio</h1>
        <p className={styles.subtitle}>
          Create AI-narrated product demo videos with custom visuals and voices.
        </p>
      </div>
      <DemoStudio providers={providers} />
    </div>
  );
}
