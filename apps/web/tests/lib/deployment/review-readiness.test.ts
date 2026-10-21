// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { credentialSaveRequestSchema } from 'thesidedoor-core/configuration/credential-client';
import {
  runReviewReadiness,
  ReviewReadinessError,
  type ReviewReadinessCheckpoint,
  type ReviewReadinessInput,
} from '../../../../../scripts/deploy/review/readiness';

const password = 'private review password';
const apiKey = 'private-provider-value';
const context = (id: string) => ({
  instanceId: 'fixture-instance',
  owner: { subjectId: `profile:${id}`, generation: 1234 },
});
const preferences = {
  preferredAiModel: null,
  preferredTtsProvider: null,
  preferredTtsModel: null,
  preferredSttModel: null,
};
function fixture() {
  const input: ReviewReadinessInput = {
    endpoint: 'http://127.0.0.1:43123/',
    householdPassword: password,
    expectedOwnerId: 'owner',
    profiles: ['owner', 'member'].map((id) => ({
      id,
      preferences,
      credentialContext: context(id),
    })),
    expectedAutomaticModels: {
      model: {
        aiProvider: 'anthropic',
        aiModel: 'existing-learning-model',
        ttsProvider: 'openai',
        ttsModel: 'existing-speech-model',
        sttProvider: 'openai',
        sttModel: 'existing-transcription-model',
      },
      platform: { aiProvider: 'anthropic', aiModel: 'existing-platform-model' },
      includedModels: null,
      includedTtsModels: null,
      includedSttModels: null,
    },
    selectedModelId: 'codex',
    speechProvider: 'openai',
    credentialValues: { apiKey },
  };
  const checkpoints: ReviewReadinessCheckpoint[] = [];
  const writes: { path: string; body: unknown; profile: string }[] = [];
  const requests: { path: string; headers: Headers; options: RequestInit }[] = [];
  const stored = new Map<string, ReturnType<typeof credentialSaveRequestSchema.parse>>();
  let selected = '';
  let models = structuredClone(input.expectedAutomaticModels);
  let durable: ReviewReadinessCheckpoint = { credentials: [], modelChangePrepared: false };
  const state = {
    credentialReply: 'normal' as 'normal' | 'lost-after-save' | 'lost-before-save' | 'inconclusive',
    modelReplyLost: false,
    discoveryLive: true,
    ownerAuthorized: true,
    checkpointWritable: true,
    fenceHeld: true,
    loseFenceOnCheckpoint: false,
    profiles: ['owner', 'member'],
  };
  const response = (value: unknown, status = 200, headers?: HeadersInit) =>
    Response.json(value, { status, headers });
  const fetcher: typeof fetch = async (resource, options = {}) => {
    const url = new URL(String(resource));
    expect(url.origin).toBe(input.endpoint.slice(0, -1));
    expect(options.redirect).toBe('error');
    const headers = new Headers(options.headers);
    expect(headers.get('Origin')).toBe('https://demo.sotto.fm');
    expect(headers.get('X-Sidedoor-Origin')).toBe('https://demo.sotto.fm');
    expect(headers.has('Host')).toBe(false);
    const path = url.pathname;
    requests.push({ path, headers, options });
    const body: unknown = options.body ? JSON.parse(String(options.body)) : null;
    if (path === '/api/v1/access/household') {
      expect(body).toEqual({ password });
      return response(
        { principal: null, expiresAt: Date.now() + 60_000, sessionId: 'private-session' },
        200,
        { 'Set-Cookie': 'sotto_session=private-cookie; Secure; HttpOnly; SameSite=Lax; Path=/' }
      );
    }
    expect(headers.get('Cookie')).toBe('sotto_session=private-cookie');
    if (path === '/api/v1/profiles')
      return response({ profiles: state.profiles.map((id) => ({ id, isOwner: id === 'owner' })) });
    if (path === '/api/v1/access/select-profile') {
      selected = (body as { id: string }).id;
      return response({ ok: true });
    }
    if (path === '/api/v1/users/me')
      return response({ id: selected, name: 'Private learner', ...preferences });
    if (path === '/api/v1/access/authorize-owner')
      return response(
        { ok: selected === 'owner' && state.ownerAuthorized },
        state.ownerAuthorized ? 200 : 403
      );
    if (path === '/api/v1/admin/auto-models') {
      if (!state.ownerAuthorized || selected !== 'owner') return response({}, 403);
      if (options.method === 'PATCH') {
        expect(durable.modelChangePrepared).toBe(true);
        const change = body as {
          model: { aiProvider: string; aiModel: string };
          platform: { aiProvider: string; aiModel: string };
        };
        models = {
          ...models,
          model: { ...models.model, ...change.model },
          platform: change.platform,
        };
        writes.push({ path, body, profile: selected });
        if (state.modelReplyLost) throw new TypeError('Private network error');
      }
      return response(models);
    }
    if (path === '/api/v1/ai-models')
      return response({
        models: [
          { id: 'codex', group: 'Codex (Local)', isDefault: models.model.aiProvider === 'codex' },
        ],
        agentModelDiscovery: {
          codex: {
            source: state.discoveryLive ? 'live' : 'curated',
            error: state.discoveryLive ? null : 'Unavailable',
            capabilities: { web: true, vision: true },
          },
        },
      });
    const name = path.split('/').at(-1)!;
    if (name !== 'ai-keys' && name !== 'byok') throw new Error('Unexpected fixture HTTP path');
    const slot = `${selected}/${name}`;
    if (options.method === 'POST') {
      const command = credentialSaveRequestSchema.parse(body);
      const receipt = durable.credentials.find(
        (item) => item.profileId === selected && item.endpoint === name
      );
      expect(receipt?.command.operationId).toBe(command.operationId);
      expect(command.allowUnverified).toBe(false);
      expect(command.context).toEqual({ ...context(selected), scope: name });
      writes.push({ path, body, profile: selected });
      if (state.credentialReply === 'lost-before-save')
        throw new TypeError(`Private error ${apiKey}`);
      if (state.credentialReply === 'inconclusive')
        return response({ status: 'needs_confirmation' });
      stored.set(slot, command);
      if (state.credentialReply === 'lost-after-save')
        throw new TypeError(`Private error ${apiKey}`);
      return response({ status: 'saved', revision: command.operationId, context: command.context });
    }
    const command = stored.get(slot);
    return response({
      context: { ...context(selected), scope: name },
      heads: { openai: command?.operationId ?? null, anthropic: null },
      keys: command
        ? [
            {
              provider: 'openai',
              revision: command.operationId,
              isValid: true,
              verification: {
                lastAttempt: { status: 'verified', checkedAt: 1234 },
                lastConfirmed: { status: 'verified', checkedAt: 1234 },
              },
            },
          ]
        : [],
    });
  };
  const boundary = {
    signal: new AbortController().signal,
    fetch: fetcher,
    assertFence: async () => {
      if (!state.fenceHeld) throw new Error('Fence lost');
    },
    persistCheckpoint: async (checkpoint: ReviewReadinessCheckpoint) => {
      if (!state.checkpointWritable) throw new Error(`Disk error ${apiKey}`);
      durable = structuredClone(checkpoint);
      checkpoints.push(durable);
      if (state.loseFenceOnCheckpoint) state.fenceHeld = false;
    },
  };
  return {
    input,
    state,
    boundary,
    checkpoints,
    writes,
    requests,
    stored,
    checkpoint: () => structuredClone(durable),
    models: () => structuredClone(models),
    run: (
      checkpoint: ReviewReadinessCheckpoint = { credentials: [], modelChangePrepared: false }
    ) => runReviewReadiness(input, checkpoint, boundary),
  };
}

