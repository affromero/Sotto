import { extractContent } from './extractors';
import { resolveLearningAi } from './learning-ai';
import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import { logUsage } from './usage-logger';

/** Thrown when a source link can't be turned into usable class content. */
export class ClassSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassSourceError';
  }
}

export interface PreparedClassSource {
  /**
   * CEFR-leveled passage in the target language. Used BOTH as the reading
   * passage (`LessonQuestion.passageText`) and as the `sourceContent` fed to
   * `generateScript` for the listening episode.
   */
  leveledContent: string;
  /** Metadata for `generateScript` — note there is NO `url` (it lives on `CourseClass.sourceUrl`). */
  sourceMetadata: { title?: string; author?: string; publishedDate?: string; siteName?: string };
  title: string | null;
  sourceUrl: string;
}

const MIN_SOURCE_CHARS = 280;
const MAX_SOURCE_CHARS = 12_000;

/**
 * Turn a real source (URL → article/paper/video transcript) into a CEFR-leveled
 * passage in the target language, ready to drive a sourced class. Reuses the
 * podcast pipeline's content extractor and the learner's resolved AI. Throws
 * `ClassSourceError` (not a generic Error) when the link can't be used, so the
 * caller can surface an actionable message instead of fabricating a "source".
 */
export async function prepareClassSource(p: {
  url: string;
  level: string;
  targetLang: string;
  nativeLang: string;
  userId: string;
}): Promise<PreparedClassSource> {
  let extracted;
  try {
    extracted = await extractContent(p.url);
  } catch (err) {
    throw new ClassSourceError(
      `Could not read that link: ${err instanceof Error ? err.message : 'extraction failed'}.`,
    );
  }

  const raw = (extracted.text ?? '').trim();
  if (raw.length < MIN_SOURCE_CHARS) {
    throw new ClassSourceError(
      'That link did not have enough readable text to build a class from. Try a different article, paper, or video.',
    );
  }

  const ai = await resolveLearningAi(p.userId);
  const systemPrompt = loadAndRender('class/level-source.md', {
    LEVEL: p.level,
    TARGET: p.targetLang,
    NATIVE: p.nativeLang,
    TITLE: extracted.title ?? '',
    SOURCE: raw.slice(0, MAX_SOURCE_CHARS),
  });

  const provider = createAIProvider(ai.provider);
  const response = await provider.generateResponse(
    systemPrompt,
    [{ role: 'user', content: 'Adapt the source above into the leveled passage.' }],
    { model: ai.model, apiKeyOverride: ai.apiKey, maxTokens: 1200, temperature: 0.4 },
  );

  logUsage({
    service: ai.provider,
    model: response.model,
    category: 'class-source-leveling',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    userId: p.userId,
  });

  const leveledContent = response.content.trim();
  if (leveledContent.length < 80) {
    throw new ClassSourceError('Could not adapt that source to your level. Try a different link.');
  }

  return {
    leveledContent,
    sourceMetadata: {
      title: extracted.title ?? undefined,
      author: extracted.author ?? undefined,
      publishedDate: extracted.publishedDate ?? undefined,
      siteName: extracted.siteName ?? undefined,
    },
    title: extracted.title,
    sourceUrl: p.url,
  };
}
