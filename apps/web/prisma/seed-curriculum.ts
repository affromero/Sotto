// Seeds the fixed CEFR curriculum skeleton from prisma/curricula/<pair>/.
// Idempotent: upserts Curriculum (by pair) and Lessons (by curriculumId + slug).
// Run: npm run seed:curriculum   (or via scripts/setup.sh on fresh installs)
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { loadAllCurricula } from './curricula/schema';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL }) });

async function main(): Promise<void> {
  const curricula = loadAllCurricula();
  if (curricula.length === 0) {
    console.warn('No curricula found under prisma/curricula/.');
    return;
  }

  for (const { manifest, lessons } of curricula) {
    const curriculum = await prisma.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: manifest.nativeLang, targetLang: manifest.targetLang } },
      create: {
        nativeLang: manifest.nativeLang,
        targetLang: manifest.targetLang,
        title: manifest.title,
        version: manifest.version,
        source: 'seeded',
      },
      update: {
        title: manifest.title,
        version: manifest.version,
        source: 'seeded',
      },
    });

    for (const lesson of lessons) {
      const data = {
        level: lesson.level,
        order: lesson.order,
        title: lesson.title,
        objective: lesson.objective,
        grammarPoints: lesson.grammarPoints,
        vocabThemes: lesson.vocabThemes,
        targetVocab: lesson.targetVocab,
        canDoSummary: lesson.canDoSummary ?? null,
        estMinutes: lesson.estMinutes,
      };
      await prisma.lesson.upsert({
        where: { curriculumId_slug: { curriculumId: curriculum.id, slug: lesson.slug } },
        create: { curriculumId: curriculum.id, slug: lesson.slug, ...data },
        update: data,
      });
    }

    console.log(`Seeded ${manifest.nativeLang}->${manifest.targetLang}: ${lessons.length} lessons`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
