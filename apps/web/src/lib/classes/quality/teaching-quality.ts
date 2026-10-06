import { z } from 'zod';
import { capturedLearningAiOptions, type CapturedLearningAi } from '../../learning-ai';
import type { AIOptions, AIProvider } from '../../providers/ai';
import { loadAndRender } from '../../prompt-loader';
import { logUsage } from '../../usage-logger';
import { SectionQualityError } from '../section-quality';
import { logger } from '../../logger';
import { classLanguagePolicy } from '../class-language-policy';
import {
  captureTeachingFailure,
  teachingQualityVerdictSchema as verdictSchema,
  type TeachingFailure,
} from './teaching-failure';

export const TEACHING_QUALITY_JSON_SCHEMA = {
  name: 'class_teaching_quality',
  schema: z.toJSONSchema(verdictSchema, { target: 'draft-7' }),
};

/** A complete, protocol-valid review that rejects the learner-visible content. */
export class TeachingQualityRejectionError extends SectionQualityError {
  readonly issues: readonly string[];
  declare readonly feedback: ReadonlyArray<{ index: number; feedback: readonly string[] }>;
  declare readonly teachingFailure?: TeachingFailure;

  constructor(
    issues: readonly string[] = [],
    feedback: ReadonlyArray<{ index: number; feedback: readonly string[] }> = [],
    teachingFailure?: TeachingFailure
  ) {
    super();
    this.name = 'TeachingQualityRejectionError';
    this.issues = issues;
    Object.defineProperties(this, {
      feedback: { value: feedback, enumerable: false },
      teachingFailure: { value: teachingFailure, enumerable: false },
    });
  }
}

/** An inconsistent or malformed review cannot guide a semantic replacement. */
export class ReviewerProtocolError extends SectionQualityError {
  readonly teachingFailure?: TeachingFailure;

  constructor(teachingFailure?: TeachingFailure) {
    super();
    this.name = 'ReviewerProtocolError';
    Object.defineProperty(this, 'teachingFailure', { value: teachingFailure, enumerable: false });
  }
}

/** Shared provider boundary for canonical teaching audits. */
export async function requestTeachingReview(options: {
  ai: CapturedLearningAi;
  provider: AIProvider;
  userId: string;
  prompt: string;
  variables: Record<string, string>;
  items: readonly unknown[];
  jsonSchema: NonNullable<AIOptions['jsonSchema']>;
}): Promise<string> {
  if (options.items.length < 1 || options.items.length > 5) throw new SectionQualityError();
  const response = await options.provider.generateResponse(
    loadAndRender(options.prompt, options.variables),
    [
      {
        role: 'user',
        content: JSON.stringify({
          items: options.items.map((content, index) => ({ index, content })),
        }),
      },
    ],
    {
      ...(await capturedLearningAiOptions(options.ai)),
      maxTokens: 2048,
      temperature: 0,
      jsonSchema: options.jsonSchema,
    }
  );
  logUsage({
    service: options.ai.provider,
    model: response.model,
    category: 'class-teaching-review',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    userId: options.userId,
  });
  return response.content;
}

