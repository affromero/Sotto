import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';

async function main() {
  const [bindingFile, stopped] = process.argv.slice(2);
  if (!bindingFile || stopped !== '--supervisor-stopped') {
    throw new Error(
      'Usage: npx tsx scripts/reconcile-isolated-agent.ts <execution-binding.json> --supervisor-stopped. Stop the original worker before recovery.'
    );
  }
  if ((await stat(bindingFile)).size > 4096) throw new Error('Execution binding is too large');
  const binding = z
    .object({
      id: z.uuid(),
      parentId: z.uuid(),
      executorId: z.uuid(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .parse(JSON.parse(await readFile(bindingFile, 'utf8')));
  const { recoverIsolatedPreparationExecution } =
    await import('../src/lib/agents/isolated/isolated-agent-recovery');
  const { prismaUnfiltered } = await import('../src/lib/prisma');
  try {
    const result = await recoverIsolatedPreparationExecution({ binding, supervisorStopped: true });
    process.stdout.write(
      `Confirmed local cleanup for execution ${result.executionId}; removed ${result.containers} isolated containers. Provider outcomes remain unknown. The learner must acknowledge that uncertainty in preparation recovery before replacement.\n`
    );
  } finally {
    await prismaUnfiltered.$disconnect();
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Isolated recovery failed'}\n`);
  process.exitCode = 1;
});
