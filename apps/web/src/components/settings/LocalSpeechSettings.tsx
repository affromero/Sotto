'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { resumeEndpoint } from '@/app/welcome/session/resume-security';
import styles from './LocalSpeechSettings.module.css';

interface LocalSpeechSettingsProps {
  initialEndpoint: string;
  initialModel: string;
  initialVoices: string[];
  initialMode: 'local' | 'configured' | 'disabled';
  configuredProviderLabel: string | null;
  configuredModelLabel: string | null;
  selectedProviderLabel: string | null;
  initialUsesConfiguredProvider: boolean;
  canManageSharedSpeech: boolean;
}

export function LocalSpeechSettings({
  initialEndpoint,
  initialModel,
  initialVoices,
  initialMode,
  configuredProviderLabel,
  configuredModelLabel,
  selectedProviderLabel,
  initialUsesConfiguredProvider,
  canManageSharedSpeech,
}: LocalSpeechSettingsProps) {
  const router = useRouter();
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [model, setModel] = useState(initialModel);
  const [voices, setVoices] = useState(initialVoices.join(', '));
  const [selectedMode, setSelectedMode] = useState(initialMode);
  const [usesConfiguredProvider, setUsesConfiguredProvider] = useState(
    initialUsesConfiguredProvider && initialMode === 'configured'
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [creditsBlocked, setCreditsBlocked] = useState(false);
  const [creditProvider, setCreditProvider] = useState<string | null>(null);
  const [creditProviderLabel, setCreditProviderLabel] = useState('Speech provider');
  const [canCheckCredits, setCanCheckCredits] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/settings/local-speech', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const status: {
          provider: string | null;
          providerLabel: string;
          creditsBlocked: boolean | null;
          canCheckCredits: boolean;
        } = await response.json();
        if (!controller.signal.aborted) {
          setCreditsBlocked(status.creditsBlocked === true);
          setCreditProvider(status.provider);
          setCreditProviderLabel(status.providerLabel);
          setCanCheckCredits(status.canCheckCredits);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function checkCredits() {
    if (!creditProvider || !canCheckCredits) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/v1/settings/local-speech', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'check-credits', expectedProvider: creditProvider }),
      });
      if (!response.ok) {
        if (response.status === 402) setCreditsBlocked(true);
        throw new Error(
          response.status === 402
            ? `${creditProviderLabel} credits are still exhausted. Select local speech or disable audio to continue.`
            : `Could not verify ${creditProviderLabel} speech. Refresh Settings and check the saved key before trying again.`
        );
      }
      setCreditsBlocked(false);
      setMessage(
        `${creditProviderLabel} speech checked successfully. Your speech selection has not changed.`
      );
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not verify speech.');
    } finally {
      setBusy(false);
    }
  }

  async function save(mode: 'local' | 'configured' | 'disabled') {
    setError('');
    setMessage('');
    const voiceIds = voices.split(',').map((voice) => voice.trim());
    if (
      mode === 'local' &&
      (!resumeEndpoint(endpoint.trim()) ||
        !model.trim() ||
        voiceIds.length < 2 ||
        voiceIds.some((voice) => !voice) ||
        new Set(voiceIds).size !== voiceIds.length)
    ) {
      setError('Enter a valid HTTP(S) endpoint, model ID and at least two distinct voice IDs.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/v1/settings/local-speech', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'local'
            ? { mode, endpoint: endpoint.trim(), model: model.trim(), voices: voiceIds }
            : { mode }
        ),
      });
      if (!response.ok)
        throw new Error('Could not change the speech selection. Check the settings and try again.');
      setSelectedMode(mode);
      setUsesConfiguredProvider(mode === 'configured');
      setMessage(
        mode === 'local'
          ? 'Local speech selected for your profile.'
          : mode === 'disabled'
            ? 'Audio disabled for your profile.'
            : `${configuredProviderLabel} selected with its configured default model.`
      );
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not change the speech selection.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.root} aria-labelledby="local-speech-title">
      <h2 id="local-speech-title" className={styles.title}>
        Speech selection
      </h2>
      <p className={styles.description}>
        {canManageSharedSpeech
          ? 'Select a local speech server for your profile. Its model and voices must support your learning language. Cloud credentials stay saved.'
          : 'Use configured speech or explicitly disable audio for your profile.'}{' '}
        Speech errors are shown without switching providers.
      </p>
      <p role="status">
        {selectedMode === 'disabled'
          ? 'Audio disabled. Text learning continues; listening and speaking are skipped.'
          : selectedMode === 'local'
            ? 'Local speech is selected.'
            : usesConfiguredProvider && configuredProviderLabel
              ? `Configured speech: ${configuredProviderLabel}.`
              : selectedProviderLabel
                ? `Selected speech: ${selectedProviderLabel}.`
                : 'No speech provider selected.'}
      </p>
      {creditsBlocked && (
        <p role="alert" className={styles.error}>
          {creditProviderLabel} credits are exhausted. Audio generation is blocked for this
          provider.{' '}
          {canManageSharedSpeech && canCheckCredits
            ? 'Select local speech, disable audio, or restore credits and check them below.'
            : canManageSharedSpeech
              ? 'Select local speech or disable audio to continue. This provider does not support a credit check in Settings.'
              : 'Disable audio to continue with text learning.'}
        </p>
      )}
      {canManageSharedSpeech && (
        <div className={styles.fields}>
          <Input
            label="Speech endpoint URL"
            type="url"
            value={endpoint}
            maxLength={512}
            onChange={(event) => setEndpoint(event.target.value)}
            disabled={busy}
            helperText="Use the endpoint reachable by this Sotto server."
          />
          <Input
            label="Local speech model ID"
            value={model}
            maxLength={128}
            onChange={(event) => setModel(event.target.value)}
            disabled={busy}
          />
          <Input
            label="Local voice IDs"
            value={voices}
            maxLength={512}
            onChange={(event) => setVoices(event.target.value)}
            disabled={busy}
            helperText="Enter at least two distinct voice IDs, separated by commas."
          />
        </div>
      )}
      {canManageSharedSpeech && canCheckCredits && (
        <>
          <p className={styles.description}>
            After adding credits, check {creditProviderLabel} speech with one short audio request.
            This uses the selected account and does not change your speech selection.
          </p>
          <Button variant="secondary" onClick={() => void checkCredits()} disabled={busy}>
            Check {creditProviderLabel} credits
          </Button>
        </>
      )}
      <div className={styles.actions}>
        {canManageSharedSpeech && (
          <Button onClick={() => void save('local')} loading={busy} disabled={busy}>
            Use local speech
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => void save('configured')}
          disabled={
            busy || usesConfiguredProvider || !configuredProviderLabel || !configuredModelLabel
          }
        >
          {configuredProviderLabel ? (
            <>
              {selectedMode === 'disabled' ? 'Turn on' : 'Use'} {configuredProviderLabel} default (
              {configuredModelLabel ?? 'No compatible model'})
            </>
          ) : (
            'No configured speech provider'
          )}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void save('disabled')}
          disabled={busy || selectedMode === 'disabled'}
        >
          Disable audio
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
