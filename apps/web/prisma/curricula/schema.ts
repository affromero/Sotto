// Zod contract + loader for the fixed CEFR curriculum skeleton.
// Content lives in prisma/curricula/<pair>/course.json + lessons/*.json and is
// validated here at seed time and in tests/curricula/validate.test.ts.
import { z } from 'zod';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export const targetVocabSchema = z.object({
  lemma: z.string().min(1),
  gloss: z.string().min(1),
  pos: z.string().optional(),
});

export const lessonSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be kebab-case'),
    level: z.enum(CEFR_LEVELS),
    order: z.number().int().positive(),
    title: z.string().min(1),
    objective: z.string().min(1),
    grammarPoints: z.array(z.string().min(1)).min(1),
    vocabThemes: z.array(z.string().min(1)).min(1),
    targetVocab: z.array(targetVocabSchema).min(1),
    canDoSummary: z.string().optional(),
    estMinutes: z.number().int().positive().default(60),
  })
  .strict();

export const courseManifestSchema = z
  .object({
    nativeLang: z.string().length(2),
    targetLang: z.string().length(2),
    title: z.string().min(1),
    version: z.number().int().positive().default(1),
  })
  .strict();

export type LessonInput = z.infer<typeof lessonSchema>;
export type CourseManifest = z.infer<typeof courseManifestSchema>;

export interface LoadedCurriculum {
  manifest: CourseManifest;
  lessons: LessonInput[];
  dir: string;
}

const CURRICULA_DIR = __dirname;

export function listCurriculumPairs(): string[] {
  return readdirSync(CURRICULA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function loadCurriculum(pairDir: string): LoadedCurriculum {
  const dir = join(CURRICULA_DIR, pairDir);
  const manifest = courseManifestSchema.parse(
    JSON.parse(readFileSync(join(dir, 'course.json'), 'utf-8'))
  );

  const lessonsDir = join(dir, 'lessons');
  const files = existsSync(lessonsDir)
    ? readdirSync(lessonsDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];
  const lessons = files.map((f) => {
    try {
      return lessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), 'utf-8')));
    } catch (err) {
      throw new Error(`${pairDir}/lessons/${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Structural invariants: contiguous 1..N order, unique slugs.
  const orders = lessons.map((l) => l.order).sort((a, b) => a - b);
  orders.forEach((o, i) => {
    if (o !== i + 1) {
      throw new Error(`${pairDir}: lesson "order" must be contiguous from 1; got [${orders.join(', ')}]`);
    }
  });
  if (new Set(lessons.map((l) => l.slug)).size !== lessons.length) {
    throw new Error(`${pairDir}: duplicate lesson slug`);
  }

  return { manifest, lessons, dir };
}

export function loadAllCurricula(): LoadedCurriculum[] {
  return listCurriculumPairs().map(loadCurriculum);
}
