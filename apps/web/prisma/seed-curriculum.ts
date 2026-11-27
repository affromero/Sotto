// Seed the fixed CEFR curriculum skeleton from prisma/curricula/<pair>/.
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { loadAllCurricula, loadCurriculum } from './curricula/schema';
import { seedCurriculum } from './curricula/seed';

function seedInputs(args: string[]) {
  if (args.length === 0) {
    return { curricula: loadAllCurricula(), missingId: undefined, expectedReceipt: undefined };
  }
  const [command, pair, missingId, verify] = args;
  if (
    (args.length !== 3 && (args.length !== 4 || verify !== '--verify-receipt')) ||
    command !== '--add-missing-pair' ||
    !/^[a-z]{2}-from-[a-z]{2}$/.test(pair) ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(missingId)
  ) {
    throw new Error(
      'Usage: seed-curriculum.ts [--add-missing-pair <target>-from-<native> <id> [--verify-receipt]]'
    );
  }
  const curriculum = loadCurriculum(pair);
  if (
    pair !== curriculum.manifest.targetLang + '-from-' + curriculum.manifest.nativeLang ||
    !curriculum.lessons.length
  ) {
    throw new Error('Additive seed requires a matching authored curriculum.');
  }
  let expectedReceipt: unknown;
  if (verify === '--verify-receipt') {
    const raw = readFileSync(0);
    if (!raw.length || raw.length > 4096)
      throw new Error('Read a bounded seed receipt from stdin.');
    expectedReceipt = JSON.parse(raw.toString('utf8'));
  }
  return { curricula: [curriculum], missingId, expectedReceipt };
}

async function main(): Promise<void> {
  const { curricula, missingId, expectedReceipt } = seedInputs(process.argv.slice(2));
  if (!curricula.length) {
    console.warn('No curricula found under prisma/curricula/.');
    return;
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
    }),
  });
  try {
    for (const curriculum of curricula) {
      const { nativeLang, targetLang } = curriculum.manifest;
      const mapping = await seedCurriculum(prisma, curriculum, missingId, expectedReceipt);
      if (missingId !== undefined) {
        const { curriculumId, lessons, mapped, unresolved, status, catalogRevision } = mapping;
        process.stdout.write(
          JSON.stringify({
            nativeLang,
            targetLang,
            curriculumId,
            lessons,
            mapped,
            unresolved,
            status,
            catalogRevision,
          }) + '\n'
        );
      } else {
        process.stdout.write(
          `Seeded ${nativeLang}->${targetLang}: ${curriculum.lessons.length} lessons, ${mapping.mapped} objective links, ${mapping.unresolved} unresolved scopes (${mapping.status})\n`
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
