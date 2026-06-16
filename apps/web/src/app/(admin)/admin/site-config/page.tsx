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
  const [clearStatus, setClearStatus] = useState<'idle' | 'clearing' | 'cleared' | 'error'>('idle');
  const [clearBannerOpen, setClearBannerOpen] = useState(false);

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
    setClearStatus('idle');
    setClearBannerOpen(false);
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
      setClearStatus('idle');
      setClearBannerOpen(false);
    } catch {
      setSaveStatus('error');
    }
  }

  async function clearAdminOverrides() {
    setClearStatus('clearing');
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/v1/admin/site-config', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear overrides');
      const data = (await res.json()) as Config;
      setCfg(data);
      setClearStatus('cleared');
      setClearBannerOpen(false);
    } catch {
      setClearStatus('error');
    }
  }

  function showClearBanner() {
    setClearBannerOpen(true);
    setClearStatus('idle');
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

      <section className={styles.dangerZone} aria-labelledby="clear-overrides-title">
        <div>
          <h2 id="clear-overrides-title" className={styles.dangerTitle}>
            Clear admin overrides
          </h2>
          <p className={styles.dangerText}>
            Remove owner-set AI, speech, and storage selections so Sotto falls back to environment
            variables. This does not delete profiles, courses, keys, lessons, or media.
          </p>
        </div>
        <button
          type="button"
          className={styles.resetBtn}
          onClick={showClearBanner}
          disabled={clearStatus === 'clearing' || saveStatus === 'saving'}
          aria-expanded={clearBannerOpen}
        >
          Clear overrides
        </button>
      </section>

      {clearBannerOpen && (
        <section
          className={styles.confirmBanner}
          aria-labelledby="clear-overrides-confirm-title"
          aria-describedby="clear-overrides-confirm-copy"
        >
          <div>
            <h2 id="clear-overrides-confirm-title" className={styles.confirmTitle}>
              Confirm clearing overrides
            </h2>
            <p id="clear-overrides-confirm-copy" className={styles.confirmText}>
              This only clears admin infrastructure fields. The destructive factory reset is on the
              System page.
            </p>
          </div>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.confirmResetBtn}
              onClick={clearAdminOverrides}
              disabled={clearStatus === 'clearing'}
            >
              {clearStatus === 'clearing' ? 'Clearing...' : 'Clear admin overrides'}
            </button>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setClearBannerOpen(false)}
              disabled={clearStatus === 'clearing'}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {clearStatus === 'cleared' && (
        <div className={`${styles.resultBanner} ${styles.resultSuccess}`} role="status">
          Admin overrides cleared. Sotto is now using environment-backed settings where available.
        </div>
      )}
      {clearStatus === 'error' && (
        <div className={`${styles.resultBanner} ${styles.resultError}`} role="status">
          Failed to clear admin overrides.
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
          disabled={saveStatus === 'saving' || clearStatus === 'clearing'}
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
