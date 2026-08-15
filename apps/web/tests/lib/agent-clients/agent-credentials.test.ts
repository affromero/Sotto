import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;
let syncDir: string;
let runtimeHome: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sotto-credentials-'));
  syncDir = path.join(tmpDir, 'sync');
  runtimeHome = path.join(tmpDir, 'home');
  fs.mkdirSync(path.join(syncDir, 'requests'), { recursive: true });
  fs.mkdirSync(path.join(syncDir, 'responses'), { recursive: true });
  fs.writeFileSync(path.join(syncDir, 'supports-claude'), '');
  fs.writeFileSync(path.join(syncDir, 'supports-codex'), '');
  vi.stubEnv('SOTTO_CREDENTIAL_SYNC_DIR', syncDir);
  vi.stubEnv('HOME', runtimeHome);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function answerSync(provider: 'claude-code' | 'codex', snapshot: object | null) {
  const requests = path.join(syncDir, 'requests');
  let request: string | undefined;
  for (let attempt = 0; attempt < 50 && !request; attempt += 1) {
    request = fs.readdirSync(requests)[0];
    if (!request) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!request) throw new Error('Credential reload did not request a sync.');
  const snapshotPath = path.join(
    syncDir,
    provider === 'claude-code' ? 'claude-credentials.json' : 'codex-auth.json'
  );
  if (snapshot) fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
  else fs.rmSync(snapshotPath, { force: true });
  fs.writeFileSync(path.join(syncDir, 'responses', request), '');
}

describe('CLI credential reload', () => {
  it('installs a Claude snapshot atomically with private permissions', async () => {
    const credentials = await import('@/lib/agent-credentials');
    const reload = credentials.reloadProviderCredentials('claude-code');
    await answerSync('claude-code', { claudeAiOauth: { accessToken: 'new-token' } });
    await reload;

    const runtime = path.join(runtimeHome, '.claude', '.credentials.json');
    expect(JSON.parse(fs.readFileSync(runtime, 'utf8'))).toEqual({
      claudeAiOauth: { accessToken: 'new-token' },
    });
    expect(fs.statSync(runtime).mode & 0o777).toBe(0o600);
  });

  it('removes runtime credentials when the host is logged out', async () => {
    const runtime = path.join(runtimeHome, '.claude', '.credentials.json');
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.writeFileSync(runtime, '{"stale":true}');
    const credentials = await import('@/lib/agent-credentials');
    const reload = credentials.reloadProviderCredentials('claude-code');
    await answerSync('claude-code', null);
    await reload;
    expect(fs.existsSync(runtime)).toBe(false);
  });

  it('honors CODEX_HOME and rejects reload for SSH', async () => {
    const codexHome = path.join(tmpDir, 'codex-home');
    vi.stubEnv('CODEX_HOME', codexHome);
    const credentials = await import('@/lib/agent-credentials');
    const reload = credentials.reloadProviderCredentials('codex');
    await answerSync('codex', { tokens: { access_token: 'new-token' } });
    await reload;
    expect(JSON.parse(fs.readFileSync(path.join(codexHome, 'auth.json'), 'utf8'))).toEqual({
      tokens: { access_token: 'new-token' },
    });

    vi.stubEnv('CODEX_SSH_HOST', 'agent-host');
    expect(credentials.credentialReloadAvailable('codex')).toBe(false);
  });
});
