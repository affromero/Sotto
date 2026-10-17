import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  credentialSaveRequestSchema,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';
import { useCredentialEditor } from '@/components/settings/useCredentialEditor';
import type { CredentialEndpoint } from '@/lib/sidedoor/credentials/config/credential-browser';

afterEach(() => vi.unstubAllGlobals());

it('hides previous endpoint credentials immediately and rejects commands from its old lifetime', async () => {
  const next = Promise.withResolvers<Response>();
  const writes: string[] = [];
  const settings: CredentialSettingsSnapshot = {
    context: {
      instanceId: 'instance',
      scope: 'ai-keys',
      owner: { subjectId: 'alice', generation: 1 },
    },
    heads: { openai: null },
    keys: [],
  };
  vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
    if (options?.method) writes.push(url);
    return url.endsWith('/byok') ? next.promise : Response.json(settings);
  });
  const { result, rerender } = renderHook(
    ({ endpoint }: { endpoint: CredentialEndpoint }) => useCredentialEditor(endpoint),
    { initialProps: { endpoint: 'ai-keys' } }
  );
  await waitFor(() => expect(result.current.busy).toBe(false));
  const previous = result.current;
  act(() => expect(previous.begin('openai')).toBe(true));
  rerender({ endpoint: 'byok' });
  expect(result.current.snapshot).toBeNull();
  expect(result.current.busy).toBe(true);
  expect(result.current.feedback).toBeNull();
  act(() => expect(result.current.begin('cartesia')).toBe(false));
  await act(async () => {
    await previous.save('openai', { values: { apiKey: 'test-key' } });
    await previous.remove('openai');
    await previous.act();
  });
  expect(writes).toEqual([]);
  await act(async () => {
    next.resolve(Response.json({ ...settings, context: { ...settings.context, scope: 'byok' } }));
  });
  expect(result.current.snapshot?.context.scope).toBe('byok');
  expect(result.current.busy).toBe(false);
});

it('retains an uncertain receipt across access loss and endpoint changes until reconciled', async () => {
  let denied = false;
  let settings: CredentialSettingsSnapshot = {
    context: {
      instanceId: 'instance',
      scope: 'ai-keys',
      owner: { subjectId: 'alice', generation: 1 },
    },
    heads: { openai: null },
    keys: [],
  };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/byok'))
      return Response.json({
        ...settings,
        context: { ...settings.context, scope: 'byok' },
        heads: { cartesia: null },
        keys: [],
      });
    if (!init.method) return denied ? Response.json({}, { status: 401 }) : Response.json(settings);
    const command = credentialSaveRequestSchema.parse(JSON.parse(String(init.body)));
    settings = {
      ...settings,
      heads: { openai: command.operationId },
      keys: [
        {
          provider: 'openai',
          revision: command.operationId,
          isValid: true,
          verification: {
            lastAttempt: { status: 'verified', checkedAt: 1 },
            lastConfirmed: { status: 'verified', checkedAt: 1 },
          },
        },
      ],
    };
    denied = true;
    return Response.json({
      status: 'saved',
      revision: command.operationId,
      context: command.context,
      validation: { status: 'valid', readiness: { code: 'ready', checkedAt: 1 } },
    });
  });
  const { result, rerender } = renderHook(
    ({ endpoint }: { endpoint: CredentialEndpoint }) => useCredentialEditor(endpoint),
    {
      initialProps: { endpoint: 'ai-keys' },
    }
  );
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => {
    expect(result.current.begin('openai')).toBe(true);
  });
  await act(async () => {
    await result.current.save('openai', { values: { apiKey: 'test-secret' } });
  });
  expect(result.current.feedback?.action).toBe('reconcile');
  expect(result.current.editingBlocked).toBe(true);
  rerender({ endpoint: 'byok' });
  await waitFor(() => expect(result.current.snapshot?.context.scope).toBe('byok'));
  act(() => {
    expect(result.current.begin('cartesia')).toBe(true);
  });
  denied = false;
  rerender({ endpoint: 'ai-keys' });
  await waitFor(() => expect(result.current.feedback?.action).toBe('reconcile'));
  await act(async () => {
    await result.current.act();
  });
  expect(result.current.feedback?.message).toBe('Key saved and verified.');
  expect(result.current.editingBlocked).toBe(false);
});
