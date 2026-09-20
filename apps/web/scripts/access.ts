import { parseAccessCommand } from 'thesidedoor-core/access';

async function main() {
  const args = process.argv.slice(2);
  if (!(args.length === 1 && args[0] === 'finalize')) parseAccessCommand(args);
  const { prismaUnfiltered } = await import('../src/lib/prisma');
  try {
    const { runSottoAccessCommand } = await import('../src/lib/sidedoor/access/core/operator');
    const result = await runSottoAccessCommand(args, prismaUnfiltered);
    process.stdout.write(`${result}\n`);
  } finally {
    await prismaUnfiltered.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Access command failed');
  process.exitCode = 1;
});
