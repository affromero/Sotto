import { z } from 'zod';
import { readIsolatedRecoveryFile } from '../src/lib/agents/isolated/isolated-agent-journal';

async function main() {
  const [bindingFile, stopped] = process.argv.slice(2);
  if (!bindingFile || stopped !== '--supervisor-stopped')
    throw new Error(
      'Usage: npx tsx scripts/reconcile-speaking-grading.ts <execution-binding.json> --supervisor-stopped. Stop the original worker before recovery.'
    );
  const binding = z
    .object({
      id: z.uuid(),
      parentId: z.uuid(),
      executorId: z.uuid(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .parse(JSON.parse(await readIsolatedRecoveryFile(bindingFile)));
  const { recoverSpeakingExecution } =
    await import('../src/lib/learning/speaking/execution-recovery');
  const { prismaUnfiltered } = await import('../src/lib/prisma');
  try {
    const result = await recoverSpeakingExecution({ binding, supervisorStopped: true });
    process.stdout.write(
      `Confirmed local cleanup for execution ${result.executionId}; removed ${result.containers} isolated containers. Provider outcomes remain unknown.\n`
    );
  } finally {
    await prismaUnfiltered.$disconnect();
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Speaking recovery failed'}\n`);
  process.exitCode = 1;
});
