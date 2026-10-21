import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AccessClient } from 'thesidedoor-core/access/browser';
import {
  credentialEditContextSchema,
  credentialRemovalRequestSchema,
  credentialSettingsSnapshotSchema,
  credentialSaveRequest,
  prepareCredentialSave,
  reconcileCredentialMutation,
  sameCredentialEditContext,
} from 'thesidedoor-core/configuration/credential-client';
import { readResponseBytes } from 'thesidedoor-core/runtime/stream';
import { parseAgentModelId } from '@/lib/agent-models/id';

const origin = 'https://demo.sotto.fm';
const text = z.string().min(1).max(1024);
const selection = z.object({ aiProvider: text, aiModel: text }).strict();
const automaticModels = z
  .object({
    model: selection.extend({
      ttsProvider: text,
      ttsModel: text,
      sttProvider: text,
      sttModel: text,
    }),
    platform: selection,
    includedModels: z.array(text).nullable(),
    includedTtsModels: z.array(text).nullable(),
    includedSttModels: z.array(text).nullable(),
  })
  .strict();
const preferences = z
  .object({
    preferredAiModel: text.nullable(),
    preferredTtsProvider: text.nullable(),
    preferredTtsModel: text.nullable(),
    preferredSttModel: text.nullable(),
  })
  .strict();
const profile = z
  .object({
    id: text,
    preferences,
    credentialContext: credentialEditContextSchema.omit({ scope: true }),
  })
  .strict();
