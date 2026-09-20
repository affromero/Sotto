'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

// The same server settings the onboarding wizard sets for the owner, editable here.
interface Config {
  aiProvider: string | null;
  aiModel: string | null;
  aiBaseUrl: string | null;
  liveModel: string | null;
  sttProvider: string | null;
  sttModel: string | null;
  sttBaseUrl: string | null;
  ttsProvider: string | null;
  ttsBaseUrl: string | null;
  ttsVoices: string | null;
  storageProvider: string | null;
  localStorageRoot: string | null;
  objectStorageEndpoint: string | null;
  objectStorageBucket: string | null;
  objectStorageRegion: string | null;
  objectStoragePublicUrl: string | null;
}

type InfraKey = keyof Config;
type MigrationStatus = 'idle' | 'running' | 'done' | 'error';

interface MigrationResult {
  sourceProvider: string;
  targetProvider: string;
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  switched: boolean;
  errors: Array<{ id: string; field: string; error: string }>;
}

function isMigrationResult(
  value: MigrationResult | { error?: string } | null
): value is MigrationResult {
  return Boolean(value && 'migrated' in value && 'failed' in value);
}

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
      { key: 'liveModel', label: 'Live model', placeholder: 'Gemini Live model (optional)' },
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
      { key: 'ttsVoices', label: 'Voice IDs', placeholder: 'comma-separated local voice IDs' },
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
      { key: 'localStorageRoot', label: 'Local directory', placeholder: '.sotto/storage' },
      { key: 'objectStorageEndpoint', label: 'Object endpoint', placeholder: 'https://…' },
      { key: 'objectStorageBucket', label: 'Bucket', placeholder: 'bucket name' },
      { key: 'objectStorageRegion', label: 'Signing region', placeholder: 'auto · us-east-1' },
      { key: 'objectStoragePublicUrl', label: 'Public URL', placeholder: 'optional CDN URL' },
    ],
  },
];

export default function SiteConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus>('idle');
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const [storageAccessKeyId, setStorageAccessKeyId] = useState('');
  const [storageSecretAccessKey, setStorageSecretAccessKey] = useState('');

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
    setMigrationStatus('idle');
    setMigrationResult(null);
  }

  async function save() {
    if (!cfg) return;
    setSaveStatus('saving');
    const infra = GROUPS.filter((group) => group.title !== 'Storage')
      .flatMap((g) => g.fields)
      .reduce<Record<string, string | null>>((acc, f) => {
        const v = (cfg[f.key] ?? '').toString().trim();
        acc[f.key] = v === '' ? null : v;
        return acc;
      }, {});
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
    } catch {
      setSaveStatus('error');
    }
  }

  async function migrateStorage() {
    if (!cfg) return;
    setMigrationStatus('running');
    setMigrationResult(null);
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/v1/admin/storage/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetProvider: cfg.storageProvider || 'local',
          localStorageRoot: cfg.localStorageRoot,
          objectStorageEndpoint: cfg.objectStorageEndpoint,
          objectStorageBucket: cfg.objectStorageBucket,
          objectStorageRegion: cfg.objectStorageRegion,
          objectStoragePublicUrl: cfg.objectStoragePublicUrl,
          accessKeyId: storageAccessKeyId || undefined,
          secretAccessKey: storageSecretAccessKey || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        MigrationResult | { error?: string } | null;
      if (!res.ok || !isMigrationResult(body)) {
        throw new Error(body && 'error' in body ? body.error : 'Storage migration failed');
      }
      setMigrationResult(body);
      setMigrationStatus(body.failed > 0 ? 'error' : 'done');
      setSaveStatus(body.switched ? 'saved' : 'idle');
      if (body.switched) {
        setStorageAccessKeyId('');
        setStorageSecretAccessKey('');
      }
    } catch {
      setMigrationStatus('error');
    }
  }

  if (loading || !cfg) return <div className={styles.container}>Loading...</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Admin Settings</h1>
        <p className={styles.subtitle}>
          These are the shared settings used by web and worker processes. Provider credentials stay
          encrypted in Sidedoor. Storage changes run a verified copy before activation.
        </p>
      </div>

      {GROUPS.map((group) => (
        <section key={group.title} className={styles.group}>
          <h2 className={styles.sectionTitle}>{group.title}</h2>
          {group.title === 'Storage' && (
            <p className={styles.groupHelp}>
              Local storage uses the configured persistent directory. R2 and S3 credentials are
              encrypted and never returned to the browser.
            </p>
          )}
          {group.fields
            .filter(
              (field) =>
                group.title !== 'Storage' ||
                field.key === 'storageProvider' ||
                (cfg.storageProvider === 'local'
                  ? field.key === 'localStorageRoot'
                  : field.key !== 'localStorageRoot')
            )
            .map((f) => (
              <div key={f.key} className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={f.key}>
                  {f.label}
                </label>
                {f.key === 'storageProvider' ? (
                  <select
                    id={f.key}
                    className={styles.select}
                    value={cfg.storageProvider ?? 'local'}
                    onChange={(e) => setField(f.key, e.target.value)}
                  >
                    <option value="local">local - local disk</option>
                    <option value="r2">r2 - Cloudflare R2</option>
                    <option value="s3">s3 - AWS S3</option>
                  </select>
                ) : (
                  <input
                    id={f.key}
                    className={styles.input}
                    type="text"
                    value={cfg[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          {group.title === 'Storage' && (
            <section className={styles.migrationBox} aria-labelledby="storage-migration-title">
              {cfg.storageProvider !== 'local' && (
                <>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="storageAccessKeyId">
                      Access key ID
                    </label>
                    <input
                      id="storageAccessKeyId"
                      className={styles.input}
                      type="password"
                      autoComplete="off"
                      value={storageAccessKeyId}
                      onChange={(event) => setStorageAccessKeyId(event.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="storageSecretAccessKey">
                      Secret access key
                    </label>
                    <input
                      id="storageSecretAccessKey"
                      className={styles.input}
                      type="password"
                      autoComplete="new-password"
                      value={storageSecretAccessKey}
                      onChange={(event) => setStorageSecretAccessKey(event.target.value)}
                    />
                  </div>
                </>
              )}
              <div>
                <h3 id="storage-migration-title" className={styles.migrationTitle}>
                  Migrate existing media
                </h3>
                <p className={styles.migrationText}>
                  Copies every attributed asset, verifies its bytes, updates references, and
                  activates the destination only when the complete inventory has no blockers. Source
                  files remain available for recovery.
                </p>
              </div>
              <button
                type="button"
                className={styles.migrateBtn}
                onClick={migrateStorage}
                disabled={migrationStatus === 'running' || saveStatus === 'saving'}
              >
                {migrationStatus === 'running' ? 'Migrating...' : 'Migrate media and switch'}
              </button>
            </section>
          )}
        </section>
      ))}

      {migrationResult && (
        <div
          className={`${styles.resultBanner} ${
            migrationStatus === 'done' ? styles.resultSuccess : styles.resultError
          }`}
          role="status"
        >
          Storage migration {migrationStatus === 'done' ? 'complete' : 'finished with errors'}:{' '}
          {migrationResult.migrated} migrated, {migrationResult.skipped} skipped,{' '}
          {migrationResult.failed} failed.
        </div>
      )}
      {migrationStatus === 'error' && !migrationResult && (
        <div className={`${styles.resultBanner} ${styles.resultError}`} role="status">
          Storage migration failed.
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={save}
          disabled={saveStatus === 'saving'}
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
