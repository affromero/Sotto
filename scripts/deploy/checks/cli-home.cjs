const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { statSync } = require('node:fs');
const readline = require('node:readline');

async function main() {
  const home = process.env.CODEX_HOME;
  const owner = Number(process.env.EXPECTED_UID);
  const before = statSync(home);
  assert.equal(process.getuid(), owner, 'The runtime matches the shared CLI home owner');
  assert.equal(before.uid, owner, 'The shared CLI home has the expected owner');
  assert.equal(before.mode & 0o777, 0o700, 'The CLI home remains private');
  const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise((resolve) => child.once('close', resolve));
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const lines = readline.createInterface({ input: child.stdout });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Codex startup timed out: ${stderr}`)),
        15_000
      );
      function finish(error) {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      }
      child.once('error', finish);
      child.stdin.on('error', finish);
      child.once('exit', (code) => finish(new Error(`Codex exited ${code}: ${stderr}`)));
      lines.on('line', (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.id !== 1) return;
        if (message.error) return finish(new Error(JSON.stringify(message.error)));
        if (!message.result?.userAgent)
          return finish(new Error('Codex initialization returned no user agent'));
        finish();
      });
      child.stdin.write(
        `${JSON.stringify({
          id: 1,
          method: 'initialize',
          params: { clientInfo: { name: 'sotto-image-smoke', version: '1.0.0' } },
        })}\n`
      );
    });
    const after = statSync(home);
    assert.equal(after.ino, before.ino, 'CLI startup preserves the shared home');
    assert.equal(after.mode & 0o777, 0o700, 'CLI startup keeps the home private');
    console.log(`Codex initializes with the private UID ${owner} home.`);
  } finally {
    lines.close();
    child.stdin.destroy();
    const force = setTimeout(() => child.kill('SIGKILL'), 1_000);
    const deadline = setTimeout(() => {
      console.error('Codex did not terminate after SIGKILL.');
      process.exit(1);
    }, 5_000);
    try {
      child.kill('SIGTERM');
      await closed;
    } finally {
      clearTimeout(force);
      clearTimeout(deadline);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
