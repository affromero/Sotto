// Agent-composed curricula. The 3 hand-authored curricula (de/en/es) are seeded
// as reference quality; for any other native→target pair the connected LLM
// writes the CEFR lesson skeleton on demand, cached as one Curriculum per pair
// (shared across users). This is the design's "Compose" step.
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from './prisma';
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { logger } from './logger';

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
type CefrLevel = (typeof CEFR)[number];
const RANK: Record<string, number> = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };

const genLessonSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  level: z.enum(CEFR),
  order: z.number().int().positive(),
  title: z.string().min(1),
  objective: z.string().min(1),
  grammarPoints: z.array(z.string().min(1)).min(1),
  vocabThemes: z.array(z.string().min(1)).min(1),
  targetVocab: z
    .array(
      z.object({ lemma: z.string().min(1), gloss: z.string().min(1), pos: z.string().optional() })
    )
    .min(1),
  canDoSummary: z.string().optional(),
  estMinutes: z.number().int().positive().default(60),
});
const genSchema = z.object({ title: z.string().min(1), lessons: z.array(genLessonSchema).min(1) });
const genLevelSchema = z.object({ lessons: z.array(genLessonSchema).min(1) });

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  nl: 'Dutch',
  ru: 'Russian',
  tr: 'Turkish',
  pl: 'Polish',
  sv: 'Swedish',
};

function langName(code: string): string {
  return LANG_NAMES[code] ?? code.toUpperCase();
}

function stripJsonFences(content: string): string {
  return content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
}

function parseGeneratedLevelLessons(
  content: string,
  level: CefrLevel
): z.infer<typeof genLessonSchema>[] {
  const parsed = genLevelSchema.parse(JSON.parse(stripJsonFences(content)));
  return parsed.lessons.filter((lesson) => lesson.level === level);
}

/**
 * Return the curriculum id for a native→target pair, generating it via the
 * learner's connected agent if one doesn't already exist. Idempotent: a
 * concurrent creation (P2002 on the unique pair) re-fetches the winner.
 */
export async function getOrCreateCurriculum(
  userId: string,
  nativeLang: string,
  targetLang: string
): Promise<{ id: string }> {
  const existing = await prisma.curriculum.findUnique({
    where: { nativeLang_targetLang: { nativeLang, targetLang } },
    select: { id: true },
  });
  if (existing) return existing;

  const ai = await resolveLearningAi(userId);

  const systemPrompt = loadAndRender('curriculum/generate-curriculum.md', {
    NATIVE: langName(nativeLang),
    TARGET: langName(targetLang),
  });
  const client = createAIProvider(ai.provider);
  const res = await client.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Compose the ${langName(targetLang)} curriculum skeleton.` }],
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 8000, temperature: 0.6 }
  );
  logUsage({
    service: ai.provider,
    model: res.model,
    category: 'curriculum-generation',
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    userId,
  });

  const cleaned = res.content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  let parsed: z.infer<typeof genSchema>;
  try {
    parsed = genSchema.parse(JSON.parse(cleaned));
  } catch (err) {
    throw new Error(
      `Curriculum generation produced invalid output: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Drop duplicate slugs, sort by CEFR level then given order, renumber contiguously.
  const seen = new Set<string>();
  const lessons = parsed.lessons
    .filter((l) => (seen.has(l.slug) ? false : (seen.add(l.slug), true)))
    .sort((a, b) => RANK[a.level] - RANK[b.level] || a.order - b.order);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const cur = await tx.curriculum.create({
        data: { nativeLang, targetLang, title: parsed.title, source: 'generated' },
      });
      await tx.lesson.createMany({
        data: lessons.map((l, i) => ({
          curriculumId: cur.id,
          level: l.level,
          order: i + 1,
          slug: l.slug,
          title: l.title,
          objective: l.objective,
          grammarPoints: l.grammarPoints,
          vocabThemes: l.vocabThemes,
          targetVocab: l.targetVocab,
          canDoSummary: l.canDoSummary ?? null,
          estMinutes: l.estMinutes,
        })),
      });
      return cur;
    });
    logger.info('Composed curriculum', { nativeLang, targetLang, lessons: String(lessons.length) });
    return { id: created.id };
  } catch (err) {
    // Lost a race to a concurrent creation — return the existing one.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const again = await prisma.curriculum.findUnique({
        where: { nativeLang_targetLang: { nativeLang, targetLang } },
        select: { id: true },
      });
      if (again) return again;
    }
    throw err;
  }
}