describe('fenced review provider configuration through canonical HTTP', () => {
  it('validates both profiles with durable exact receipts, preserves speech and reports its limited proof', async () => {
    const server = fixture();
    const result = await server.run();
    expect(result).toMatchObject({
      profileCount: 2,
      credentialCount: 4,
      modelDiscovery: 'live',
      workloadVerification: 'required',
    });
    expect(server.stored.size).toBe(4);
    expect(server.models()).toEqual({
      ...server.input.expectedAutomaticModels,
      model: {
        ...server.input.expectedAutomaticModels.model,
        aiProvider: 'codex',
        aiModel: 'codex',
      },
      platform: { aiProvider: 'codex', aiModel: 'codex' },
    });
    const metadata = JSON.stringify({ result, checkpoints: server.checkpoints });
    for (const secret of [apiKey, password, 'private-cookie'])
      expect(metadata).not.toContain(secret);
    expect(server.requests.some((item) => item.path === '/api/v1/access/authorize-owner')).toBe(
      true
    );
  });

  it('reconciles a saved credential after a lost reply without replacing its operation', async () => {
    const server = fixture();
    server.state.credentialReply = 'lost-after-save';
    await server.run();
    expect(server.stored.size).toBe(4);
    expect(
      new Set(server.checkpoint().credentials.map((item) => item.command.operationId)).size
    ).toBe(4);
    expect(server.writes.filter((item) => item.path.includes('/settings/'))).toHaveLength(4);
  });

  it('retains unknown credential intent across restart and never submits a fresh replacement', async () => {
    const server = fixture();
    server.state.credentialReply = 'lost-before-save';
    await expect(server.run()).rejects.toBeInstanceOf(ReviewReadinessError);
    const checkpoint = server.checkpoint();
    expect(checkpoint.credentials).toHaveLength(1);
    expect(server.stored.size).toBe(0);
    server.state.credentialReply = 'normal';
    await expect(server.run(checkpoint)).rejects.toMatchObject({ phase: 'credential_precheck' });
    expect(server.checkpoint()).toEqual(checkpoint);
    expect(server.writes.filter((item) => item.path.includes('/settings/'))).toHaveLength(1);
    expect(server.models()).toEqual(server.input.expectedAutomaticModels);
  });

  it('resumes remaining keys after a partial save without replacing the first confirmed key', async () => {
    const server = fixture();
    const persist = server.boundary.persistCheckpoint;
    server.boundary.persistCheckpoint = async (checkpoint) => {
      if (server.stored.size === 1) throw new Error('Checkpoint disk unavailable');
      await persist(checkpoint);
    };
    await expect(server.run()).rejects.toBeInstanceOf(ReviewReadinessError);
    const first = server.stored.get('owner/ai-keys');
    expect(first).toBeDefined();
    expect(server.checkpoint().credentials).toHaveLength(1);
    expect(server.models()).toEqual(server.input.expectedAutomaticModels);
    server.boundary.persistCheckpoint = persist;
    await server.run(server.checkpoint());
    expect(server.stored.size).toBe(4);
    expect(server.stored.get('owner/ai-keys')).toEqual(first);
    expect(server.writes.filter((item) => item.path.includes('/settings/'))).toHaveLength(4);
  });

  it('refuses an inconclusive key without enabling an unverified save', async () => {
    const server = fixture();
    server.state.credentialReply = 'inconclusive';
    await expect(server.run()).rejects.toBeInstanceOf(ReviewReadinessError);
    expect(server.stored.size).toBe(0);
    expect(server.checkpoint().credentials).toHaveLength(1);
    expect(server.models()).toEqual(server.input.expectedAutomaticModels);
  });

  it('sends no credential when durable checkpoint storage fails and sanitizes errors', async () => {
    const server = fixture();
    server.state.checkpointWritable = false;
    let error: unknown;
    try {
      await server.run();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ReviewReadinessError);
    expect(String(error)).not.toContain(apiKey);
    expect(server.writes).toEqual([]);
    expect(server.stored.size).toBe(0);
  });

  it('stops after checkpoint persistence if the exclusive controller fence disappears', async () => {
    const server = fixture();
    server.state.loseFenceOnCheckpoint = true;
    await expect(server.run()).rejects.toBeInstanceOf(ReviewReadinessError);
    expect(server.checkpoint().credentials).toHaveLength(1);
    expect(server.writes).toEqual([]);
  });

  it('confirms an uncertain model PATCH and resumes without new key or model writes', async () => {
    const server = fixture();
    server.state.modelReplyLost = true;
    await server.run();
    const originalWrites = structuredClone(server.writes);
    await server.run(server.checkpoint());
    expect(server.writes).toEqual(originalWrites);
    expect(server.checkpoint().modelChangePrepared).toBe(true);
  });

  it('refuses curated model offerings before sending any provider credential', async () => {
    const server = fixture();
    server.state.discoveryLive = false;
    await expect(server.run()).rejects.toMatchObject({ phase: 'model_discovery' });
    expect(server.writes).toEqual([]);
  });

  it('requires canonical owner authorization even when profile metadata says owner', async () => {
    const server = fixture();
    server.state.ownerAuthorized = false;
    await expect(server.run()).rejects.toMatchObject({ phase: 'authority' });
    expect(server.writes).toEqual([]);
  });

  it('rejects changed profiles and non-loopback targets before credential mutation', async () => {
    const server = fixture();
    server.state.profiles = ['owner', 'different-member'];
    await expect(server.run()).rejects.toMatchObject({ phase: 'authority' });
    expect(server.writes).toEqual([]);
    server.input.endpoint = 'https://example.com/';
    await expect(server.run()).rejects.toMatchObject({ phase: 'input' });
    expect(server.writes).toEqual([]);
  });
});
