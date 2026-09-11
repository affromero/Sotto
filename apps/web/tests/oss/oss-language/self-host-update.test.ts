import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const repoRoot = resolve(__dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');

// Executable installer, update, and rollback behavior is covered by
// scripts/tests/test_selfhost.py, run by the root CI command.
describe('self-host downloads', () => {
  it.each(['install.sh', 'sotto-host'])('serves the maintained %s command unchanged', (file) => {
    expect(read(`apps/web/public/${file}`)).toBe(read(`scripts/${file}`));
  });
});