const inputSchema = z
  .object({
    endpoint: z.url(),
    householdPassword: z.string().min(1).max(4096),
    expectedOwnerId: text,
    profiles: z.array(profile).length(2),
    expectedAutomaticModels: automaticModels,
    selectedModelId: text,
    speechProvider: text,
    credentialValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict();

export type ReviewReadinessInput = z.infer<typeof inputSchema>;
type CredentialEndpoint = 'ai-keys' | 'byok';
const pendingCredential = z
  .object({
    profileId: text,
    endpoint: z.enum(['ai-keys', 'byok']),
    command: credentialRemovalRequestSchema,
  })
  .strict();
const checkpointSchema = z
  .object({
    credentials: z.array(pendingCredential).max(4),
    modelChangePrepared: z.boolean(),
  })
  .strict();
export type ReviewReadinessCheckpoint = z.infer<typeof checkpointSchema>;

export interface ReviewReadinessBoundary {
  /** The controller independently verifies its exclusive fence and runtime identities. */
  assertFence: () => Promise<void>;
  /** Atomically save and fsync this non-secret checkpoint before returning. */
  persistCheckpoint: (checkpoint: ReviewReadinessCheckpoint) => Promise<void>;
  fetch?: typeof globalThis.fetch;
  signal: AbortSignal;
}

export class ReviewReadinessError extends Error {
  constructor(readonly phase: string) {
    super(`Review provider readiness failed at ${phase}; retain the private checkpoint.`);
    this.name = 'ReviewReadinessError';
  }
}

/**
 * Configure only a fenced final candidate. The controller owns database/storage,
 * auth-handover and image evidence. This proves credential validation, live CLI
 * discovery and exact settings, not successful learning/audio workloads.
 */
export async function runReviewReadiness(
  value: unknown,
  retained: unknown,
  boundary: ReviewReadinessBoundary
) {
  let phase = 'input';
  const fail: () => never = () => {
    throw new ReviewReadinessError(phase);
  };
  try {
    const input = inputSchema.parse(value);
    const checkpoint = checkpointSchema.parse(retained);
    const endpoint = new URL(input.endpoint);
    if (
      endpoint.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== '/' ||
      endpoint.search ||
      endpoint.hash ||
      !endpoint.port
    )
      fail();
    const ids = input.profiles.map((item) => item.id);
    if (new Set(ids).size !== 2 || !ids.includes(input.expectedOwnerId)) fail();
    if (
      input.expectedAutomaticModels.model.ttsProvider !== input.speechProvider ||
      input.expectedAutomaticModels.model.sttProvider !== input.speechProvider ||
      parseAgentModelId(input.selectedModelId)?.provider !== 'codex'
    )
      fail();
    if (input.profiles.some((item) => item.preferences.preferredAiModel !== null)) fail();
    const checkpointKeys = checkpoint.credentials.map(
      (item) => `${item.profileId}/${item.endpoint}`
    );
    if (
      new Set(checkpointKeys).size !== checkpointKeys.length ||
      checkpoint.credentials.some((item) => !ids.includes(item.profileId)) ||
      new Set(checkpoint.credentials.map((item) => item.command.operationId)).size !==
        checkpoint.credentials.length ||
      (checkpoint.modelChangePrepared && checkpoint.credentials.length !== 4)
    )
      fail();

    const combinedSignal = AbortSignal.any([boundary.signal, AbortSignal.timeout(300_000)]);
    const jar = new Map<string, string>();
    let selectedProfileId: string | null = null;
    const transport: typeof fetch = async (resource, options) => {
      combinedSignal.throwIfAborted();
      if (
        typeof resource !== 'string' ||
        !resource.startsWith('/api/v1/') ||
        resource.includes('?') ||
        resource.includes('#') ||
        resource.includes('\\')
      )
        fail();
      const destination = new URL(resource, endpoint);
      if (destination.origin !== endpoint.origin) fail();
      const headers = new Headers(options?.headers);
      headers.set('Origin', origin);
      headers.set('X-Sidedoor-Origin', origin);
      if (selectedProfileId && !resource.startsWith('/api/v1/access/'))
        headers.set('X-Sotto-Expected-Profile-Id', selectedProfileId);
      if (jar.size)
        headers.set('Cookie', [...jar].map(([name, token]) => `${name}=${token}`).join('; '));
      const signal = AbortSignal.any([combinedSignal, AbortSignal.timeout(60_000)]);
      const response = await (boundary.fetch ?? globalThis.fetch)(destination, {
        ...options,
        headers,
        redirect: 'error',
        cache: 'no-store',
        signal,
      });
      if (response.redirected || (response.url && response.url !== destination.href)) fail();
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0];
        const offset = pair.indexOf('=');
        if (offset < 1 || pair.length > 8192 || jar.size > 16) fail();
        const name = pair.slice(0, offset);
        if (!/^[a-zA-Z0-9_-]+$/.test(name) || /[\r\n]/.test(pair)) fail();
        jar.set(name, pair.slice(offset + 1));
        if (jar.size > 16) fail();
      }
      const bytes = await readResponseBytes(response, { signal, maxBytes: 1024 * 1024 });
      return new Response(Uint8Array.from(bytes).buffer, {
        status: response.status,
        headers: response.headers,
      });
    };
    const request = async (
      path: string,
      body?: unknown,
      method = body === undefined ? 'GET' : 'POST'
    ) => {
      const response = await transport(path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) fail();
      return response.json() as Promise<unknown>;
    };
    const access = new AccessClient({ endpoint: '/api/v1/access', fetch: transport });
    const select = async (id: string) => {
      await request('/api/v1/access/select-profile', { id });
      selectedProfileId = id;
      const current = z
        .object({ id: text })
        .passthrough()
        .parse(await request('/api/v1/users/me'));
      if (current.id !== id) fail();
      const expected = input.profiles.find((item) => item.id === id)!;
      if (!isDeepStrictEqual(preferences.strip().parse(current), expected.preferences)) fail();
    };
    const snapshot = async (id: string, name: CredentialEndpoint) => {
      const result = credentialSettingsSnapshotSchema.parse(
        await request(`/api/v1/settings/${name}`)
      );
      const expected = input.profiles.find((item) => item.id === id)!;
      if (
        !sameCredentialEditContext(result.context, { ...expected.credentialContext, scope: name })
      )
        fail();
      return result;
    };
    const authorizeOwner = async () => {
      await select(input.expectedOwnerId);
      const reply = z
        .object({ ok: z.literal(true) })
        .parse(await request('/api/v1/access/authorize-owner', {}));
      if (!reply.ok) fail();
      return automaticModels.parse(await request('/api/v1/admin/auto-models'));
    };
    const expectedFinal = {
      ...input.expectedAutomaticModels,
      model: {
        ...input.expectedAutomaticModels.model,
        aiProvider: 'codex',
        aiModel: input.selectedModelId,
      },
      platform: { aiProvider: 'codex', aiModel: input.selectedModelId },
    };
    const assertModels = (current: z.infer<typeof automaticModels>) => {
      if (
        !isDeepStrictEqual(current, input.expectedAutomaticModels) &&
        !(checkpoint.modelChangePrepared && isDeepStrictEqual(current, expectedFinal))
      )
        fail();
    };
    phase = 'authority';
    await boundary.assertFence();
    await access.enterHousehold(input.householdPassword, combinedSignal);
    const profiles = z
      .object({ profiles: z.array(z.object({ id: text }).passthrough()).max(10) })
      .parse(await request('/api/v1/profiles')).profiles;
    if (!isDeepStrictEqual(profiles.map((item) => item.id).sort(), [...ids].sort())) fail();
    assertModels(await authorizeOwner());

    phase = 'credential_precheck';
    for (const target of input.profiles) {
      await select(target.id);
      for (const name of ['ai-keys', 'byok'] as const) {
        const current = await snapshot(target.id, name);
        if (
          current.keys.some((item) => item.provider !== input.speechProvider) ||
          Object.entries(current.heads).some(
            ([provider, head]) => provider !== input.speechProvider && head !== null
          )
        )
          fail();
        const pending = checkpoint.credentials.find(
          (item) => item.profileId === target.id && item.endpoint === name
        );
        if (pending) {
          if (
            pending.command.provider !== input.speechProvider ||
            pending.command.expectedRevision !== null ||
            !sameCredentialEditContext(pending.command.context, current.context) ||
            reconcileCredentialMutation(pending.command, current, 'save').status !== 'confirmed'
          )
            fail();
          const key = current.keys.find((item) => item.provider === input.speechProvider);
          if (!key?.isValid || key.verification.lastAttempt?.status !== 'verified') fail();
        } else if (
          current.heads[input.speechProvider] !== null ||
          current.keys.some((item) => item.provider === input.speechProvider)
        )
          fail();
      }
    }

    phase = 'model_discovery';
    await select(input.expectedOwnerId);
    const discover = async () => {
      const offering = z
        .object({
          models: z.array(z.object({ id: text, isDefault: z.boolean() }).passthrough()).max(1000),
          agentModelDiscovery: z.object({
            codex: z.object({
              source: z.literal('live'),
              error: z.null(),
              capabilities: z.object({ web: z.literal(true), vision: z.literal(true) }),
            }),
          }),
        })
        .parse(await request('/api/v1/ai-models'));
      const offered = offering.models.find((item) => item.id === input.selectedModelId);
      if (!offered) fail();
      return offered;
    };
    await discover();

    for (const target of input.profiles) {
      await select(target.id);
      for (const name of ['ai-keys', 'byok'] as const) {
        phase = `credential_${name}`;
        if (
          checkpoint.credentials.some(
            (item) => item.profileId === target.id && item.endpoint === name
          )
        )
          continue;
        await boundary.assertFence();
        const current = await snapshot(target.id, name);
        if (current.heads[input.speechProvider] !== null) fail();
        const draft = prepareCredentialSave(current, input.speechProvider, {
          values: input.credentialValues,
        });
        const command = credentialRemovalRequestSchema.parse({
          context: draft.context,
          provider: draft.provider,
          expectedRevision: draft.expectedRevision,
          operationId: draft.operationId,
        });
        checkpoint.credentials.push({ profileId: target.id, endpoint: name, command });
        await boundary.persistCheckpoint(structuredClone(checkpoint));
        await boundary.assertFence();
        try {
          await request(`/api/v1/settings/${name}`, credentialSaveRequest(draft, false));
        } catch {
          combinedSignal.throwIfAborted();
        }
        const readback = await snapshot(target.id, name);
        const result = reconcileCredentialMutation(command, readback, 'save');
        if (
          result.status !== 'confirmed' ||
          !result.key?.isValid ||
          result.key.verification.lastAttempt?.status !== 'verified'
        )
          fail();
        await boundary.assertFence();
      }
    }

    phase = 'model_configuration';
    await boundary.assertFence();
    const current = await authorizeOwner();
    assertModels(current);
    if (!isDeepStrictEqual(current, expectedFinal)) {
      if (checkpoint.modelChangePrepared) fail();
      checkpoint.modelChangePrepared = true;
      await boundary.persistCheckpoint(structuredClone(checkpoint));
      await boundary.assertFence();
      try {
        await request(
          '/api/v1/admin/auto-models',
          {
            model: { aiProvider: 'codex', aiModel: input.selectedModelId },
            platform: { aiProvider: 'codex', aiModel: input.selectedModelId },
          },
          'PATCH'
        );
      } catch {
        combinedSignal.throwIfAborted();
      }
    }
    await boundary.assertFence();
    if (!isDeepStrictEqual(await authorizeOwner(), expectedFinal)) fail();
    phase = 'profile_readback';
    for (const target of input.profiles) {
      await select(target.id);
      if (!(await discover()).isDefault) fail();
    }
    await boundary.assertFence();
    return {
      credentialValidation: 'verified' as const,
      profileCount: input.profiles.length,
      credentialCount: checkpoint.credentials.length,
      modelDiscovery: 'live' as const,
      modelId: input.selectedModelId,
      speechSelectionsPreserved: true as const,
      workloadVerification: 'required' as const,
    };
  } catch {
    throw new ReviewReadinessError(phase);
  }
}
