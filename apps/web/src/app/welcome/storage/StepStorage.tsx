'use client';

import { useMemo, useState } from 'react';
import type { OnboardingConfig, StorageState } from '../WelcomeFlow';
import { Glyph } from '../Glyph';
import t from '../theme.module.css';
import c from '@/app/welcome/components.styles';

interface Props {
  storage: StorageState;
  config: OnboardingConfig;
  demoMode: boolean;
  setStorage: (updater: (previous: StorageState) => StorageState) => void;
  onNext: () => void;
  onBack: () => void;
}

const PROVIDERS = [
  {
    id: 'local',
    name: 'Local disk',
    note: 'single machine, simplest setup',
    detail: 'Uses a persistent directory selected here.',
    icon: 'shield',
  },
  {
    id: 'r2',
    name: 'Cloudflare R2',
    note: 'internet-facing object storage',
    detail: 'Sidedoor encrypts the instance credential and captures each use.',
    icon: 'globe',
  },
  {
    id: 's3',
    name: 'AWS S3',
    note: 'managed object storage',
    detail: 'Sidedoor encrypts the instance credential and captures each use.',
    icon: 'repo',
  },
] as const;

interface CheckState {
  status: 'idle' | 'checking' | 'ok' | 'error';
  signature: string;
  message: string;
}

function StorageInput(props: {
  label: string;
  value: string;
  placeholder: string;
  secret?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={c.vkRow}>
      <span className={c.vkLabel}>{props.label}</span>
      <input
        className={c.vkInput}
        type={props.secret ? 'password' : 'text'}
        autoComplete="off"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

export function StepStorage({ storage, config, demoMode, setStorage, onNext, onBack }: Props) {
  const [check, setCheck] = useState<CheckState>({
    status: 'idle',
    signature: '',
    message: '',
  });
  const selected = PROVIDERS.find((provider) => provider.id === storage.provider) ?? PROVIDERS[0];
  const signature = useMemo(() => JSON.stringify(storage), [storage]);
  const stale = check.status !== 'idle' && check.signature !== signature;
  const canCheck = config.isOwner && !demoMode;
  const canContinue = demoMode || !config.isOwner || (check.status === 'ok' && !stale);
  const update = (field: keyof StorageState, value: string) =>
    setStorage((previous) => ({ ...previous, [field]: value }));

  async function runCheck() {
    setCheck({ status: 'checking', signature, message: `Checking ${selected.name}.` });
    try {
      const response = await fetch('/api/v1/onboarding/check-storage', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: storage.provider,
          localStorageRoot: storage.localRoot,
          endpoint: storage.endpoint,
          bucket: storage.bucket,
          region: storage.region,
          publicUrl: storage.publicUrl || null,
          accessKeyId: storage.accessKeyId,
          secretAccessKey: storage.secretAccessKey,
        }),
      });
      const body = (await response.json().catch(() => null)) as { detail?: string } | null;
      setCheck({
        status: response.ok ? 'ok' : 'error',
        signature,
        message:
          body?.detail ??
          (response.ok ? `${selected.name} can write media.` : `${selected.name} is not ready.`),
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
        Sotto verifies the destination before a paid voice call. Object-store secrets are encrypted
        with the same Sidedoor credential system as model providers.
      </p>

      <div className={c.voiceBlock}>
        <div className={c.voiceHead}>
          <span className={t.mlabel}>Media storage</span>
          <span className={c.voiceSub}>episode audio, worksheets, recordings</span>
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
              onClick={() => setStorage((previous) => ({ ...previous, provider: provider.id }))}
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
              <StorageInput
                label="Storage directory"
                value={storage.localRoot}
                placeholder=".sotto/storage"
                onChange={(value) => update('localRoot', value)}
              />
              <div className={c.vkNote}>
                Use a persistent, backed-up directory shared by web and worker containers.
              </div>
            </>
          ) : (
            <>
              <StorageInput
                label="S3 endpoint"
                value={storage.endpoint}
                placeholder={
                  storage.provider === 'r2'
                    ? 'https://ACCOUNT.r2.cloudflarestorage.com'
                    : 'https://s3.us-east-1.amazonaws.com'
                }
                onChange={(value) => update('endpoint', value)}
              />
              <StorageInput
                label="Bucket"
                value={storage.bucket}
                placeholder="sotto-storage"
                onChange={(value) => update('bucket', value)}
              />
              <StorageInput
                label="Region"
                value={storage.region}
                placeholder={storage.provider === 'r2' ? 'auto' : 'us-east-1'}
                onChange={(value) => update('region', value)}
              />
              <StorageInput
                label="Public URL (optional)"
                value={storage.publicUrl}
                placeholder="https://media.example.com"
                onChange={(value) => update('publicUrl', value)}
              />
              <StorageInput
                label="Access key ID"
                value={storage.accessKeyId}
                placeholder="Access key ID"
                secret
                onChange={(value) => update('accessKeyId', value)}
              />
              <StorageInput
                label="Secret access key"
                value={storage.secretAccessKey}
                placeholder="Secret access key"
                secret
                onChange={(value) => update('secretAccessKey', value)}
              />
              <div className={c.vkNote}>
                The browser sends these once over your authenticated connection. Sidedoor stores
                encrypted values and never returns them to the page.
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
              <span className={c.localCheckHint}>Writes, reads, and deletes a tiny probe.</span>
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
