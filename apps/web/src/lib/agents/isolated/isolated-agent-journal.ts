import { open, readdir, readFile, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DockerIsolatedRunner, type IsolatedIdentity } from 'thesidedoor-core/runtime/isolated';

const identitySchema = z
  .object({
    containerName: z.string().regex(/^sidedoor-[a-f0-9-]{36}$/),
    executionId: z.string().min(1).max(200),
    daemonId: z.string().min(1).max(200),
  })
  .strict();
const prefix = 'isolated-container-';
async function syncDirectory(directory: string) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function identityPath(directory: string, identity: IsolatedIdentity) {
  const valid = identitySchema.parse(identity);
  return join(directory, `${prefix}${valid.containerName}.json`);
}

/** The caller supplies an inode-bound workspace owned by the durable job journal. */
export function isolatedContainerJournal(directory: string) {
  return {
    async recordIdentity(identity: IsolatedIdentity): Promise<void> {
      const path = identityPath(directory, identity);
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(identitySchema.parse(identity)));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(directory);
    },
    async recordCleanup(identity: IsolatedIdentity): Promise<void> {
      const path = identityPath(directory, identity);
      const recorded = identitySchema.parse(JSON.parse(await readFile(path, 'utf8')));
      if (JSON.stringify(recorded) !== JSON.stringify(identitySchema.parse(identity)))
        throw new Error('Isolated container journal identity changed');
      await unlink(path);
      await syncDirectory(directory);
    },
  };
}

/** Operator recovery after the journal's exact supervisor has been stopped.
 * This confirms container removal only. Provider outcomes and job settlement stay separate.
 */
export async function reconcileIsolatedAgentWorkspace(directory: string): Promise<number> {
  const entries = (await readdir(directory)).filter((entry) => entry.startsWith(prefix));
  if (entries.length > 1000) throw new Error('Isolated recovery requires a bounded workspace');
  const journal = isolatedContainerJournal(directory);
  for (const name of entries) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
      throw new Error('Invalid isolated container journal file');
    const identity = identitySchema.parse(JSON.parse(await readFile(path, 'utf8')));
    if (identityPath(directory, identity) !== path)
      throw new Error('Isolated container journal path changed');
    await new DockerIsolatedRunner().reconcile(identity);
    await journal.recordCleanup(identity);
  }
  return entries.length;
}