/** Review exact learner-visible teaching content after independent question solving. */
export async function reviewTeachingContent(options: {
  ai: CapturedLearningAi;
  provider: AIProvider;
  userId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  lessonContext?: { title: string; objective: string; grammarPoints: readonly string[] };
  kind: 'intro' | 'explanations' | 'writing' | 'listening' | 'speaking' | 'vocabulary';
  items: readonly unknown[];
}): Promise<void> {
  const reviewedItems =
    options.kind === 'intro' ? buildIntroAuditItems(options.items) : options.items;
  let languagePolicy = classLanguagePolicy(options);
  if (options.kind === 'vocabulary')
    languagePolicy = [
      `Vocabulary metadata has field-specific languages at every CEFR level: lemma and sourceForm are in the target language (${options.targetLang}), while gloss is a dictionary meaning in the native language (${options.nativeLang}).`,
      'The gloss may be a word or short dictionary phrase. Part-of-speech labels and question indices are structural metadata. Do not reject these metadata fields merely for using their required language or dictionary form.',
      `Apply the class language policy only to the embedded passage, questions, options and explanations, never to vocabulary metadata: ${languagePolicy}`,
    ].join(' ');
  else if (options.kind === 'listening')
    languagePolicy = [
      'In passageText, HOST and EXPERT at turn prefixes are nonspoken speaker identifiers. Known inline audio controls [laughs], [chuckles], [giggles], [with genuine belly laugh], [sighs], [exhales sharply], [whispers], [gasps], [excited], [sarcastic], [curious], [nervously], [cautiously], [pause], [short pause] and [long pause] are nonspoken delivery metadata. Do not reject these identifiers or controls merely for their English spelling.',
      'This exemption applies only to those transcript controls, never to arbitrary bracketed English, spoken words, questions, options or explanations. Preserve speaker attribution when checking the proposed key and explanation.',
      `Apply the class language policy to all spoken transcript content and the full questions, options and explanations: ${languagePolicy}`,
    ].join(' ');
  const content = await requestTeachingReview({
    ...options,
    items: reviewedItems,
    prompt:
      options.kind === 'intro' ? 'class/review-class-intro.md' : 'class/review-teaching-content.md',
    jsonSchema: TEACHING_QUALITY_JSON_SCHEMA,
    variables: {
      REVIEW_SCHEMA: JSON.stringify(TEACHING_QUALITY_JSON_SCHEMA.schema),
      LEVEL: options.level,
      NATIVE: options.nativeLang,
      TARGET: options.targetLang,
      KIND: options.kind,
      LANGUAGE_POLICY: languagePolicy,
      TITLE: options.lessonContext?.title ?? '',
      OBJECTIVE: options.lessonContext?.objective ?? '',
      GRAMMAR_POINTS: options.lessonContext?.grammarPoints.join(', ') ?? '',
    },
  });
  let parsed: z.infer<typeof verdictSchema>;
  try {
    parsed = verdictSchema.parse(JSON.parse(content));
  } catch {
    logger.warn('Teaching review protocol rejected content', {
      kind: options.kind,
      reason: 'invalid_verdict',
    });
    throw new ReviewerProtocolError();
  }
  if (
    parsed.items.length !== reviewedItems.length ||
    new Set(parsed.items.map((item) => item.index)).size !== reviewedItems.length ||
    parsed.items.some((item) => item.index >= reviewedItems.length)
  ) {
    logger.warn('Teaching review protocol rejected content', {
      kind: options.kind,
      reason: 'indices',
    });
    throw new ReviewerProtocolError();
  }
  if (
    parsed.items.some((item) =>
      item.acceptable
        ? item.issues.length > 0 || item.feedback.length > 0
        : item.issues.length === 0 || item.feedback.length === 0
    )
  ) {
    logger.warn('Teaching review protocol rejected content', {
      kind: options.kind,
      reason: 'inconsistent_verdict',
    });
    throw new ReviewerProtocolError();
  }
  if (parsed.items.some((item) => !item.acceptable || item.issues.length > 0)) {
    const issues = [...new Set(parsed.items.flatMap((item) => item.issues))];
    logger.warn('Teaching quality review rejected content', { kind: options.kind, issues });
    const failure = captureTeachingFailure(options.kind, reviewedItems, parsed);
    const rejectedItems = parsed.items.filter((item) => !item.acceptable || item.issues.length > 0);
    const feedback =
      options.kind === 'intro'
        ? aggregateIntroFeedback(rejectedItems, failure)
        : rejectedItems.map(({ index, feedback }) => ({ index, feedback }));
    throw new TeachingQualityRejectionError(issues, feedback, failure);
  }
}

function buildIntroAuditItems(items: readonly unknown[]): readonly unknown[] {
  if (items.length !== 1 || !items[0] || typeof items[0] !== 'object' || Array.isArray(items[0]))
    throw new ReviewerProtocolError();

  const intro = items[0] as Record<string, unknown>;
  const scopes: Array<{ auditFields: string[]; fields: Record<string, unknown> }> = [
    { auditFields: ['purpose'], fields: { purpose: intro.purpose } },
    { auditFields: ['about'], fields: { about: intro.about } },
    { auditFields: ['focus', 'tips'], fields: { focus: intro.focus, tips: intro.tips } },
    { auditFields: ['examples'], fields: { examples: intro.examples } },
  ];
  if (intro.visuals !== undefined)
    scopes.push({ auditFields: ['visuals'], fields: { visuals: intro.visuals } });

  return scopes.map(({ auditFields, fields }) => ({
    auditFields,
    introContext: intro,
    fields,
  }));
}

function aggregateIntroFeedback(
  rejected: Array<{ index: number; feedback: string[] }>,
  teachingFailure: TeachingFailure
): Array<{ index: number; feedback: string[] }> {
  const feedback = rejected.map(({ index, feedback: details }) => {
    const scope =
      index === 0
        ? 'purpose'
        : index === 1
          ? 'about'
          : index === 2
            ? 'focus and tips'
            : index === 3
              ? 'examples'
              : 'visuals';
    const summary = `${scope}: ${details.join(' ')}`;
    if (summary.length > 300) throw new ReviewerProtocolError(teachingFailure);
    return summary;
  });
  if (feedback.length > 6) throw new ReviewerProtocolError(teachingFailure);
  return [{ index: 0, feedback }];
}
