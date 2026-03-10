'use client';

import { useState, useCallback } from 'react';
import styles from './AvatarPrep.module.css';

interface DemoProject {
  id: string;
  avatarClipUrl: string | null;
}

export function AvatarPrep({ project }: { project: DemoProject }) {
  const [avatarId, setAvatarId] = useState('');
  const [narration, setNarration] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [loading, setLoading] = useState(false);

  // Derive from prop — parent re-renders with updated project on save
  const clipUrl = project.avatarClipUrl;

  const generateAvatar = useCallback(async () => {
    setLoading(true);
    await fetch(`/api/admin/demo/${project.id}/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ narrationText: narration, avatarId }),
    });
    setLoading(false);
  }, [project.id, narration, avatarId]);

  const setManualClipUrl = useCallback(async () => {
    if (!manualUrl) return;
    await fetch(`/api/admin/demo/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarClipUrl: manualUrl }),
    });
    setManualUrl('');
  }, [project.id, manualUrl]);

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>Avatar Clip</h3>

      {clipUrl ? (
        <div className={styles.preview}>
          <video src={clipUrl} controls className={styles.video} />
          <p className={styles.urlText}>{clipUrl}</p>
        </div>
      ) : (
        <p className={styles.empty}>No avatar clip yet.</p>
      )}

      <div className={styles.section}>
        <h4 className={styles.subtitle}>Generate via HeyGen/Fal</h4>
        <label className={styles.label}>
          Avatar ID
          <input
            type="text"
            className={styles.input}
            value={avatarId}
            onChange={(e) => setAvatarId(e.target.value)}
            placeholder="Avatar preset ID"
          />
        </label>
        <label className={styles.label}>
          Narration text
          <textarea
            className={styles.textarea}
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Text for the avatar to speak..."
            rows={3}
          />
        </label>
        <button
          className={styles.btn}
          onClick={generateAvatar}
          disabled={loading || !avatarId || !narration}
        >
          {loading ? 'Generating...' : 'Generate Avatar Clip'}
        </button>
      </div>

      <div className={styles.section}>
        <h4 className={styles.subtitle}>Or set URL manually</h4>
        <div className={styles.urlRow}>
          <input
            type="text"
            className={styles.input}
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="https://r2.sotto.fm/demos/avatars/..."
          />
          <button
            className={styles.btn}
            onClick={setManualClipUrl}
            disabled={!manualUrl}
          >
            Set URL
          </button>
        </div>
      </div>
    </div>
  );
}
