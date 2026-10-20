'use client';

import { useEffect, useReducer, useRef } from 'react';
import { resumeEndpoint } from '@/app/welcome/session/resume-security';
import { saveAiServerConfiguration } from '@/lib/site-configuration/client';
import { useCredentialEditor } from '../useCredentialEditor';
import { initialLocalAiState, localAiReducer, type LocalAiConfig } from './state';

export function useLocalAiController(initial: LocalAiConfig) {
  const [state, dispatch] = useReducer(localAiReducer, initial, initialLocalAiState);
  const editor = useCredentialEditor('ai-keys');
  const lifetime = useRef<AbortController | null>(null);
  const operation = useRef<symbol | null>(null);

  useEffect(() => {
    const owner = new AbortController();
    lifetime.current = owner;
    return () => {
      owner.abort();
      if (lifetime.current === owner) {
        lifetime.current = null;
        operation.current = null;
      }
    };
  }, []);

  const dirty = Object.keys(state.saved).some((field) => {
    const name = field as keyof LocalAiConfig;
    return state.draft[name].trim() !== state.saved[name];
  });
  const hasKey = editor.snapshot?.keys.some((key) => key.provider === 'local') ?? false;
  const configurationBlocked =
    state.saving || editor.busy || editor.feedback?.action === 'reconcile';
  const keyBlocked = dirty || state.saving || editor.editingBlocked;

  function current(owner: AbortController) {
    return lifetime.current === owner && !owner.signal.aborted;
  }

  function change(field: keyof LocalAiConfig, value: string) {
    if (configurationBlocked || operation.current) return;
    editor.edited();
    dispatch({ type: 'configure', field, value });
  }

  async function saveConfiguration() {
    const owner = lifetime.current;
    if (!owner || operation.current || configurationBlocked || !dirty) return;
    const config = {
      baseUrl: resumeEndpoint(state.draft.baseUrl.trim()),
      model: state.draft.model.trim(),
    };
    if (!config.baseUrl || !config.model) {
      dispatch({ type: 'failed', message: 'Enter an HTTP or HTTPS server URL and a model ID.' });
      return;
    }
    const identity = Symbol('server-configuration');
    operation.current = identity;
    dispatch({ type: 'saving' });
    try {
      await saveAiServerConfiguration(
        {
          aiBaseUrl: config.baseUrl,
          aiModel: config.model,
          aiProvider: 'local',
        },
        owner.signal
      );
      if (current(owner) && operation.current === identity)
        dispatch({
          type: 'configured',
          config: { baseUrl: config.baseUrl, model: config.model },
          hasKey,
        });
    } catch (error) {
      if (current(owner))
        dispatch({
          type: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'The model server configuration was not saved.',
        });
    } finally {
      if (operation.current === identity) operation.current = null;
    }
  }

  function openKey() {
    if (!keyBlocked && editor.begin('local')) dispatch({ type: 'edit-key' });
  }

  function changeKey(value: string) {
    if (keyBlocked) return;
    editor.edited();
    dispatch({ type: 'key-value', value });
  }

  function cancelKey() {
    if (editor.busy) return;
    editor.edited();
    dispatch({ type: 'close-key' });
  }

  async function keyAction(action: 'save' | 'remove' | 'reconcile') {
    const owner = lifetime.current;
    if (!owner || !current(owner) || state.saving || editor.busy) return;
    if (action !== 'reconcile' && keyBlocked) return;
    const apiKey = action === 'save' ? state.key.value.trim() : '';
    if (action === 'save' && !apiKey) return;
    if (action === 'save') dispatch({ type: 'key-dispatched' });
    const result =
      action === 'save'
        ? await editor.save('local', { values: { apiKey } }, state.saved.baseUrl)
        : action === 'remove'
          ? await editor.remove('local')
          : await editor.act();
    if (current(owner) && result?.status === 'confirmed')
      dispatch({ type: 'close-key', confirmed: true });
  }

  return {
    state,
    dirty,
    hasKey,
    configurationBlocked,
    keyBlocked,
    credentialBusy: editor.busy,
    feedback: editor.feedback,
    change,
    saveConfiguration,
    openKey,
    changeKey,
    cancelKey,
    keyAction,
  };
}
