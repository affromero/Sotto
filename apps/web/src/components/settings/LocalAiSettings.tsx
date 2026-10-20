'use client';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useLocalAiController } from './local-ai/useLocalAiController';
import styles from './LocalAiSettings.module.css';

interface Props {
  initialBaseUrl: string;
  initialModel: string;
}

const actions = {
  confirm: 'Save without verification',
  reconcile: 'Check status',
  reload: 'Reload settings',
};

export function LocalAiSettings({ initialBaseUrl, initialModel }: Props) {
  const connection = useLocalAiController({ baseUrl: initialBaseUrl, model: initialModel });
  const { state, feedback } = connection;
  const keyDescription = state.key.needsRebind
    ? 'This address needs a key bound to it. Replace the saved key, or remove it to use the server without a key.'
    : connection.hasKey
      ? 'A key is stored for this server. Its value is never shown here.'
      : 'Authentication is optional. Add a key if your server requires one.';

  return (
    <section className={styles.root} aria-labelledby="local-ai-settings-title">
      <header className={styles.heading}>
        <h2 id="local-ai-settings-title">Compatible AI connection</h2>
        <p>Save a model server address and model, then configure its optional authentication.</p>
      </header>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void connection.saveConfiguration();
        }}
      >
        <fieldset className={styles.group} disabled={connection.configurationBlocked}>
          <legend>Model server</legend>
          <div className={styles.fields}>
            <Input
              label="Endpoint URL"
              type="url"
              autoComplete="url"
              required
              value={state.draft.baseUrl}
              onChange={(event) => connection.change('baseUrl', event.target.value)}
              placeholder="http://localhost:11434/v1"
            />
            <Input
              label="Model ID"
              autoComplete="off"
              required
              value={state.draft.model}
              onChange={(event) => connection.change('model', event.target.value)}
              placeholder="The model served at this address"
            />
          </div>
          <div className={styles.actions}>
            <Button
              type="submit"
              loading={state.saving}
              disabled={!connection.dirty || connection.configurationBlocked}
            >
              Save server settings
            </Button>
            {state.message && <p role="status">{state.message}</p>}
          </div>
          {state.error && (
            <p className={styles.error} role="alert">
              {state.error}
            </p>
          )}
        </fieldset>
      </form>

      <div className={styles.key}>
        <div className={styles.heading}>
          <h3>Connection key</h3>
          <p>{keyDescription}</p>
        </div>
        {state.key.editing ? (
          <div className={styles.group}>
            <Input
              label="New API key"
              type="password"
              autoComplete="new-password"
              value={state.key.value}
              disabled={connection.keyBlocked}
              onChange={(event) => connection.changeKey(event.target.value)}
            />
            <div className={styles.actions}>
              <Button
                type="button"
                loading={connection.credentialBusy}
                disabled={connection.keyBlocked || !state.key.value.trim()}
                onClick={() => void connection.keyAction('save')}
              >
                Save API key
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={connection.credentialBusy}
                onClick={connection.cancelKey}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button
              type="button"
              variant="secondary"
              disabled={connection.keyBlocked}
              onClick={connection.openKey}
            >
              {connection.hasKey ? 'Replace API key' : 'Add API key'}
            </Button>
            {connection.hasKey && (
              <Button
                type="button"
                variant="ghost"
                disabled={connection.keyBlocked}
                onClick={() => void connection.keyAction('remove')}
              >
                Remove API key
              </Button>
            )}
          </div>
        )}
        {feedback && (
          <div className={styles.feedback}>
            <p role="status">{feedback.message}</p>
            {feedback.action && (
              <Button
                type="button"
                variant="secondary"
                disabled={state.saving || connection.credentialBusy}
                onClick={() => void connection.keyAction('reconcile')}
              >
                {actions[feedback.action]}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
