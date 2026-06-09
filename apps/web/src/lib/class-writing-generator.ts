// Generates the WRITING section of a class: LLM authors short writing tasks
// (no TTS, unlike speaking). composeWritingPrompts is the content-only core
// (reused by practice); generateClassWriting adds the ClassSection + WritingPrompt
// persistence.
import { prisma } from './prisma';
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { formatNotesForPrompt } from './course-notes';
import { logUsage } from './usage-logger';
import { logger } from './logger';

const WRITING_PROMPT_COUNT = 3;

export interface WritingPromptsParams {
  userId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  objective: string;
  targetVocab: Array<{ lemma: string; gloss: string }>;
  note?: string;
}

export interface ComposedWritingPrompt {
  task: string;
  guidance: string | null;
}

interface RawWritingPrompt {
  task: string;
  guidance?: string;
}

function isValidRawPrompt(item: unknown): item is RawWritingPrompt {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return typeof obj.task === 'string' && obj.task.trim() !== '';
}

export async function composeWritingPrompts(p: WritingPromptsParams): Promise<ComposedWritingPrompt[]> {
  const ai = await resolveLearningAi(p.userId);

  const vocabList = p.targetVocab.map((v) => `${v.lemma} — ${v.gloss}`).join('\n');
  const systemPrompt = loadAndRender('writing/generate-writing-prompts.md', {
    COUNT: String(WRITING_PROMPT_COUNT),
    LEVEL: p.level,
    NATIVE: p.nativeLang,
    TARGET: p.targetLang,
    OBJECTIVE: p.objective,
    VOCAB: vocabList,
    NOTES: formatNotesForPrompt(p.note ?? ''),
  });

  const client = createAIProvider(ai.provider);
  const res = await client.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `Generate ${WRITING_PROMPT_COUNT} writing tasks.` }],
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 2048, temperature: 0.7 },
  );

  logUsage({
    service: ai.provider,
    model: res.model,
    category: 'class-writing-prompts',
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    userId: p.userId,
  });

  const cleaned = res.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let raw: unknown[];
  try {
    const parsed = JSON.parse(cleaned);
    raw = Array.isArray(parsed) ? parsed : [];
  } catch {
    raw = [];
  }

  const prompts = raw
    .filter(isValidRawPrompt)
    .slice(0, WRITING_PROMPT_COUNT)
    .map((r) => ({ task: r.task, guidance: typeof r.guidance === 'string' ? r.guidance : null }));

  if (prompts.length === 0) {
    throw new Error('Writing prompt generation produced no usable tasks.');
  }
  return prompts;
}

export interface ClassWritingParams {
  userId: string;
  classId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  objective: string;
  targetVocab: Array<{ lemma: string; gloss: string }>;
  note?: string;
}

export interface ClassWritingResult {
  sectionId: string;
}

export async function generateClassWriting(p: ClassWritingParams): Promise<ClassWritingResult> {
  const prompts = await composeWritingPrompts({
    userId: p.userId,
    level: p.level,
    nativeLang: p.nativeLang,
    targetLang: p.targetLang,
    objective: p.objective,
    targetVocab: p.targetVocab,
    note: p.note,
  });

  const section = await prisma.classSection.create({
    data: {
      classId: p.classId,
      skill: 'WRITING',
      attempt: 1,
      seed: `${p.classId}-WRITING-1`,
      spec: { objective: p.objective },
      status: 'READY',
      generatedAt: new Date(),
    },
  });

  await prisma.writingPrompt.createMany({
    data: prompts.map((c, i) => ({
      sectionId: section.id,
      order: i + 1,
      task: c.task,
      guidance: c.guidance,
    })),
  });

  logger.info('Writing section generated', {
    classId: p.classId,
    sectionId: section.id,
    promptCount: String(prompts.length),
  });
  return { sectionId: section.id };
}