/**
 * Seeded reference curricula currently cover the early ladder. If a learner is
 * placed directly into a higher CEFR band, extend that shared curriculum before
 * picking the next class so a B1 learner never receives the first A1 lesson.
 */
export async function ensureCurriculumHasLevelLessons(p: {
  userId: string;
  curriculumId: string;
  nativeLang: string;
  targetLang: string;
  level: CefrLevel;
}): Promise<void> {
  const existingCount = await prisma.lesson.count({
    where: { curriculumId: p.curriculumId, level: p.level },
  });
  if (existingCount > 0) return;

  const ai = await resolveLearningAi(p.userId);
  const systemPrompt = loadAndRender('curriculum/generate-level-lessons.md', {
    NATIVE: langName(p.nativeLang),
    TARGET: langName(p.targetLang),
    LEVEL: p.level,
  });

  const client = createAIProvider(ai.provider);
  const res = await client.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Compose ${p.level} ${langName(p.targetLang)} lessons.` }],
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 7000, temperature: 0.6 }
  );

  logUsage({
    service: ai.provider,
    model: res.model,
    category: 'curriculum-level-generation',
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    userId: p.userId,
  });

  let generated: z.infer<typeof genLessonSchema>[];
  try {
    generated = parseGeneratedLevelLessons(res.content, p.level);
  } catch (err) {
    throw new Error(
      `Curriculum level generation produced invalid output: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (generated.length === 0) {
    throw new Error(`Curriculum level generation produced no ${p.level} lessons.`);
  }

  const existingSlugs = await prisma.lesson.findMany({
    where: { curriculumId: p.curriculumId },
    select: { slug: true },
  });
  const slugSet = new Set(existingSlugs.map((lesson) => lesson.slug));
  const seen = new Set<string>();
  const lessons = generated
    .filter((lesson) => {
      if (slugSet.has(lesson.slug) || seen.has(lesson.slug)) return false;
      seen.add(lesson.slug);
      return true;
    })
    .sort((a, b) => a.order - b.order);

  if (lessons.length === 0) {
    const nowExists = await prisma.lesson.count({
      where: { curriculumId: p.curriculumId, level: p.level },
    });
    if (nowExists > 0) return;
    throw new Error(`Curriculum level generation produced only duplicate ${p.level} lessons.`);
  }

  const maxOrder = await prisma.lesson.aggregate({
    where: { curriculumId: p.curriculumId },
    _max: { order: true },
  });
  const startOrder = maxOrder._max.order ?? 0;

  try {
    await prisma.lesson.createMany({
      data: lessons.map((lesson, index) => ({
        curriculumId: p.curriculumId,
        level: lesson.level,
        order: startOrder + index + 1,
        slug: lesson.slug,
        title: lesson.title,
        objective: lesson.objective,
        grammarPoints: lesson.grammarPoints,
        vocabThemes: lesson.vocabThemes,
        targetVocab: lesson.targetVocab,
        canDoSummary: lesson.canDoSummary ?? null,
        estMinutes: lesson.estMinutes,
      })),
    });
    logger.info('Extended curriculum level', {
      nativeLang: p.nativeLang,
      targetLang: p.targetLang,
      level: p.level,
      lessons: String(lessons.length),
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const nowExists = await prisma.lesson.count({
        where: { curriculumId: p.curriculumId, level: p.level },
      });
      if (nowExists > 0) return;
    }
    throw err;
  }
}
