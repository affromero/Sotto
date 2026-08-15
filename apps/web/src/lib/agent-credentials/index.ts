import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AgentProviderId } from '../agent-models/id';

const SYNC_TIMEOUT_MS = 8_000;
const POLL_MS = 100;
let reloadQueue = Promise.resolve();

function syncRoot(): string | null {
  return process.env.SOTTO_CREDENTIAL_SYNC_DIR?.trim() || null;
}

export function credentialReloadAvailable(provider: AgentProviderId): boolean {
  const root = syncRoot();
  if (!root) return false;
  if (provider === 'claude-code') {
    return (
      fs.existsSync(path.join(root, 'supports-claude')) &&
      !process.env.CLAUDE_CODE_SSH_HOST?.trim() &&
      !process.env.CLAUDE_CODE_CREDENTIALS_JSON &&
      !process.env.CLAUDE_CODE_OAUTH_TOKEN
    );
  }
  return fs.existsSync(path.join(root, 'supports-codex')) && !process.env.CODEX_SSH_HOST?.trim();
}

function credentialPaths(provider: AgentProviderId): { snapshot: string; runtime: string } {
  const root = syncRoot();
  if (!root) throw new Error('Credential reload is not configured.');
  const home = process.env.HOME;
  if (!home) throw new Error('The app runtime HOME is not configured.');
  if (provider === 'claude-code') {
    return {
      snapshot: path.join(root, 'claude-credentials.json'),
      runtime: path.join(process.env.CLAUDE_HOME || home, '.claude', '.credentials.json'),
    };
  }
  return {
    snapshot: path.join(root, 'codex-auth.json'),
    runtime: path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'auth.json'),
  };
}

async function waitFor(pathname: string): Promise<void> {
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(pathname)) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error('The credential sync service did not answer in time.');
}

function installSnapshot(snapshot: string, runtime: string): void {
  if (!fs.existsSync(snapshot)) {
    fs.rmSync(runtime, { force: true });
    return;
  }
  const contents = fs.readFileSync(snapshot, 'utf8');
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The host credential file is not a JSON object.');
  }
  fs.mkdirSync(path.dirname(runtime), { recursive: true });
  const temporary = `${runtime}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents, { mode: 0o600 });
  fs.renameSync(temporary, runtime);
}

/** Install the sidecar's latest snapshot before a local CLI probe or invocation. */
export function installCurrentProviderCredentialSnapshot(provider: AgentProviderId): void {
  if (!credentialReloadAvailable(provider)) return;
  const { snapshot, runtime } = credentialPaths(provider);
  if (fs.existsSync(/* turbopackIgnore: true */ snapshot)) installSnapshot(snapshot, runtime);
}

async function performReload(provider: AgentProviderId): Promise<void> {
  if (!credentialReloadAvailable(provider)) {
    throw new Error('Credential reload is unavailable for this provider.');
  }
  const root = syncRoot() as string;
  const nonce = crypto.randomBytes(16).toString('hex');
  const request = path.join(root, 'requests', nonce);
  const response = path.join(root, 'responses', nonce);
  fs.writeFileSync(request, '', { flag: 'wx' });
  try {
    await waitFor(response);
    const { snapshot, runtime } = credentialPaths(provider);
    installSnapshot(snapshot, runtime);
    const [{ resetAgentStatusCache }, { resetCodexModelDiscoveryCache }] = await Promise.all([
      import('../agent-availability'),
      import('../agent-models/codex-app-server'),
    ]);
    resetAgentStatusCache();
    resetCodexModelDiscoveryCache();
  } finally {
    fs.rmSync(request, { force: true });
    fs.rmSync(response, { force: true });
  }
}

export function reloadProviderCredentials(provider: AgentProviderId): Promise<void> {
  const reload = reloadQueue.then(() => performReload(provider));
  reloadQueue = reload.catch(() => undefined);
  return reload;
}
