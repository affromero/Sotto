import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isolatedContainerJournal,
  reconcileIsolatedAgentWorkspace,
} from '@/lib/agents/isolated/isolated-agent-journal';

const identity = {
  containerName: 'sidedoor-12345678-1234-1234-1234-123456789abc',
  executionId: 'test-execution',
  daemonId: 'test-daemon',
};
describe('isolated container journal', () => {
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
