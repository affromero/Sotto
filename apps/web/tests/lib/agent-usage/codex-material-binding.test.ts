// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCodexMaterialBinding } from '@/lib/agent-usage/providers/codex';
import type { UsageProviderContext } from '@/lib/agent-usage/types';

// The database admission is the system boundary. Account capture, credential parsing,
// filesystem reads, model resolution and persistent HMAC derivation are real.
const boundary = vi.hoisted(() => ({
  identity: {
    recipient: { userId: 'material-owner', generation: 1 },
    instance: { id: 'instance-1' },
  },
  revoked: false,
}));
vi.mock('@/lib/prisma', () => ({ prisma: {}, prismaUnfiltered: {} }));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  captureSottoProviderAdmission: async () => ({
    identity: structuredClone(boundary.identity),
    validate: async (signal: AbortSignal) => {
      signal.throwIfAborted();
      if (boundary.revoked) throw new Error('Material authority was revoked.');
    },
  }),
}));

describe('durable local Codex material account binding', () => {
  let directory: string;
  const context: UsageProviderContext = {
    userId: 'material-owner',
    authorize: async () => ({ userId: 'material-owner' }),
  };
  const options = { model: 'codex:reviewed-model#effort=high' };
  async function auth(overrides: Record<string, unknown> = {}) {
    await writeFile(
      join(directory, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: { access_token: 'synthetic-oauth-one', account_id: 'account-one' },
        last_refresh: '2026-01-01T00:00:00Z',
        ...overrides,
      })
    );
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sotto-codex-material-binding-'));
    vi.stubEnv('CODEX_HOME', directory);
    vi.stubEnv('CODEX_SSH_HOST', '');
    vi.stubEnv('CODEX_API_KEY', '');
    vi.stubEnv('CODEX_MODEL', '');
    vi.stubEnv('CODEX_MODEL_REASONING_EFFORT', '');
    vi.stubEnv('CODEX_EFFORT', '');
    vi.stubEnv('SOTTO_CREDENTIAL_SYNC_DIR', '');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'synthetic-persistent-material-key');
    vi.stubGlobal('fetch', () => {
      throw new Error('No provider calls are allowed.');
    });
    boundary.identity = {
      recipient: { userId: 'material-owner', generation: 1 },
      instance: { id: 'instance-1' },
    };
    boundary.revoked = false;
    await auth();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  it('persists the same account binding across OAuth rotation and module restart', async () => {
    const first = await captureCodexMaterialBinding(context, options);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await auth({
      tokens: {
        access_token: 'rotated-oauth-two',
        refresh_token: 'rotated-refresh',
        account_id: 'account-one',
      },
      last_refresh: '2026-02-02T00:00:00Z',
    });
    await expect(first.validate()).resolves.toBeUndefined();
    vi.resetModules();
    const restarted = await import('@/lib/agent-usage/providers/codex');
    expect((await restarted.captureCodexMaterialBinding(context, options)).fingerprint).toBe(
      first.fingerprint
    );
    const persisted = JSON.stringify(first);
    expect(persisted).not.toContain('synthetic-oauth-one');
    expect(persisted).not.toContain('rotated-oauth-two');
    expect(persisted).not.toContain('account-one');
    expect(persisted).not.toContain(directory);
  });

  it('rejects an account switch while accepting token renewal for the same account', async () => {
    const binding = await captureCodexMaterialBinding(context, options);
    await auth({ tokens: { access_token: 'other-account-token', account_id: 'account-two' } });
    await expect(binding.validate()).rejects.toThrow(
      'account, model or material authority changed'
    );
  });

  it.each([
    { auth_mode: 'apikey', OPENAI_API_KEY: 'synthetic-key' },
    { auth_mode: 'chatgpt', OPENAI_API_KEY: 'synthetic-mixed-key' },
    { auth_mode: 'chatgpt', OPENAI_API_KEY: ' ' },
    { auth_mode: null },
    { auth_mode: 'unknown' },
    { tokens: { access_token: 'token', account_id: 'unknown' } },
    { tokens: { access_token: 'token', account_id: 'UNKNOWN ' } },
    { tokens: { access_token: 'token' } },
    { tokens: { account_id: 'account-one' } },
  ])('rejects API-key, mixed or unidentifiable authentication: %j', async (overrides) => {
    await auth(overrides);
    await expect(captureCodexMaterialBinding(context, options)).rejects.toThrow(
      'identifiable local Codex OAuth account'
    );
  });

  it('rejects remote execution and an environment API-key override', async () => {
    vi.stubEnv('CODEX_SSH_HOST', 'configured-agent');
    await expect(captureCodexMaterialBinding(context, options)).rejects.toThrow(
      'remote Codex account'
    );
    vi.stubEnv('CODEX_SSH_HOST', '');
    vi.stubEnv('CODEX_API_KEY', 'synthetic-env-key');
    await expect(captureCodexMaterialBinding(context, options)).rejects.toThrow(
      'identifiable local Codex OAuth account'
    );
    vi.stubEnv('CODEX_API_KEY', ' ');
    await expect(captureCodexMaterialBinding(context, options)).rejects.toThrow(
      'identifiable local Codex OAuth account'
    );
  });

  it('binds the canonical Codex home even when the replacement home has the same account', async () => {
    const binding = await captureCodexMaterialBinding(context, options);
    const replacement = join(directory, 'replacement-home');
    await mkdir(replacement);
    await writeFile(
      join(replacement, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: { access_token: 'same-account-new-token', account_id: 'account-one' },
      })
    );
    vi.stubEnv('CODEX_HOME', replacement);
    await expect(binding.validate()).rejects.toThrow('material authority changed');
  });

  it('binds the profile and instance authority and validates revocation', async () => {
    const binding = await captureCodexMaterialBinding(context, options);
    boundary.identity.recipient.generation += 1;
    await expect(binding.validate()).rejects.toThrow('material authority changed');
    boundary.identity.recipient.generation -= 1;
    boundary.identity.instance.id = 'replacement-instance';
    await expect(binding.validate()).rejects.toThrow('material authority changed');
    boundary.revoked = true;
    await expect(binding.validate()).rejects.toThrow('Material authority was revoked');
  });

  it('binds model, effort and encryption-key changes while ignoring unused user config', async () => {
    const binding = await captureCodexMaterialBinding(context, options);
    await writeFile(join(directory, 'config.toml'), 'model = "unrelated-user-default"\n');
    await expect(binding.validate()).resolves.toBeUndefined();
    expect(
      (await captureCodexMaterialBinding(context, { model: 'codex:other#effort=high' })).fingerprint
    ).not.toBe(binding.fingerprint);
    expect(
      (await captureCodexMaterialBinding(context, { model: 'codex:reviewed-model#effort=xhigh' }))
        .fingerprint
    ).not.toBe(binding.fingerprint);
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'replacement-instance-key');
    await expect(binding.validate()).rejects.toThrow('material authority changed');
  });

  it('rejects effective effort drift when effort comes from canonical environment selection', async () => {
    vi.stubEnv('CODEX_MODEL_REASONING_EFFORT', 'high');
    const binding = await captureCodexMaterialBinding(context, { model: 'codex:reviewed-model' });
    expect(binding.selection).toMatchObject({ model: 'reviewed-model', effort: 'high' });
    vi.stubEnv('CODEX_MODEL_REASONING_EFFORT', 'low');
    await expect(binding.validate()).rejects.toThrow(
      'account, model or material authority changed'
    );
  });

  it('refuses unresolved model or effort instead of binding a mutable CLI default', async () => {
    await expect(captureCodexMaterialBinding(context, { model: 'codex' })).rejects.toThrow(
      'explicit Codex model and effort'
    );
    await expect(
      captureCodexMaterialBinding(context, { model: 'codex:reviewed-model' })
    ).rejects.toThrow('explicit Codex model and effort');
  });

  it('validates cancellation before inspecting local credentials', async () => {
    const controller = new AbortController();
    const reason = new Error('Material recognition canceled');
    controller.abort(reason);
    await expect(
      captureCodexMaterialBinding({ ...context, signal: controller.signal }, options)
    ).rejects.toBe(reason);
  });
});
