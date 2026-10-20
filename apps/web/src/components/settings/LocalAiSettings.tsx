'use client';

import { useEffect, useReducer, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { resumeEndpoint } from '@/app/welcome/session/resume-security';
import { useCredentialEditor } from './useCredentialEditor';
import { initialLocalAiState, localAiReducer, type LocalAiConfig } from './local-ai/state';
import styles from './LocalAiSettings.module.css';

interface LocalAiSettingsProps {
  initialBaseUrl: string;
  initialModel: string;
}

export function LocalAiSettings({ initialBaseUrl, initialModel }: LocalAiSettingsProps) {
  const credentials = useCredentialEditor('ai-keys');
  const [state, dispatch] = useReducer(
    localAiReducer,
    { baseUrl: initialBaseUrl, model: initialModel },
    initialLocalAiState
  );
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  const hasKey = Boolean(credentials.snapshot?.keys.some((key) => key.provider === 'local'));
  const dirty =
    state.draft.baseUrl.trim() !== state.saved.baseUrl ||
    state.draft.model.trim() !== state.saved.model;
  const blocked = state.saving || credentials.editingBlocked;
  const configBlocked =
    state.saving || credentials.busy || credentials.feedback?.action === 'reconcile';

  function edit(field: keyof LocalAiConfig, value: string) {
    credentials.edited();
    dispatch({ type: 'configure', field, value });
  }

  async function configure() {
    if (request.current || configBlocked) return;
    const baseUrl = resumeEndpoint(state.draft.baseUrl.trim());
    const model = state.draft.model.trim();
    if (!baseUrl || !model) {
      dispatch({ type: 'failed', message: 'Enter a valid HTTP(S) endpoint and model ID.' });
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    dispatch({ type: 'saving' });
    try {
      const response = await fetch('/api/v1/admin/site-config', {
        method: 'PATCH',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiProvider: 'local', aiBaseUrl: baseUrl, aiModel: model }),
      });
      controller.signal.throwIfAborted();
      if (!response.ok) throw new Error('Could not save the AI server settings.');
      if (mounted.current && request.current === controller)
        dispatch({ type: 'configured', config: { baseUrl, model }, hasKey });
    } catch (error) {
      if (mounted.current && !controller.signal.aborted)
        dispatch({
          type: 'failed',
          message:
            error instanceof Error ? error.message : 'Could not save the AI server settings.',
        });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  async function saveKey() {
    const apiKey = state.key.value.trim();
    if (!apiKey || blocked || dirty) return;
    dispatch({ type: 'key-dispatched' });
    const result = await credentials.save('local', { values: { apiKey } }, state.saved.baseUrl);
    if (mounted.current && result?.status === 'confirmed')
      dispatch({ type: 'close-key', confirmed: true });
  }

  async function checkCredential() {
    const result = await credentials.act();
    if (mounted.current && result?.status === 'confirmed')
      dispatch({ type: 'close-key', confirmed: true });
  }

  async function removeKey() {
    const result = await credentials.remove('local');
    if (mounted.current && result?.status === 'confirmed')
      dispatch({ type: 'close-key', confirmed: true });
  }

  return (
    <section className={styles.root} aria-labelledby="local-ai-settings-title">
      <header className={styles.introduction}>
        <h2 id="local-ai-settings-title">Local or OpenAI-compatible AI</h2>
        <p>
          Choose the endpoint and model served by Ollama or another compatible server. Add a key
          only if that server requires authentication.
        </p>
      </header>
      <div className={styles.fields}>
        <Input
          label="Endpoint URL"
          type="url"
          value={state.draft.baseUrl}
          disabled={configBlocked}
          required
          autoComplete="url"
          onChange={(event) => edit('baseUrl', event.target.value)}
          placeholder="http://localhost:11434/v1"
        />
        <Input
          label="Model ID"
          value={state.draft.model}
          disabled={configBlocked}
          required
          onChange={(event) => edit('model', event.target.value)}
          placeholder="Model ID reported by your server"
        />
        <div className={styles.actions}>
          <Button onClick={configure} loading={state.saving} disabled={configBlocked || !dirty}>
            Save server settings
          </Button>
          {state.message && <p role="status">{state.message}</p>}
          {state.error && (
            <p className={styles.error} role="alert">
              {state.error}
            </p>
          )}
        </div>
      </div>
      <div className={styles.credentials}>
        <h3>API key</h3>
        <p>
          {state.key.needsRebind
            ? 'The endpoint changed. Save a key for this endpoint, or remove the saved key for a keyless server.'
            : hasKey
              ? 'An encrypted key is saved. You can replace or remove it.'
              : 'This server has no saved key. Keyless servers can leave this empty.'}
        </p>
        {state.key.editing ? (
          <div className={styles.fields}>
            <Input
              label="New API key"
              type="password"
              autoComplete="new-password"
              value={state.key.value}
              disabled={blocked || dirty}
              onChange={(event) => {
                credentials.edited();
                dispatch({ type: 'key-value', value: event.target.value });
              }}
            />
            <div className={styles.actions}>
              <Button
                onClick={saveKey}
                loading={credentials.busy}
                disabled={blocked || dirty || !state.key.value.trim()}
              >
                Save API key
              </Button>
              <Button
                variant="ghost"
                disabled={credentials.busy}
                onClick={() => {
                  credentials.edited();
                  dispatch({ type: 'close-key' });
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={blocked || dirty}
              onClick={() => {
                if (credentials.begin('local')) dispatch({ type: 'edit-key' });
              }}
            >
              {hasKey ? 'Replace API key' : 'Add API key'}
            </Button>
            {hasKey && (
              <Button variant="ghost" disabled={blocked || dirty} onClick={removeKey}>
                Remove API key
              </Button>
            )}
          </div>
        )}
        {credentials.feedback && (
          <div className={styles.feedback}>
            <p role="status">{credentials.feedback.message}</p>
            {credentials.feedback.action && (
              <Button onClick={checkCredential} disabled={credentials.busy || state.saving}>
                {credentials.feedback.action === 'confirm'
                  ? 'Save without verification'
                  : credentials.feedback.action === 'reconcile'
                    ? 'Check status'
                    : 'Reload settings'}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
