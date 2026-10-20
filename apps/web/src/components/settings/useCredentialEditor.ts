'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  prepareCredentialRemoval,
  prepareCredentialSave,
  type CredentialEdit,
  type CredentialRemovalRequest,
  type CredentialSaveDraft,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';
import {
  captureCredentialReceipt,
  loadCredentialSettings,
  reconcileCredentialSettings,
  removeCredentialSettings,
  saveCredentialSettings,
  CredentialReconciliationError,
  type CredentialEndpoint,
  type CredentialMutationResult,
} from '@/lib/sidedoor/credentials/config/credential-browser';

interface Pending {
  kind: 'save' | 'remove';
  receipt: CredentialRemovalRequest;
  confirmation?: { draft: CredentialSaveDraft; expectedEndpoint?: string };
}
interface Feedback {
  provider: string | null;
  message: string;
  action?: 'confirm' | 'reconcile' | 'reload';
}

export function useCredentialEditor(endpoint: CredentialEndpoint) {
  const identity = useMemo(() => Symbol(endpoint), [endpoint]);
  const [view, setView] = useState(endpoint);
  const [snapshot, setSnapshot] = useState<CredentialSettingsSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const lifetime = useRef<{ identity: symbol; controller: AbortController } | null>(null);
  const locked = useRef(false);
  const editVersion = useRef(0);
  const pending = useRef<Pending | null>(null);
  const receipts = useRef(new Map<CredentialEndpoint, Pending>());
  const displayed = useRef(new Map<string, CredentialSettingsSnapshot>());

  if (view !== endpoint) {
    setView(endpoint);
    setSnapshot(null);
    setFeedback(null);
    setBusy(true);
  }

  const load = useCallback(
    async (signal: AbortSignal) => {
      locked.current = true;
      try {
        const next = await loadCredentialSettings(endpoint, signal);
        signal.throwIfAborted();
        setSnapshot(next);
        for (const provider of displayed.current.keys()) displayed.current.set(provider, next);
        setFeedback(
          pending.current
            ? {
                provider: pending.current.receipt.provider,
                message: 'Check the previous change before editing credentials.',
                action: 'reconcile',
              }
            : null
        );
      } catch (error) {
        if (!signal.aborted)
          setFeedback({
            provider: null,
            message: error instanceof Error ? error.message : 'Could not load credential settings.',
            action: 'reload',
          });
      } finally {
        if (!signal.aborted) {
          locked.current = false;
          setBusy(false);
        }
      }
    },
    [endpoint]
  );

  useLayoutEffect(() => {
    const controller = new AbortController();
    const retained = receipts.current;
    lifetime.current = { identity, controller };
    pending.current = retained.get(endpoint) ?? null;
    displayed.current.clear();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => {
      const operation = pending.current;
      if (operation && !operation.confirmation)
        retained.set(endpoint, { kind: operation.kind, receipt: operation.receipt });
      else retained.delete(endpoint);
      pending.current = null;
      controller.abort();
    };
  }, [endpoint, identity, load]);

  function active() {
    return lifetime.current?.identity === identity && !lifetime.current.controller.signal.aborted;
  }

  function begin(provider: string) {
    if (!active() || locked.current || pending.current || !snapshot) return false;
    displayed.current.set(provider, snapshot);
    setFeedback(null);
    return true;
  }

  function edited() {
    if (!active()) return;
    editVersion.current++;
    if (pending.current?.confirmation) {
      pending.current = null;
      setFeedback(null);
    }
  }

  function publish(result: CredentialMutationResult, operation: Pending) {
    const provider = operation.receipt.provider;
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
        message: operation.confirmation
          ? 'The provider could not verify these credentials. Review them or save without verification.'
          : 'The credentials were edited. Review them before saving again.',
        ...(operation.confirmation ? { action: 'confirm' as const } : {}),
      });
      if (!operation.confirmation) pending.current = null;
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
      message: 'The change may have reached the server. Check its status before editing again.',
      action: 'reconcile',
    });
  }

  async function run(
    operation: Pending,
    submission?: { draft: CredentialSaveDraft; expectedEndpoint?: string; confirmed: boolean },
    removing = false
  ) {
    if (!active() || locked.current) return;
    const signal = lifetime.current!.controller.signal;
    const version = editVersion.current;
    locked.current = true;
    setBusy(true);
    // Dispatch retains only the identity needed for an authenticated status read.
    const retained: Pending = { kind: operation.kind, receipt: operation.receipt };
    pending.current = retained;
    try {
      const result = submission
        ? await saveCredentialSettings(
            endpoint,
            submission.draft,
            submission.confirmed,
            signal,
            submission.expectedEndpoint
          )
        : removing
          ? await removeCredentialSettings(endpoint, operation.receipt, signal)
          : await reconcileCredentialSettings(endpoint, operation.receipt, operation.kind, signal);
      signal.throwIfAborted();
      if (!active()) return;
      if (result.status === 'needs_confirmation' && submission && version === editVersion.current)
        retained.confirmation = {
          draft: submission.draft,
          expectedEndpoint: submission.expectedEndpoint,
        };
      return publish(result, retained);
    } catch (error) {
      if (!signal.aborted && active()) {
        const uncertain =
          (!submission && !removing) || error instanceof CredentialReconciliationError;
        if (!uncertain) pending.current = null;
        setFeedback({
          provider: operation.receipt.provider,
          message: error instanceof Error ? error.message : 'Could not update credential settings.',
          action: uncertain ? 'reconcile' : 'reload',
        });
      }
    } finally {
      if (!signal.aborted && active()) {
        locked.current = false;
        setBusy(false);
      }
    }
  }

  function save(provider: string, edit: CredentialEdit, expectedEndpoint?: string) {
    if (!active() || pending.current || feedback?.action === 'reload') return Promise.resolve();
    const captured = displayed.current.get(provider);
    if (!captured) return Promise.resolve();
    try {
      const draft = prepareCredentialSave(captured, provider, edit);
      return run(
        { kind: 'save', receipt: captureCredentialReceipt(draft) },
        { draft, expectedEndpoint, confirmed: false }
      );
    } catch {
      setFeedback({
        provider,
        message: 'Check the required credential fields and numeric settings.',
      });
      return Promise.resolve();
    }
  }

  function remove(provider: string) {
    if (!active() || !snapshot || pending.current || feedback?.action === 'reload')
      return Promise.resolve();
    return run(
      { kind: 'remove', receipt: prepareCredentialRemoval(snapshot, provider) },
      undefined,
      true
    );
  }

  function act() {
    if (!active() || locked.current) return Promise.resolve();
    const operation = pending.current;
    if (operation)
      return run(
        operation,
        operation.confirmation && { ...operation.confirmation, confirmed: true }
      );
    if (feedback?.action === 'reload') {
      setBusy(true);
      return load(lifetime.current!.controller.signal);
    }
    return Promise.resolve();
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
