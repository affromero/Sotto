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
    } catch {
      setSaveStatus('error');
    }
  }

  async function resetToFactoryDefaults() {
    const confirmed = confirm(
      'Factory reset server settings? This clears only the admin infra overrides and falls back to environment defaults.'
    );
    if (!confirmed) return;
    setResetStatus('resetting');
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/v1/admin/site-config', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to reset');
      const data = (await res.json()) as Config;
      setCfg(data);
      setResetStatus('reset');
    } catch {
      setResetStatus('error');
    }
  }

  if (loading || !cfg) return <div className={styles.container}>Loading...</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Site Config</h1>
        <p className={styles.subtitle}>
          The same server settings the onboarding wizard sets, editable here. Changes take effect
          immediately. Leave a field blank to fall back to the environment variable.
        </p>
      </div>

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

      <section className={styles.dangerZone} aria-labelledby="factory-reset-title">
        <div>
          <h2 id="factory-reset-title" className={styles.dangerTitle}>
            Factory reset settings
          </h2>
          <p className={styles.dangerText}>
            Clear all owner-set AI, speech, and storage overrides. Learner data, keys, and generated
            lessons stay untouched.
          </p>
        </div>
        <button
          type="button"
          className={styles.resetBtn}
          onClick={resetToFactoryDefaults}
          disabled={resetStatus === 'resetting' || saveStatus === 'saving'}
        >
          {resetStatus === 'resetting' ? 'Resetting...' : 'Factory reset settings'}
        </button>
      </section>

      {resetStatus === 'reset' && (
        <span className={`${styles.status} ${styles.statusSaved}`}>Factory defaults restored</span>
      )}
      {resetStatus === 'error' && (
        <span className={`${styles.status} ${styles.statusError}`}>Failed to reset settings</span>
      )}
    </div>
  );
}
