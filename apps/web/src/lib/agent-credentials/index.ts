import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AgentProviderId } from '../agent-models/id';

const SYNC_TIMEOUT_MS = 8_000;
const POLL_MS = 100;
let reloadQueue = Promise.resolve();

/**
 * How far along a credentials file is in its rotation, or -1 when unreadable.
 *
 * Both CLIs mint a new refresh token in place and retire the previous one, so a
 * copy taken before a rotation is dead the moment it is restored. Neither file
 * carries a generation counter, but both carry a timestamp that only moves
 * forward: Claude's refresh token expiry, and Codex's last_refresh. That is
 * enough to answer the only question here — is what I am about to write older
 * than what is already on disk? It cannot see a token retired out of band,
 * which is why an unreadable file always loses.
 */
export function credentialGeneration(provider: AgentProviderId, contents: string): number {
  try {
    const parsed = JSON.parse(contents) as {
      claudeAiOauth?: { refreshTokenExpiresAt?: unknown };
      last_refresh?: unknown;
    };
    if (provider === 'claude-code') {
      const expiry = parsed?.claudeAiOauth?.refreshTokenExpiresAt;
      return typeof expiry === 'number' ? expiry : -1;
    }
    const refreshed =
      typeof parsed?.last_refresh === 'string' ? Date.parse(parsed.last_refresh) : NaN;
    return Number.isNaN(refreshed) ? -1 : refreshed;
  } catch {
    return -1;
  }
}

/** True when `candidate` should replace whatever `pathname` currently holds. */
export function supersedesCredentials(
  provider: AgentProviderId,
  pathname: string,
  candidate: string
): boolean {
  let existing: string;
  try {
    existing = fs.readFileSync(pathname, 'utf8');
  } catch {
    return true; // Nothing there yet.
  }
  const current = credentialGeneration(provider, existing);
  if (current < 0) return true; // Unreadable or malformed — anything beats it.
  return credentialGeneration(provider, candidate) > current;
}

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
      runtime: path.join(
        process.env.CLAUDE_HOME || path.join(home, '.claude'),
        '.credentials.json'
      ),
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

function installSnapshot(provider: AgentProviderId, snapshot: string, runtime: string): void {
  if (!fs.existsSync(snapshot)) {
    fs.rmSync(runtime, { force: true });
    return;
  }
  const contents = fs.readFileSync(snapshot, 'utf8');
  if (!supersedesCredentials(provider, runtime, contents)) {
    // The host mount is read-only, so its copy is retired the moment this
    // container refreshes from it. Restoring it would undo the rotation.
    return;
  }
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
  if (fs.existsSync(/* turbopackIgnore: true */ snapshot)) {
    installSnapshot(provider, snapshot, runtime);
  }
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
    installSnapshot(provider, snapshot, runtime);
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
