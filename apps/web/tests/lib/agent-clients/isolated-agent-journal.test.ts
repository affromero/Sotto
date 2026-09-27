import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isolatedContainerJournal,
  readIsolatedRecoveryFile,
  reconcileIsolatedAgentWorkspace,
} from '@/lib/agents/isolated/isolated-agent-journal';

const identity = {
  containerName: 'sidedoor-12345678-1234-1234-1234-123456789abc',
  executionId: 'test-execution',
  daemonId: 'test-daemon',
};
describe('isolated container journal', () => {
  it('reads a regular recovery file up to the exact byte limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sotto-isolated-read-'));
    try {
      const path = join(directory, 'binding.json');
      const content = 'a'.repeat(4096);
      await writeFile(path, content);
      expect(await readIsolatedRecoveryFile(path)).toBe(content);
      await writeFile(path, '');
      expect(await readIsolatedRecoveryFile(path)).toBe('');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['symlink', 'oversized', 'directory', 'fifo'] as const)(
    'rejects a %s before recovery or cleanup can trust its identity',
    async (kind) => {
      const directory = await mkdtemp(join(tmpdir(), 'sotto-isolated-invalid-'));
      try {
        const path = join(directory, `isolated-container-${identity.containerName}.json`);
        const target = join(directory, 'original.json');
        await writeFile(target, JSON.stringify(identity));
        if (kind === 'symlink') await symlink(target, path);
        if (kind === 'oversized') await writeFile(path, JSON.stringify(identity).padEnd(4097));
        if (kind === 'directory') await mkdir(path);
        if (kind === 'fifo') execFileSync('mkfifo', [path]);
        await expect(readIsolatedRecoveryFile(path)).rejects.toThrow();
        await expect(isolatedContainerJournal(directory).recordCleanup(identity)).rejects.toThrow();
        await expect(reconcileIsolatedAgentWorkspace(directory)).rejects.toThrow();
        expect(await readFile(target, 'utf8')).toBe(JSON.stringify(identity));
        expect(await readdir(directory)).toContain(
          `isolated-container-${identity.containerName}.json`
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('persists only container identity and requires the same identity before cleanup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sotto-isolated-journal-'));
    try {
      const journal = isolatedContainerJournal(directory);
      await journal.recordIdentity(identity);
      const entries = await readdir(directory);
      expect(entries).toHaveLength(1);
      expect(JSON.parse(await readFile(join(directory, entries[0]), 'utf8'))).toEqual(identity);
      await expect(
        journal.recordCleanup({ ...identity, daemonId: 'other-daemon' })
      ).rejects.toThrow('identity changed');
      expect(await readdir(directory)).toEqual(entries);
      await journal.recordCleanup(identity);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recovers an orphan using its original Docker daemon and clears the persisted identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sotto-isolated-recovery-'));
    const previousPath = process.env.PATH;
    try {
      const state = join(directory, 'container-present');
      await writeFile(state, 'present');
      await writeFile(
        join(directory, 'docker'),
        `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);const state=${JSON.stringify(state)};if(a[0]==='info')console.log('test-daemon');else if(a[0]==='ps'){if(fs.existsSync(state))console.log('owned-container');}else if(a[0]==='inspect')console.log('test-execution');else if(a[0]==='rm')fs.unlinkSync(state);\n`,
        { mode: 0o700 }
      );
      process.env.PATH = directory;
      await isolatedContainerJournal(directory).recordIdentity(identity);
      expect(await reconcileIsolatedAgentWorkspace(directory)).toBe(1);
      expect(
        (await readdir(directory)).filter((name) => name.startsWith('isolated-container-'))
      ).toEqual([]);
      await expect(readFile(state)).rejects.toThrow();
    } finally {
      process.env.PATH = previousPath;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
