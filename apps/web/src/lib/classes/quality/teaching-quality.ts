import { z } from 'zod';
import { capturedLearningAiOptions, type CapturedLearningAi } from '../../learning-ai';
import type { AIProvider } from '../../providers/ai';
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
  constructor() {
    super();
    this.name = 'ReviewerProtocolError';
  }
}

/** Review exact learner-visible teaching content after independent question solving. */
export async function reviewTeachingContent(options: {
  ai: CapturedLearningAi;
  provider: AIProvider;
  userId: string;
  level: string;
  nativeLang: string;
  targetLang: string;
  kind: 'intro' | 'explanations' | 'writing' | 'listening' | 'speaking' | 'vocabulary';
  items: readonly unknown[];
}): Promise<void> {
  if (options.items.length < 1 || options.items.length > 5) throw new SectionQualityError();
  const response = await options.provider.generateResponse(
    loadAndRender('class/review-teaching-content.md', {
      REVIEW_SCHEMA: JSON.stringify(TEACHING_QUALITY_JSON_SCHEMA.schema),
      LEVEL: options.level,
      NATIVE: options.nativeLang,
      TARGET: options.targetLang,
      KIND: options.kind,
      LANGUAGE_POLICY: classLanguagePolicy(options),
    }),
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
      jsonSchema: TEACHING_QUALITY_JSON_SCHEMA,
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
  let parsed: z.infer<typeof verdictSchema>;
  try {
    parsed = verdictSchema.parse(JSON.parse(response.content));
  } catch {
    logger.warn('Teaching review protocol rejected content', {
      kind: options.kind,
      reason: 'invalid_verdict',
    });
    throw new ReviewerProtocolError();
  }
  if (
    parsed.items.length !== options.items.length ||
    new Set(parsed.items.map((item) => item.index)).size !== options.items.length ||
    parsed.items.some((item) => item.index >= options.items.length)
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
    throw new TeachingQualityRejectionError(
      issues,
      parsed.items
        .filter((item) => !item.acceptable || item.issues.length > 0)
        .map(({ index, feedback }) => ({ index, feedback })),
      captureTeachingFailure(options.kind, options.items, parsed)
    );
  }
}
