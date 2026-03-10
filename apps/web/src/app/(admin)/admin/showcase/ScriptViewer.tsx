'use client';

import styles from './ScriptViewer.module.css';

interface DemoScene {
  id: string;
  order: number;
  title: string;
  narration: string;
  actions: unknown[];
  sfxConfig: unknown | null;
  providerBanner: unknown | null;
  avatarConfig: unknown | null;
  overlays: unknown | null;
  subtitles: unknown | null;
}

export function ScriptViewer({ scenes }: { scenes: DemoScene[] }) {
  if (scenes.length === 0) {
    return <p className={styles.empty}>No scenes imported yet.</p>;
  }

  return (
    <div className={styles.root}>
      {scenes.map((scene) => (
        <div key={scene.id} className={styles.card}>
          <div className={styles.header}>
            <span className={styles.order}>{scene.order + 1}</span>
            <span className={styles.title}>{scene.title}</span>
            <span className={styles.actionCount}>{(scene.actions as unknown[]).length} actions</span>
          </div>
          <p className={styles.narration}>{scene.narration}</p>
          <div className={styles.badges}>
            {!!scene.sfxConfig && <span className={styles.badge}>SFX</span>}
            {!!scene.providerBanner && <span className={styles.badge}>Banner</span>}
            {!!scene.avatarConfig && <span className={styles.badge}>Avatar</span>}
            {!!scene.overlays && <span className={styles.badge}>Overlays</span>}
            {!!scene.subtitles && <span className={styles.badge}>Subtitles</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
