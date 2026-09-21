// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  credentialSaveRequestSchema,
  type CredentialSaveRequest,
} from 'thesidedoor-core/configuration/credential-client';
import {
  WelcomeCredentialSession,
  WelcomeCredentialContextError,
} from '@/app/welcome/session/credential-session';
import { createWelcomeCredentialBoundary } from '../helpers/setup/welcome-credentials';

afterEach(() => vi.unstubAllGlobals());
const google = { endpoint: 'ai-keys' as const, provider: 'google', apiKey: 'test-google-key' };

it('rejects a provider omitted from the displayed settings instead of assuming its slot is empty', async () => {
  const boundary = createWelcomeCredentialBoundary();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
    boundary.handle(input, init)
  );
  const session = new WelcomeCredentialSession();
  const signal = new AbortController().signal;
  await session.load(signal);
  await expect(
    session.verifySelections([{ endpoint: 'ai-keys', provider: 'unknown-provider' }], signal)
  ).rejects.toThrow('unavailable');
  expect(() =>
    session.captureSelections([{ endpoint: 'ai-keys', provider: 'unknown-provider' }])
  ).toThrow('unavailable');
});

it('resumes a saved enabled key with authenticated reads and no additional credential write', async () => {
  const boundary = createWelcomeCredentialBoundary();
  const mutations: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') mutations.push(String(input));
    return boundary.handle(input, init);
  });
  const signal = new AbortController().signal;
  const initial = new WelcomeCredentialSession();
  await initial.load(signal);
  await initial.save([google], signal);
  mutations.length = 0;
  const resumed = new WelcomeCredentialSession();
  await resumed.load(signal);
  expect(resumed.savedProviders('ai-keys')).toContain('google');
  await resumed.verifySelections([{ endpoint: 'ai-keys', provider: 'google' }], signal);
  expect(await resumed.save([], signal)).toEqual({ status: 'ready' });
  expect(mutations).toEqual([]);
});

it('rejects a different credential revision after the wizard displayed the saved key', async () => {
  const boundary = createWelcomeCredentialBoundary();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
    boundary.handle(input, init)
  );
  const signal = new AbortController().signal;
  const session = new WelcomeCredentialSession();
  await session.load(signal);
  const anotherTab = new WelcomeCredentialSession();
  await anotherTab.load(signal);
  await anotherTab.save([google], signal);
  await expect(
    session.verifySelections([{ endpoint: 'ai-keys', provider: 'google' }], signal)
  ).rejects.toThrow('changed');
});

it('clears displayed credentials when endpoint snapshots belong to different owners', async () => {
  const boundary = createWelcomeCredentialBoundary();
  let changeOwner = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = boundary.handle(input, init)!;
    if (changeOwner && String(input).endsWith('/byok')) {
      const body = await response.json();
      body.context.owner.subjectId = 'another-owner';
      return Response.json(body);
    }
    return response;
  });
  const session = new WelcomeCredentialSession();
  const signal = new AbortController().signal;
  await session.load(signal);
  await session.save([google], signal);
  changeOwner = true;
  await expect(session.load(signal)).rejects.toBeInstanceOf(WelcomeCredentialContextError);
  expect(session.savedProviders('ai-keys')).toEqual([]);
  await expect(session.save([google], signal)).rejects.toThrow('Load credential settings');
});

it('reuses a saved receipt across placement and final retries without reposting the key', async () => {
  const boundary = createWelcomeCredentialBoundary();
  const mutations: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') mutations.push(String(input));
    return boundary.handle(input, init);
  });
  const session = new WelcomeCredentialSession();
  const signal = new AbortController().signal;
  await session.load(signal);
  expect(await session.save([google], signal)).toEqual({ status: 'ready' });
  expect(await session.save([google, { ...google }], signal)).toEqual({ status: 'ready' });
  expect(mutations).toEqual(['/api/v1/settings/ai-keys']);
  expect(boundary.saved.get('ai-keys:google')).toEqual({ apiKey: google.apiKey });
});

it('resolves an omitted uncertain operation before accepting empty or changed selections', async () => {
  const boundary = createWelcomeCredentialBoundary();
  let offline = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (offline) throw new TypeError('Offline');
    const response = boundary.handle(input, init);
    if (init?.method === 'POST') {
      offline = true;
      throw new TypeError('Lost commit response');
    }
    return response;
  });
  const session = new WelcomeCredentialSession();
  const signal = new AbortController().signal;
  await session.load(signal);
  expect(await session.save([google], signal)).toMatchObject({ status: 'uncertain' });
  await expect(session.save([], signal)).rejects.toThrow();
  await expect(session.save([{ ...google, provider: 'openai' }], signal)).rejects.toThrow();
  expect(boundary.saved.has('ai-keys:openai')).toBe(false);
  offline = false;
  expect(await session.save([], signal)).toEqual({ status: 'ready' });
});

it('rejects conflicting aliases before writing any credentials', async () => {
  const boundary = createWelcomeCredentialBoundary();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
    boundary.handle(input, init)
  );
  const session = new WelcomeCredentialSession();
  const signal = new AbortController().signal;
  await session.load(signal);
  await expect(
    session.save([google, { ...google, apiKey: 'different-key' }], signal)
  ).rejects.toThrow('different');
  expect(boundary.saved.size).toBe(0);
});

it('requires fresh confirmation after editing, even when the user restores the original text', async () => {
  const boundary = createWelcomeCredentialBoundary();
  const submitted: CredentialSaveRequest[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return boundary.handle(input, init);
    const command = credentialSaveRequestSchema.parse(JSON.parse(String(init.body)));
    submitted.push(command);
    if (command.allowUnverified) return boundary.handle(input, init);
    return Response.json({
      status: 'needs_confirmation',
      operationId: command.operationId,
      context: command.context,
      validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 1 } },
    });
  });
  const session = new WelcomeCredentialSession();
  const signal = new AbortController().signal;
  await session.load(signal);
  const first = await session.save([google], signal);
  expect(first.status).toBe('confirmation');
  session.invalidateConfirmations();
  const next = await session.save([google], signal, submitted[0]?.operationId);
  expect(next.status).toBe('confirmation');
  expect(submitted[1]?.operationId).not.toBe(submitted[0]?.operationId);
  expect(submitted[1]?.allowUnverified).toBe(false);
  expect(await session.save([google], signal, submitted[1]?.operationId)).toEqual({
    status: 'ready',
  });
});
