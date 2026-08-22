import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const repoRoot = resolve(__dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');

const updater = read('scripts/sotto-host');
const installer = read('scripts/install.sh');

/**
 * `sotto-host` is what a self-hoster runs to move their deployment forward.
 * It ships as a served file, so the copy under apps/web/public must match the
 * source, exactly as install.sh already does.
 */
describe('sotto-host self-host updater', () => {
  it('is served byte-identical to its source', () => {
    expect(read('apps/web/public/sotto-host')).toBe(updater);
    expect(read('apps/web/public/install.sh')).toBe(installer);
  });

  it('updates images rather than a git clone', () => {
    // A self-host install has no repository: install.sh downloads a compose
    // file and runs published images. Any git operation here is a bug.
    expect(updater).not.toMatch(/\bgit (pull|fetch|checkout|merge|clone)\b/);
    expect(updater).toContain('SOTTO_IMAGE_TAG');
    expect(updater).toContain('docker-compose.selfhost.yml');
  });

  it('pins to whatever a person is likely to type', () => {
    // Published images carry `latest` and 8-character shas, so a version tag
    // has to be resolved through the API before it can name an image.
    expect(updater).toContain('^[0-9a-f]{8}$');
    expect(updater).toContain('/commits/${ref}');
    expect(updater).toMatch(/latest\) echo latest/);
  });

  it('takes a backup before restarting, and can be told not to', () => {
    expect(updater).toContain('pg_dump');
    expect(updater).toContain('--no-backup');
  });

  it('reports rather than hides that a rollback leaves the schema forward', () => {
    // Prisma migrations are forward-only; claiming a full rollback would be a
    // lie a self-hoster only discovers when their data is wrong.
    expect(updater).toContain('forward-only');
  });

  it('never sources the env file into its own process', () => {
    // Sourcing .env would pull every secret into the environment of a script
    // that shells out to docker and curl.
    expect(updater).not.toMatch(/^\s*(\.|source)\s+.*\.env/m);
  });

  it('survives set -e when the stack is not running', () => {
    // `[ test ] && command` at statement level exits under `set -e` when the
    // test fails, which is exactly the down-stack case an update must handle.
    const bareGuards = updater
      .split('\n')
      .filter((line) => /^\s*\[[^\]]+\]\s*&&\s*\S/.test(line))
      .filter((line) => !line.includes('||'));
    expect(bareGuards).toEqual([]);
  });

  it('is installed onto PATH by the installer and fetchable on its own', () => {
    expect(installer).toContain('scripts/sotto-host');
    expect(installer).toContain('sotto-host update');
    expect(updater).toContain('https://sotto.fm/sotto-host');
  });

  it('explains where to look when a tag has no published image', () => {
    expect(updater).toContain('pkgs/container/sotto-web');
  });
});
