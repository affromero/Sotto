'use client';

import { useMemo, useState } from 'react';
import type { OnboardingConfig, StorageState } from '../WelcomeFlow';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '../components.styles';

interface Props {
  storage: StorageState;
  config: OnboardingConfig;
  demoMode: boolean;
  setStorage: (updater: (prev: StorageState) => StorageState) => void;
  onNext: () => void;
  onBack: () => void;
}

const PROVIDERS: Array<{
  id: StorageState['provider'];
  name: string;
  note: string;
  detail: string;
  icon: 'shield' | 'globe' | 'repo';
}> = [
  {
    id: 'local',
    name: 'Local disk',
    note: 'single machine, simplest setup',
    detail: 'Stores generated audio under LOCAL_STORAGE_DIR on this server.',
    icon: 'shield',
  },
  {
    id: 'r2',
    name: 'Cloudflare R2',
    note: 'self-hosted, internet-facing',
    detail: 'Uses R2 env secrets; Sotto only stores the provider choice.',
    icon: 'globe',
  },
  {
    id: 's3',
    name: 'AWS S3',
    note: 'hosted bucket or S3-compatible ops',
    detail: 'Stores bucket and region here; credentials stay in env.',
    icon: 'repo',
  },
];

interface CheckState {
  status: 'idle' | 'checking' | 'ok' | 'error';
  signature: string;
  message: string;
}

export function StepStorage({ storage, config, demoMode, setStorage, onNext, onBack }: Props) {
  const [check, setCheck] = useState<CheckState>({
    status: 'idle',
    signature: '',
    message: '',
  });
  const selected = PROVIDERS.find((provider) => provider.id === storage.provider) ?? PROVIDERS[0];
  const signature = useMemo(
    () =>
      JSON.stringify({
        provider: storage.provider,
        s3Bucket: storage.s3Bucket.trim(),
        s3Region: storage.s3Region.trim(),
      }),
    [storage.provider, storage.s3Bucket, storage.s3Region]
  );
  const stale = check.status !== 'idle' && check.signature !== signature;
  const canCheck = config.isOwner && !demoMode;
  const canContinue = demoMode || !config.isOwner || (check.status === 'ok' && !stale);

  async function runCheck() {
    setCheck({
      status: 'checking',
      signature,
      message: `Checking ${selected.name}.`,
    });
    try {
      const res = await fetch('/api/v1/onboarding/check-storage', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: storage.provider,
          s3Bucket: storage.s3Bucket,
          s3Region: storage.s3Region,
        }),
      });
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      setCheck({
        status: res.ok ? 'ok' : 'error',
        signature,
        message:
          body?.detail ??
          (res.ok ? `${selected.name} can write media.` : `${selected.name} is not ready.`),
      });
    } catch {
      setCheck({
        status: 'error',
        signature,
        message: 'Could not reach Sotto to check storage.',
      });
    }
  }

  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>05 ·</span> Storage
      </div>
      <h1 className={t.title}>
        Decide where generated audio <em>lands</em>.
      </h1>
      <p className={t.lede}>
        Listening classes are only ready after TTS audio is written to storage. Pick the storage
        path now so Sotto can fail before a paid voice call if the destination is unavailable.
      </p>

      <div className={c.voiceBlock}>
        <div className={c.voiceHead}>
          <span className={t.mlabel}>Media storage</span>
          <span className={c.voiceSub}>episode audio, segment audio, worksheets, recordings</span>
        </div>
        <div className={c.voicePills}>
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={`${c.voiceChoice} ${
                storage.provider === provider.id ? c.voiceChoiceSel : ''
              }`}
              aria-pressed={storage.provider === provider.id}
              onClick={() =>
                setStorage((prev) => ({
                  ...prev,
                  provider: provider.id,
                }))
              }
            >
              <span className={c.voiceChipText}>
                <span className={c.voiceChipName}>
                  <Glyph name={provider.icon} size={13} />
                  {provider.name}
                </span>
                <span className={c.voiceChipNote}>{provider.note}</span>
                <span className={c.vcLang}>{provider.detail}</span>
              </span>
            </button>
          ))}
        </div>

        <div className={c.voiceKey}>
          {storage.provider === 'local' ? (
            <>
              <div className={c.voiceNote}>
                <Glyph name="shield" size={13} />
                Uses <code>LOCAL_STORAGE_DIR</code>. Current default: <code>./.sotto/storage</code>.
              </div>
              <div className={c.vkNote}>
                Best for a single Mac, laptop, or private server. Back up this directory with the
                database.
              </div>
            </>
          ) : storage.provider === 'r2' ? (
            <>
              <div className={c.voiceNote}>
                <Glyph name="lock" size={13} />
                Set <code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>,{' '}
                <code>R2_SECRET_ACCESS_KEY</code>, and <code>R2_BUCKET_NAME</code> in env.
              </div>
              <div className={c.vkNote}>
                Secrets are not saved in the wizard. Restart web and workers after changing them.
              </div>
            </>
          ) : (
            <>
              <div className={c.vkRow}>
                <span className={c.vkLabel}>
                  <Glyph name="repo" size={13} /> S3 bucket
                </span>
                <input
                  className={c.vkInput}
                  value={storage.s3Bucket}
                  placeholder="sotto-storage"
                  onChange={(event) =>
                    setStorage((prev) => ({ ...prev, s3Bucket: event.target.value }))
                  }
                />
              </div>
              <div className={c.vkRow}>
                <span className={c.vkLabel}>
                  <Glyph name="globe" size={13} /> Region
                </span>
                <input
                  className={c.vkInput}
                  value={storage.s3Region}
                  placeholder="us-east-1"
                  onChange={(event) =>
                    setStorage((prev) => ({ ...prev, s3Region: event.target.value }))
                  }
                />
              </div>
              <div className={c.vkNote}>
                Credentials stay in <code>AWS_ACCESS_KEY_ID</code> and{' '}
                <code>AWS_SECRET_ACCESS_KEY</code>.
              </div>
            </>
          )}
        </div>
      </div>

      {canCheck ? (
        <section className={c.localCheck} aria-live="polite">
          <div className={c.localCheckTop}>
            <div className={c.localCheckCopy}>
              <span className={c.localCheckTitle}>
                <Glyph name={check.status === 'ok' && !stale ? 'check' : 'link'} size={14} />
                Storage write check
              </span>
              <span className={c.localCheckHint}>
                Writes and deletes a tiny file using the selected provider.
              </span>
            </div>
            <button
              type="button"
              className={c.localCheckButton}
              onClick={runCheck}
              disabled={check.status === 'checking'}
            >
              {check.status === 'checking' ? 'Checking.' : 'Check'}
            </button>
          </div>
          {check.status !== 'idle' ? (
            <div
              className={`${c.localCheckResult} ${
                check.status === 'ok' && !stale ? c.localCheckResultOk : c.localCheckResultError
              }`}
              role={check.status === 'error' || stale ? 'alert' : undefined}
            >
              {stale ? 'Storage selection changed. Run the check again.' : check.message}
            </div>
          ) : null}
        </section>
      ) : (
        <div className={c.locknote}>
          <Glyph name="lock" size={15} />
          {demoMode
            ? 'Hosted demo uses preview media only; no storage setting is saved.'
            : 'Only the owner can change server storage.'}
        </div>
      )}

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnBare}`} onClick={onBack}>
          ← Back
        </button>
        <span className={t.spacer} />
        <button className={`${t.btn} ${t.btnPrimary}`} onClick={onNext} disabled={!canContinue}>
          Continue{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
