'use client';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { resumeEndpoint } from '@/app/welcome/session/resume-security';
import styles from './ConnectionFields.module.css';

interface Props {
  method: 'key' | 'url';
  providerName: string;
  hint?: string;
  value: string;
  model: string;
  apiKey: string;
  detected: boolean;
  hasSavedKey: boolean;
  busy: boolean;
  focusKey?: boolean;
  canSave: boolean;
  outcome: 'verified' | 'saved' | 'configured' | null;
  onChange: (field: 'value' | 'model' | 'apiKey', value: string) => void;
  onOverride: () => void;
  onSave: () => Promise<void>;
}

export function ConnectionFields(props: Props) {
  const server = props.method === 'url';
  const complete = server
    ? Boolean(resumeEndpoint(props.value) && props.model.trim())
    : Boolean(props.value.trim());
  const caption = props.outcome
    ? props.outcome === 'verified' && !server
      ? 'Verified'
      : 'Saved'
    : server
      ? 'Save configuration'
      : 'Save key';

  return (
    <fieldset className={styles.root} disabled={props.busy}>
      <legend>{server ? 'Model server connection' : `${props.providerName} credential`}</legend>
      {props.detected && !server ? (
        <div className={styles.saved}>
          <p>A key is already saved for this profile.</p>
          <Button
            type="button"
            variant="ghost"
            onClick={props.onOverride}
            aria-label={`Override the detected ${props.providerName} API key`}
          >
            Override
          </Button>
        </div>
      ) : (
        <Input
          id="welcome-agent-value"
          name="agentValue"
          label={server ? 'Endpoint URL' : 'API key'}
          aria-label={server ? 'Endpoint URL' : `${props.providerName} API key`}
          type={server ? 'url' : 'password'}
          autoFocus={!server && props.focusKey}
          autoComplete={server ? 'url' : 'off'}
          spellCheck={false}
          value={props.value}
          placeholder={props.hint}
          onChange={(event) => props.onChange('value', event.target.value)}
        />
      )}
      {server && (
        <>
          <Input
            id="welcome-agent-model"
            name="agentModel"
            label="Model"
            aria-label={`${props.providerName} model name`}
            autoComplete="off"
            spellCheck={false}
            value={props.model}
            placeholder="Model ID served by this endpoint"
            onChange={(event) => props.onChange('model', event.target.value)}
          />
          <Input
            id="welcome-agent-api-key"
            name="agentApiKey"
            label="API key (optional)"
            aria-label={`${props.providerName} API key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={props.apiKey}
            placeholder={
              props.hasSavedKey
                ? 'Enter a key to replace the saved value'
                : 'Leave empty when the server needs no key'
            }
            onChange={(event) => props.onChange('apiKey', event.target.value)}
          />
          <p className={styles.hint}>
            The URL and model are saved before a key is bound to this connection.
          </p>
        </>
      )}
      {(!props.detected || server) && (
        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            disabled={!props.canSave || !complete || Boolean(props.outcome)}
            onClick={() => void props.onSave()}
          >
            {caption}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
