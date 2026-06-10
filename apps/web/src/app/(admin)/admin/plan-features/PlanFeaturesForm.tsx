'use client';

import { useState } from 'react';
import styles from './page.module.css';
import type { PlanVoiceConfig } from '@/lib/plan-feature-config';

interface PlanFeaturesFormProps {
  initialConfig: PlanVoiceConfig;
}

export function PlanFeaturesForm({ initialConfig }: PlanFeaturesFormProps) {
  const [config, setConfig] = useState<PlanVoiceConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  function setBoolean(key: keyof PlanVoiceConfig, value: boolean) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setStatus('idle');
  }

  function setNumber(key: keyof PlanVoiceConfig, value: number) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setStatus('idle');
  }

  async function handleSave() {
    setSaving(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/admin/plan-features', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Voice Cloning */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Voice Cloning & Import</h2>
        <p className={styles.rowLabelDesc} style={{ marginBottom: 'var(--spacing-md)' }}>
          Controls voice recording uploads and ElevenLabs voice ID import. Both features share this gate.
        </p>
        <div className={styles.planColumns}>
          <div className={styles.planCard}>
            <p className={styles.planCardTitle}>Free plan</p>
            <div className={styles.planCardRows}>
              <div className={styles.planRow}>
                <span className={styles.planRowLabel}>Enabled</span>
                <Toggle
                  checked={config.freeVoiceCloningEnabled}
                  onChange={(v) => setBoolean('freeVoiceCloningEnabled', v)}
                />
              </div>
            </div>
          </div>
          <div className={styles.planCard}>
            <p className={styles.planCardTitle}>Pro plan</p>
            <div className={styles.planCardRows}>
              <div className={styles.planRow}>
                <span className={styles.planRowLabel}>Enabled</span>
                <Toggle
                  checked={config.proVoiceCloningEnabled}
                  onChange={(v) => setBoolean('proVoiceCloningEnabled', v)}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Voice Tracks */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Voice Tracks</h2>
        <p className={styles.rowLabelDesc} style={{ marginBottom: 'var(--spacing-md)' }}>
          Re-recording proposals for podcast episodes. BYOK Pro users always get unlimited tracks.
        </p>
        <div className={styles.planColumns}>
          <div className={styles.planCard}>
            <p className={styles.planCardTitle}>Free plan</p>
            <div className={styles.planCardRows}>
              <div className={styles.planRow}>
                <span className={styles.planRowLabel}>Enabled</span>
                <Toggle
                  checked={config.freeVoiceTracksEnabled}
                  onChange={(v) => setBoolean('freeVoiceTracksEnabled', v)}
                />
              </div>
              <div className={styles.planRow}>
                <span className={styles.planRowLabel}>Max tracks</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  className={styles.numberInput}
                  value={config.freeMaxVoiceTracks}
                  onChange={(e) => setNumber('freeMaxVoiceTracks', Math.max(0, parseInt(e.target.value, 10) || 0))}
                  aria-label="Free plan max voice tracks"
                />
              </div>
            </div>
          </div>
          <div className={styles.planCard}>
            <p className={styles.planCardTitle}>Pro plan</p>
            <div className={styles.planCardRows}>
              <div className={styles.planRow}>
                <span className={styles.planRowLabel}>Enabled</span>
                <Toggle
                  checked={config.proVoiceTracksEnabled}
                  onChange={(v) => setBoolean('proVoiceTracksEnabled', v)}
                />
              </div>
              <div className={styles.planRow}>
                <span className={styles.planRowLabel}>Max tracks</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  className={styles.numberInput}
                  value={config.proMaxVoiceTracks}
                  onChange={(e) => setNumber('proMaxVoiceTracks', Math.max(0, parseInt(e.target.value, 10) || 0))}
                  aria-label="Pro plan max voice tracks"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Avatar Image Controls */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Avatar Image Controls</h2>
        <p className={styles.rowLabelDesc} style={{ marginBottom: 'var(--spacing-md)' }}>
          Control avatar image uploads and AI generation. Admins always bypass these gates.
        </p>
        <div className={styles.grid}>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.rowLabelText}>User uploads enabled</div>
              <div className={styles.rowLabelDesc}>
                Allow verified users to upload their own portrait images for lip-sync avatars.
                Unverified users are still blocked even when this is on.
              </div>
            </div>
            <Toggle
              checked={config.avatarUploadsEnabled}
              onChange={(v) => setBoolean('avatarUploadsEnabled', v)}
            />
          </div>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.rowLabelText}>AI generation enabled</div>
              <div className={styles.rowLabelDesc}>
                Allow admins to generate avatar images via AI. This is admin-only regardless of this toggle.
              </div>
            </div>
            <Toggle
              checked={config.avatarGenerationEnabled}
              onChange={(v) => setBoolean('avatarGenerationEnabled', v)}
            />
          </div>
        </div>
      </section>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.saveButton}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {status === 'saved' && <span className={`${styles.status} ${styles.statusSaved}`}>Saved</span>}
        {status === 'error' && <span className={`${styles.status} ${styles.statusError}`}>Failed to save</span>}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.toggleTrack} />
      <span className={styles.toggleThumb} />
    </label>
  );
}
