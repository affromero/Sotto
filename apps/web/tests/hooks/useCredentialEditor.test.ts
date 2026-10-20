import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  credentialSaveRequestSchema,
  credentialRemovalRequestSchema,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';
import { useCredentialEditor } from '@/components/settings/useCredentialEditor';
import type { CredentialEndpoint } from '@/lib/sidedoor/credentials/config/credential-browser';
import { createWelcomeCredentialBoundary } from '../helpers/setup/welcome-credentials';

afterEach(() => vi.unstubAllGlobals());

it('checks an uncertain removal across navigation without sending another deletion', async () => {
  const revision = crypto.randomUUID();
  let settings: CredentialSettingsSnapshot = {
    context: {
      instanceId: 'instance',
      scope: 'ai-keys',
      owner: { subjectId: 'reader', generation: 1 },
    },
    heads: { openai: revision },
    keys: [
      {
        provider: 'openai',
        revision,
        isValid: true,
        verification: {
          lastAttempt: { status: 'verified', checkedAt: 1 },
          lastConfirmed: { status: 'verified', checkedAt: 1 },
        },
      },
    ],
  };
  let denied = false;
  const deletions: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('/byok'))
      return Response.json({
        ...settings,
        context: { ...settings.context, scope: 'byok' },
        heads: { cartesia: null },
        keys: [],
      });
    if (init?.method === 'DELETE') {
      const command = credentialRemovalRequestSchema.parse(JSON.parse(String(init.body)));
      deletions.push(command.operationId);
      settings = { ...settings, heads: { openai: command.operationId }, keys: [] };
      denied = true;
      return Response.json({
        status: 'removed',
        revision: command.operationId,
        context: command.context,
      });
    }
    return denied ? Response.json({}, { status: 401 }) : Response.json(settings);
  });
  const { result, rerender } = renderHook(
    ({ endpoint }: { endpoint: CredentialEndpoint }) => useCredentialEditor(endpoint),
    { initialProps: { endpoint: 'ai-keys' } }
  );
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => {
    await result.current.remove('openai');
  });
  expect(result.current.feedback?.action).toBe('reconcile');
  rerender({ endpoint: 'byok' });
  await waitFor(() => expect(result.current.busy).toBe(false));
  denied = false;
  rerender({ endpoint: 'ai-keys' });
  await waitFor(() => expect(result.current.feedback?.action).toBe('reconcile'));
  await act(async () => {
    await result.current.act();
  });
  expect(result.current.snapshot?.keys).toEqual([]);
  expect(result.current.feedback?.message).toBe('Key removed.');
  expect(deletions).toHaveLength(1);
});

it('does not reactivate an old callback when returning to the same endpoint', async () => {
  const boundary = createWelcomeCredentialBoundary();
  const writes: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method) writes.push(String(input));
    return boundary.handle(input, init);
  });
  const { result, rerender } = renderHook(
    ({ endpoint }: { endpoint: CredentialEndpoint }) => useCredentialEditor(endpoint),
    { initialProps: { endpoint: 'ai-keys' } }
  );
  await waitFor(() => expect(result.current.busy).toBe(false));
  const old = result.current;
  rerender({ endpoint: 'byok' });
  await waitFor(() => expect(result.current.busy).toBe(false));
  rerender({ endpoint: 'ai-keys' });
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => expect(result.current.begin('google')).toBe(true));
  await act(async () => {
    expect(old.begin('google')).toBe(false);
    await old.save('google', { values: { apiKey: 'obsolete-secret' } });
    await old.remove('google');
    await old.act();
  });
  expect(writes).toEqual([]);
});

it('discards confirmation on navigation and requires a fresh key entry', async () => {
  const boundary = createWelcomeCredentialBoundary();
  const writes: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return boundary.handle(input, init);
    writes.push(String(init.body));
    const command = credentialSaveRequestSchema.parse(JSON.parse(String(init.body)));
    return Response.json({
      status: 'needs_confirmation',
      operationId: command.operationId,
      context: command.context,
      validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 1 } },
    });
  });
  const { result, rerender } = renderHook(
    ({ endpoint }: { endpoint: CredentialEndpoint }) => useCredentialEditor(endpoint),
    { initialProps: { endpoint: 'ai-keys' } }
  );
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => expect(result.current.begin('google')).toBe(true));
  await act(async () => {
    await result.current.save('google', { values: { apiKey: 'old-key' } });
  });
  expect(result.current.feedback?.action).toBe('confirm');
  rerender({ endpoint: 'byok' });
  await waitFor(() => expect(result.current.busy).toBe(false));
  rerender({ endpoint: 'ai-keys' });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.feedback).toBeNull();
  await act(async () => {
    await result.current.act();
  });
  expect(writes).toHaveLength(1);
  act(() => expect(result.current.begin('google')).toBe(true));
});

it('does not restore an obsolete draft when confirmation arrives after an edit', async () => {
  const response = Promise.withResolvers<Response>();
  const boundary = createWelcomeCredentialBoundary();
  let submitted: ReturnType<typeof credentialSaveRequestSchema.parse> | undefined;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return boundary.handle(input, init);
    submitted = credentialSaveRequestSchema.parse(JSON.parse(String(init.body)));
    return response.promise;
  });
  const { result } = renderHook(() => useCredentialEditor('ai-keys'));
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => expect(result.current.begin('google')).toBe(true));
  let saving: ReturnType<typeof result.current.save>;
  act(() => {
    saving = result.current.save('google', { values: { apiKey: 'edited-key' } });
  });
  act(() => result.current.edited());
  await act(async () => {
    response.resolve(
      Response.json({
        status: 'needs_confirmation',
        operationId: submitted!.operationId,
        context: submitted!.context,
        validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 1 } },
      })
    );
    await saving;
  });
  expect(result.current.feedback?.action).toBeUndefined();
  act(() => expect(result.current.begin('google')).toBe(true));
});

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
