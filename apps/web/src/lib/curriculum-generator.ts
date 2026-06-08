// Agent-composed curricula. The 3 hand-authored curricula (de/en/es) are seeded
// as reference quality; for any other native→target pair the connected LLM
// writes the CEFR lesson skeleton on demand, cached as one Curriculum per pair
// (shared across users). This is the design's "Compose" step.
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getAiKey } from './byok';
import { getAiProviderMeta } from './providers/ai-registry';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';
import { logger } from './logger';

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
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
    .array(z.object({ lemma: z.string().min(1), gloss: z.string().min(1), pos: z.string().optional() }))
    .min(1),
  canDoSummary: z.string().optional(),
  estMinutes: z.number().int().positive().default(60),
});
const genSchema = z.object({ title: z.string().min(1), lessons: z.array(genLessonSchema).min(1) });

const LANG_NAMES: Record<string, string> = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian',
  pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic',
  nl: 'Dutch', ru: 'Russian', tr: 'Turkish', pl: 'Polish', sv: 'Swedish',
};

function langName(code: string): string {
  return LANG_NAMES[code] ?? code.toUpperCase();
}

/**
 * Return the curriculum id for a native→target pair, generating it via the
 * learner's connected agent if one doesn't already exist. Idempotent: a
 * concurrent creation (P2002 on the unique pair) re-fetches the winner.
 */
export async function getOrCreateCurriculum(
  userId: string,
  nativeLang: string,
  targetLang: string,
): Promise<{ id: string }> {
  const existing = await prisma.curriculum.findUnique({
    where: { nativeLang_targetLang: { nativeLang, targetLang } },
    select: { id: true },
  });
  if (existing) return existing;

  const aiKey = await getAiKey(userId);
  if (!aiKey) {
    throw new Error('An AI provider (or a configured local Claude/Codex) is required to compose this course.');
  }
  const model = getAiProviderMeta(aiKey.provider).defaultModel;
  if (!model) throw new Error(`No default AI model configured for provider "${aiKey.provider}".`);

  const systemPrompt = loadAndRender('curriculum/generate-curriculum.md', {
    NATIVE: langName(nativeLang),
    TARGET: langName(targetLang),
  });
  const ai = createAIProvider(aiKey.provider);
  const res = await ai.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Compose the ${langName(targetLang)} curriculum skeleton.` }],
    { model, apiKeyOverride: aiKey.apiKey, maxTokens: 8000, temperature: 0.6 },
  );
  logUsage({
    service: aiKey.provider,
    model: res.model,
    category: 'curriculum-generation',
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    userId,
  });

  const cleaned = res.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let parsed: z.infer<typeof genSchema>;
  try {
    parsed = genSchema.parse(JSON.parse(cleaned));
  } catch (err) {
    throw new Error(
      `Curriculum generation produced invalid output: ${err instanceof Error ? err.message : String(err)}`,
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
