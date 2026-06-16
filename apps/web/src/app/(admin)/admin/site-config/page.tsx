'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

// The same server settings the onboarding wizard sets for the owner, editable here.
interface Config {
  aiProvider: string | null;
  aiModel: string | null;
  aiBaseUrl: string | null;
  sttProvider: string | null;
  sttModel: string | null;
  sttBaseUrl: string | null;
  ttsProvider: string | null;
  ttsBaseUrl: string | null;
  storageProvider: string | null;
  s3Bucket: string | null;
  s3Region: string | null;
}

type InfraKey = keyof Config;

const GROUPS: Array<{
  title: string;
  fields: Array<{ key: InfraKey; label: string; placeholder: string }>;
}> = [
  {
    title: 'AI generation',
    fields: [
      {
        key: 'aiProvider',
        label: 'Provider',
        placeholder: 'anthropic · openai · google · claude-code · local',
      },
      { key: 'aiModel', label: 'Model', placeholder: 'blank for the provider default' },
      {
        key: 'aiBaseUrl',
        label: 'Base URL',
        placeholder: 'http://localhost:11434/v1 (local only)',
      },
    ],
  },
  {
    title: 'Text to speech',
    fields: [
      {
        key: 'ttsProvider',
        label: 'Provider',
        placeholder: 'elevenlabs · openai · cartesia · kokoro',
      },
      { key: 'ttsBaseUrl', label: 'Base URL', placeholder: 'local TTS endpoint (optional)' },
    ],
  },
  {
    title: 'Speech to text',
    fields: [
      {
        key: 'sttProvider',
        label: 'Provider',
        placeholder: 'openai · deepgram · assemblyai · whisper',
      },
      { key: 'sttBaseUrl', label: 'Base URL', placeholder: 'local STT endpoint (optional)' },
    ],
  },
  {
    title: 'Storage',
    fields: [
      { key: 'storageProvider', label: 'Provider', placeholder: 'local · s3 · r2' },
      { key: 's3Bucket', label: 'Bucket', placeholder: 'bucket name' },
      { key: 's3Region', label: 'Region', placeholder: 'auto · us-east-1' },
    ],
  },
];

export default function SiteConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [resetStatus, setResetStatus] = useState<'idle' | 'resetting' | 'reset' | 'error'>('idle');
  const [resetBannerOpen, setResetBannerOpen] = useState(false);

  useEffect(() => {
    fetch('/api/v1/admin/site-config')
      .then((r) => r.json())
      .then((data: Config) => {
        setCfg(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function setField(key: keyof Config, value: string | boolean | null) {
    setCfg((c) => (c ? { ...c, [key]: value } : c));
    setSaveStatus('idle');
    setResetStatus('idle');
    setResetBannerOpen(false);
  }

  async function save() {
    if (!cfg) return;
    setSaveStatus('saving');
    const infra = GROUPS.flatMap((g) => g.fields).reduce<Record<string, string | null>>(
      (acc, f) => {
        const v = (cfg[f.key] ?? '').toString().trim();
        acc[f.key] = v === '' ? null : v;
        return acc;
      },
      {}
    );
    try {
      const res = await fetch('/api/v1/admin/site-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(infra),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = (await res.json()) as Config;
      setCfg(data);
      setSaveStatus('saved');
      setResetStatus('idle');
      setResetBannerOpen(false);
    } catch {
      setSaveStatus('error');
    }
  }

  async function resetToFactoryDefaults() {
    setResetStatus('resetting');
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/v1/admin/site-config', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to reset');
      const data = (await res.json()) as Config;
      setCfg(data);
      setResetStatus('reset');
      setResetBannerOpen(false);
    } catch {
      setResetStatus('error');
    }
  }

  function showResetBanner() {
    setResetBannerOpen(true);
    setResetStatus('idle');
    setSaveStatus('idle');
  }

  if (loading || !cfg) return <div className={styles.container}>Loading...</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Admin Settings</h1>
        <p className={styles.subtitle}>
          The same server settings the onboarding wizard sets, editable here. Changes take effect
          immediately. Leave a field blank to fall back to the environment variable.
        </p>
      </div>

      <section className={styles.dangerZone} aria-labelledby="factory-reset-title">
        <div>
          <h2 id="factory-reset-title" className={styles.dangerTitle}>
            Factory reset settings
          </h2>
          <p className={styles.dangerText}>
            Reset Sotto back to environment-backed server settings. This only clears admin overrides
            for AI, speech, and storage.
          </p>
        </div>
        <button
          type="button"
          className={styles.resetBtn}
          onClick={showResetBanner}
          disabled={resetStatus === 'resetting' || saveStatus === 'saving'}
          aria-expanded={resetBannerOpen}
        >
          Factory reset settings
        </button>
      </section>

      {resetBannerOpen && (
        <section
          className={styles.confirmBanner}
          aria-labelledby="factory-reset-confirm-title"
          aria-describedby="factory-reset-confirm-copy"
        >
          <div>
            <h2 id="factory-reset-confirm-title" className={styles.confirmTitle}>
              Confirm factory reset
            </h2>
            <p id="factory-reset-confirm-copy" className={styles.confirmText}>
              This clears all owner-set provider and storage overrides, then Sotto falls back to the
              matching environment variables. Learner profiles, courses, BYOK keys, generated
              lessons, and media stay untouched.
            </p>
          </div>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.confirmResetBtn}
              onClick={resetToFactoryDefaults}
              disabled={resetStatus === 'resetting'}
            >
              {resetStatus === 'resetting' ? 'Resetting...' : 'Reset admin settings'}
            </button>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setResetBannerOpen(false)}
              disabled={resetStatus === 'resetting'}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {resetStatus === 'reset' && (
        <div className={`${styles.resultBanner} ${styles.resultSuccess}`} role="status">
          Factory defaults restored. Sotto is now using environment-backed settings where available.
        </div>
      )}
      {resetStatus === 'error' && (
        <div className={`${styles.resultBanner} ${styles.resultError}`} role="status">
          Failed to reset settings.
        </div>
      )}

      {GROUPS.map((group) => (
        <section key={group.title} className={styles.group}>
          <h2 className={styles.sectionTitle}>{group.title}</h2>
          {group.fields.map((f) => (
            <div key={f.key} className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={f.key}>
                {f.label}
              </label>
              <input
                id={f.key}
                className={styles.input}
                type="text"
                value={cfg[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.key, e.target.value)}
              />
            </div>
          ))}
        </section>
      ))}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={save}
          disabled={saveStatus === 'saving' || resetStatus === 'resetting'}
        >
          {saveStatus === 'saving' ? 'Saving...' : 'Save changes'}
        </button>
        {saveStatus === 'saved' && (
          <span className={`${styles.status} ${styles.statusSaved}`}>Saved</span>
        )}
        {saveStatus === 'error' && (
          <span className={`${styles.status} ${styles.statusError}`}>Failed to save</span>
        )}
      </div>
    </div>
  );
}
