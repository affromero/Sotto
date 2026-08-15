import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tmpDir: string;
let child: ChildProcess | null;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sotto-auth-sync-'));
  child = null;
});

afterEach(() => {
  child?.kill('SIGTERM');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Credential sync script did not reach the expected state.');
}

describe('credential sync sidecar script', () => {
  it('observes atomic login replacement and removes credentials on logout', async () => {
    const sync = path.join(tmpDir, 'sync');
    const claude = path.join(tmpDir, 'claude');
    const codex = path.join(tmpDir, 'codex');
    fs.mkdirSync(claude);
    fs.mkdirSync(codex);
    const source = path.join(claude, '.credentials.json');
    fs.writeFileSync(source, '{"token":"old"}', { mode: 0o600 });

    child = spawn('sh', [path.join(process.cwd(), '../../scripts/agent/sync-cli-credentials.sh')], {
      env: {
        ...process.env,
        SOTTO_SYNC_ROOT: sync,
        SOTTO_HOST_CLAUDE_DIR: claude,
        SOTTO_HOST_CODEX_DIR: codex,
      },
      stdio: 'ignore',
    });
    await waitFor(() => fs.existsSync(path.join(sync, 'ready')));
    expect(fs.readFileSync(path.join(sync, 'claude-credentials.json'), 'utf8')).toBe(
      '{"token":"old"}'
    );

    fs.writeFileSync(path.join(claude, '.credentials.new'), '{"token":"new"}');
    fs.renameSync(path.join(claude, '.credentials.new'), source);
    fs.writeFileSync(path.join(sync, 'requests', 'login'), '');
    await waitFor(() => fs.existsSync(path.join(sync, 'responses', 'login')));
    expect(fs.readFileSync(path.join(sync, 'claude-credentials.json'), 'utf8')).toBe(
      '{"token":"new"}'
    );

    fs.rmSync(source);
    fs.writeFileSync(path.join(sync, 'requests', 'logout'), '');
    await waitFor(() => fs.existsSync(path.join(sync, 'responses', 'logout')));
    expect(fs.existsSync(path.join(sync, 'claude-credentials.json'))).toBe(false);
  });
});
