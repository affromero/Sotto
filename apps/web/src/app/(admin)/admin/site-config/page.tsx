'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

// The same server settings the onboarding wizard sets for the owner, editable here.
interface Config {
  openSignup: boolean;
  localAuth: boolean | null;
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

type InfraKey = Exclude<keyof Config, 'openSignup' | 'localAuth'>;

const GROUPS: Array<{ title: string; fields: Array<{ key: InfraKey; label: string; placeholder: string }> }> = [
  {
    title: 'AI generation',
    fields: [
      { key: 'aiProvider', label: 'Provider', placeholder: 'anthropic · openai · google · claude-code · local' },
      { key: 'aiModel', label: 'Model', placeholder: 'blank for the provider default' },
      { key: 'aiBaseUrl', label: 'Base URL', placeholder: 'http://localhost:11434/v1 (local only)' },
    ],
  },
  {
    title: 'Text to speech',
    fields: [
      { key: 'ttsProvider', label: 'Provider', placeholder: 'elevenlabs · openai · cartesia · kokoro' },
      { key: 'ttsBaseUrl', label: 'Base URL', placeholder: 'local TTS endpoint (optional)' },
    ],
  },
  {
    title: 'Speech to text',
    fields: [
      { key: 'sttProvider', label: 'Provider', placeholder: 'openai · deepgram · assemblyai · whisper' },
      { key: 'sttModel', label: 'Model', placeholder: 'optional' },
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

const LOCAL_AUTH_OPTIONS = [
  { value: 'auto', label: 'Auto (self-hosted default)' },
  { value: 'on', label: 'On (profile picker sign-in)' },
  { value: 'off', label: 'Off (OAuth sign-in)' },
];

export default function SiteConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    fetch('/api/admin/site-config')
      .then((r) => r.json())
      .then((data: Config) => {
        setCfg(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function setField(key: keyof Config, value: string | boolean | null) {
    setCfg((c) => (c ? { ...c, [key]: value } : c));
    setStatus('idle');
  }

  async function save() {
    if (!cfg) return;
    setStatus('saving');
    const infra = GROUPS.flatMap((g) => g.fields).reduce<Record<string, string | null>>((acc, f) => {
      const v = (cfg[f.key] ?? '').toString().trim();
      acc[f.key] = v === '' ? null : v;
      return acc;
    }, {});
    try {
      const res = await fetch('/api/admin/site-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openSignup: cfg.openSignup, localAuth: cfg.localAuth, ...infra }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  if (loading || !cfg) return <div className={styles.container}>Loading...</div>;

  const localAuthValue = cfg.localAuth === null ? 'auto' : cfg.localAuth ? 'on' : 'off';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Site Config</h1>
        <p className={styles.subtitle}>
          The same server settings the onboarding wizard sets, editable here. Changes take effect
          immediately. Leave a field blank to fall back to the environment variable.
        </p>
      </div>

      <h2 className={styles.sectionTitle}>Access</h2>
      <div className={styles.row}>
        <div className={styles.rowLabel}>
          <div className={styles.rowLabelText}>Open signup</div>
          <div className={styles.rowLabelDesc}>
            When enabled, anyone can sign up without a waitlist invitation.
          </div>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={cfg.openSignup}
            onChange={(e) => setField('openSignup', e.target.checked)}
          />
          <span className={styles.toggleTrack} />
          <span className={styles.toggleThumb} />
        </label>
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="localAuth">
          Local sign-in (profile picker)
        </label>
        <select
          id="localAuth"
          className={styles.select}
          value={localAuthValue}
          onChange={(e) =>
            setField('localAuth', e.target.value === 'auto' ? null : e.target.value === 'on')
          }
        >
          {LOCAL_AUTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
        <button type="button" className={styles.saveBtn} onClick={save} disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving...' : 'Save changes'}
        </button>
        {status === 'saved' && <span className={`${styles.status} ${styles.statusSaved}`}>Saved</span>}
        {status === 'error' && <span className={`${styles.status} ${styles.statusError}`}>Failed to save</span>}
      </div>
    </div>
  );
}
