'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { resumeEndpoint } from '@/app/welcome/session/resume-security';
import { useCredentialEditor } from './useCredentialEditor';
import styles from './LocalAiSettings.module.css';

interface LocalAiSettingsProps {
  initialBaseUrl: string;
  initialModel: string;
}

export function LocalAiSettings({ initialBaseUrl, initialModel }: LocalAiSettingsProps) {
  const credentials = useCredentialEditor('ai-keys');
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [savedBaseUrl, setSavedBaseUrl] = useState(initialBaseUrl);
  const [model, setModel] = useState(initialModel);
  const [savedModel, setSavedModel] = useState(initialModel);
  const [configBusy, setConfigBusy] = useState(false);
  const [configMessage, setConfigMessage] = useState('');
  const [configError, setConfigError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [keyNeedsUpdate, setKeyNeedsUpdate] = useState(false);

  const hasSavedKey = Boolean(
    credentials.snapshot?.keys.some((key) => key.provider === 'local')
  );
  const configDirty = baseUrl.trim() !== savedBaseUrl || model.trim() !== savedModel;

  async function saveServerSettings() {
    const endpoint = resumeEndpoint(baseUrl.trim());
    const modelId = model.trim();
    if (!endpoint || !modelId) {
      setConfigError('Enter a valid HTTP(S) endpoint and model ID.');
      setConfigMessage('');
      return;
    }

    setConfigBusy(true);
    setConfigError('');
    setConfigMessage('');
    try {
      const response = await fetch('/api/v1/admin/site-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiProvider: 'local', aiBaseUrl: endpoint, aiModel: modelId }),
      });
      if (!response.ok) throw new Error('Could not save the AI server settings.');

      setBaseUrl(endpoint);
      setModel(modelId);
      setSavedBaseUrl(endpoint);
      setSavedModel(modelId);
      if (endpoint !== savedBaseUrl && hasSavedKey) setKeyNeedsUpdate(true);
      setConfigMessage('AI server settings saved.');
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Could not save the AI server settings.');
    } finally {
      setConfigBusy(false);
    }
  }

  function beginKeyEdit() {
    if (credentials.begin('local')) {
      setApiKey('');
      setEditingKey(true);
    }
  }

  function finishKeyEdit() {
    setApiKey('');
    setEditingKey(false);
    setKeyNeedsUpdate(false);
  }

  async function saveKey() {
    if (!apiKey.trim()) return;
    const result = await credentials.save(
      'local',
      { values: { apiKey: apiKey.trim() } },
      savedBaseUrl
    );
    if (result?.status === 'confirmed') finishKeyEdit();
  }

  async function actOnCredentialFeedback() {
    const result = await credentials.act();
    if (result?.status === 'confirmed') finishKeyEdit();
  }

  return (
    <section className={styles.card} aria-labelledby="local-ai-settings-title">
      <div className={styles.header}>
        <h2 id="local-ai-settings-title" className={styles.title}>
          Local or OpenAI-compatible AI
        </h2>
        <p className={styles.description}>
          Configure Ollama or another compatible server. The API key is optional for keyless local
          servers.
        </p>
      </div>

      <div className={styles.fields}>
        <Input
          label="Endpoint URL"
          type="url"
          value={baseUrl}
          onChange={(event) => {
            credentials.edited();
            setApiKey('');
            setEditingKey(false);
            setBaseUrl(event.target.value);
            setConfigMessage('');
          }}
          placeholder="http://localhost:11434/v1"
          autoComplete="url"
          required
        />
        <Input
          label="Model ID"
          value={model}
          onChange={(event) => {
            credentials.edited();
            setModel(event.target.value);
            setConfigMessage('');
          }}
          placeholder="qwen3, llama3.3, or the model served by your endpoint"
          required
        />
        <div className={styles.actions}>
          <Button
            onClick={saveServerSettings}
            loading={configBusy}
            disabled={configBusy || credentials.busy || !configDirty}
          >
            Save server settings
          </Button>
          {configMessage && <span role="status">{configMessage}</span>}
          {configError && <span className={styles.error} role="alert">{configError}</span>}
        </div>
      </div>

      <div className={styles.keySection}>
        <div>
          <h3 className={styles.keyTitle}>API key</h3>
          <p className={styles.description}>
            {keyNeedsUpdate
              ? 'The endpoint changed. Save a key for the new endpoint, or remove the old key if the server does not need one.'
              : hasSavedKey
                ? 'A key is saved encrypted on this Sotto server. Enter a replacement to change it.'
                : 'No key is saved. Leave this empty when your server does not require a key.'}
          </p>
        </div>

        {!editingKey && (
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={beginKeyEdit}
              disabled={credentials.editingBlocked || credentials.busy || configDirty || configBusy}
            >
              {hasSavedKey ? 'Replace API key' : 'Add API key'}
            </Button>
            {hasSavedKey && (
              <Button
                variant="ghost"
                onClick={() => void credentials.remove('local')}
                disabled={credentials.editingBlocked || credentials.busy || configDirty || configBusy}
              >
                Remove API key
              </Button>
            )}
          </div>
        )}

        {editingKey && (
          <div className={styles.fields}>
            <Input
              label="New API key"
              type="password"
              value={apiKey}
              onChange={(event) => {
                credentials.edited();
                setApiKey(event.target.value);
              }}
              placeholder="Enter the key for this endpoint"
              autoComplete="new-password"
            />
            <div className={styles.actions}>
              <Button
                onClick={saveKey}
                loading={credentials.busy}
                disabled={credentials.busy || configDirty || configBusy || !apiKey.trim()}
              >
                Save API key
              </Button>
              <Button
                variant="ghost"
                disabled={credentials.busy}
                onClick={() => {
                  credentials.edited();
                  finishKeyEdit();
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {credentials.feedback && (
          <div className={styles.credentialFeedback}>
            <p role="status">{credentials.feedback.message}</p>
            {credentials.feedback.action && (
              <Button onClick={actOnCredentialFeedback} disabled={credentials.busy}>
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
