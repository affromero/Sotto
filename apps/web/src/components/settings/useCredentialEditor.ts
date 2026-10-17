'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  prepareCredentialRemoval,
  prepareCredentialSave,
  type CredentialEdit,
  type CredentialRemovalRequest,
  type CredentialSaveDraft,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';
import {
  loadCredentialSettings,
  reconcileCredentialSettings,
  removeCredentialSettings,
  saveCredentialSettings,
  CredentialReconciliationError,
  type CredentialEndpoint,
  type CredentialMutationResult,
} from '@/lib/sidedoor/credentials/config/credential-browser';

type Pending =
  | { kind: 'save'; command: CredentialSaveDraft; expectedEndpoint?: string }
  | { kind: 'remove'; command: CredentialRemovalRequest };
export function useCredentialEditor(endpoint: CredentialEndpoint) {
  const [currentEndpoint, setCurrentEndpoint] = useState(endpoint);
  const [snapshot, setSnapshot] = useState<CredentialSettingsSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState<{
    provider: string | null;
    message: string;
    action?: 'confirm' | 'reconcile' | 'reload';
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const pending = useRef<Pending | null>(null);
  const receipts = useRef(new Map<CredentialEndpoint, Pending>());
  const displayed = useRef(new Map<string, CredentialSettingsSnapshot>());
  const controllerEndpoint = useRef<CredentialEndpoint | null>(null);

  if (currentEndpoint !== endpoint) {
    setCurrentEndpoint(endpoint);
    setSnapshot(null);
    setBusy(true);
    setFeedback(null);
  }

  const load = useCallback(
    (signal: AbortSignal) => {
      locked.current = true;
      return loadCredentialSettings(endpoint, signal)
        .then((next) => {
          signal.throwIfAborted();
          setSnapshot(next);
          for (const provider of displayed.current.keys()) displayed.current.set(provider, next);
          setFeedback(
            pending.current
              ? {
                  provider: pending.current.command.provider,
                  message: 'A previous change needs its status checked before editing again.',
                  action: 'reconcile',
                }
              : null
          );
        })
        .catch((error: unknown) => {
          if (!signal.aborted)
            setFeedback({
              provider: null,
              message:
                error instanceof Error ? error.message : 'Could not load credential settings.',
              action: 'reload',
            });
        })
        .finally(() => {
          if (!signal.aborted) {
            locked.current = false;
            setBusy(false);
          }
        });
    },
    [endpoint]
  );

  useLayoutEffect(() => {
    const lifetime = new AbortController();
    const lifetimeReceipts = receipts.current;
    controller.current = lifetime;
    controllerEndpoint.current = endpoint;
    pending.current = receipts.current.get(endpoint) ?? null;
    displayed.current.clear();
    void load(lifetime.signal);
    return () => {
      if (pending.current) lifetimeReceipts.set(endpoint, pending.current);
      else lifetimeReceipts.delete(endpoint);
      lifetime.abort();
    };
  }, [endpoint, load]);

  function begin(provider: string) {
    if (controllerEndpoint.current !== endpoint) return false;
    if (locked.current || pending.current || !snapshot) return false;
    displayed.current.set(provider, snapshot);
    setFeedback(null);
    return true;
  }
  function edited() {
    if (controllerEndpoint.current !== endpoint) return;
    if (feedback?.action === 'confirm') {
      pending.current = null;
      setFeedback(null);
    }
  }
  function publish(result: CredentialMutationResult, operation: Pending) {
    const provider = operation.command.provider;
    if (result.status === 'confirmed') {
      pending.current = null;
      setSnapshot(result.snapshot);
      displayed.current.delete(provider);
      setFeedback({
        provider,
        message:
          operation.kind === 'remove'
            ? 'Key removed.'
            : !result.key?.isValid
              ? 'Key saved, but it is currently disabled.'
              : result.key.verification.lastConfirmed?.status === 'verified'
                ? 'Key saved and verified.'
                : 'Key saved without verification.',
      });
      return result;
    }
    if (result.status === 'needs_confirmation') {
      setFeedback({
        provider,
        message:
          'The provider could not verify these credentials. You can keep editing or explicitly save them without verification.',
        action: 'confirm',
      });
      return;
    }
    if (result.status === 'context_changed' || result.status === 'superseded') {
      pending.current = null;
      setFeedback({
        provider,
        message: 'These settings changed. Reload and review your edit before submitting again.',
        action: 'reload',
      });
      return;
    }
    setFeedback({
      provider,
      message:
        result.status === 'acknowledged'
          ? 'The server accepted the change, but its current state is unavailable. Check its status before editing again.'
          : 'The change may have reached the server. Check its status before editing again.',
      action: 'reconcile',
    });
  }
  async function run(operation: Pending, mode: 'submit' | 'confirm' | 'reconcile') {
    if (controllerEndpoint.current !== endpoint) return;
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || locked.current) return;
    locked.current = true;
    setBusy(true);
    pending.current = operation;
    try {
      const result =
        mode === 'reconcile'
          ? await reconcileCredentialSettings(endpoint, operation.command, operation.kind, signal)
          : operation.kind === 'save'
            ? await saveCredentialSettings(
                endpoint,
                operation.command,
                mode === 'confirm',
                signal,
                operation.expectedEndpoint
              )
            : await removeCredentialSettings(endpoint, operation.command, signal);
      signal.throwIfAborted();
      return publish(result, operation);
    } catch (error) {
      if (!signal.aborted) {
        const uncertain = mode === 'reconcile' || error instanceof CredentialReconciliationError;
        if (!uncertain) pending.current = null;
        setFeedback({
          provider: operation.command.provider,
          message: error instanceof Error ? error.message : 'Could not update credential settings.',
          action: uncertain ? 'reconcile' : 'reload',
        });
      }
    } finally {
      if (!signal.aborted) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  function save(provider: string, edit: CredentialEdit, expectedEndpoint?: string) {
    if (controllerEndpoint.current !== endpoint) return Promise.resolve(undefined);
    if (pending.current || feedback?.action === 'reload') return Promise.resolve(undefined);
    const captured = displayed.current.get(provider);
    if (!captured) return Promise.resolve(undefined);
    try {
      return run(
        {
          kind: 'save',
          command: prepareCredentialSave(captured, provider, edit),
          ...(expectedEndpoint ? { expectedEndpoint } : {}),
        },
        'submit'
      );
    } catch {
      setFeedback({
        provider,
        message: 'Check the required credential fields and numeric settings.',
      });
      return Promise.resolve(undefined);
    }
  }
  function remove(provider: string) {
    if (controllerEndpoint.current !== endpoint) return Promise.resolve(undefined);
    if (!snapshot || pending.current || feedback?.action === 'reload')
      return Promise.resolve(undefined);
    return run({ kind: 'remove', command: prepareCredentialRemoval(snapshot, provider) }, 'submit');
  }
  function act() {
    if (controllerEndpoint.current !== endpoint) return Promise.resolve(undefined);
    if (locked.current) return Promise.resolve(undefined);
    if (feedback?.action === 'reload' && !pending.current && controller.current) {
      setBusy(true);
      return load(controller.current.signal);
    }
    const operation = pending.current;
    if (!operation) return Promise.resolve(undefined);
    return run(operation, feedback?.action === 'confirm' ? 'confirm' : 'reconcile');
  }
  return {
    snapshot,
    busy,
    feedback,
    begin,
    edited,
    save,
    remove,
    act,
    editingBlocked: busy || feedback?.action === 'reconcile' || feedback?.action === 'reload',
  };
}
