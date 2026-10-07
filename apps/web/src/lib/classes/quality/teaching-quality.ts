import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { capturedLearningAiOptions, type CapturedLearningAi } from '../../learning-ai';
import type { AIOptions, AIProvider } from '../../providers/ai';
import { loadAndRender } from '../../prompt-loader';
import { logUsage } from '../../usage-logger';
import { SectionQualityError } from '../section-quality';
import { logger } from '../../logger';
import { classIntroExampleMeaningPolicy, classLanguagePolicy } from '../class-language-policy';
import { learningCredentialFingerprint } from '../preparation-selection';
import {
  captureTeachingFailure,
  introTeachingQualityVerdictSchema,
  teachingFailureSchema,
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

export type IntroAuditAddress =
  | { field: 'purpose' | 'about' | 'visuals' }
  | { field: 'focus' | 'tips' | 'examples'; index: number };

type IntroAuditItem = {
  address: IntroAuditAddress;
  fields: Record<string, unknown>;
};

type IntroAudit = {
  introContext: Record<string, unknown>;
  items: readonly IntroAuditItem[];
};

type PriorIntroReview = {
  ai: CapturedLearningAi;
  selection: {
    provider: string;
    model: string;
    endpoint: string | undefined;
    isolatedImage: string | undefined;
    userId: string;
    signal: AbortSignal | undefined;
    signalAborted: boolean;
    apiKey: string | undefined;
    credentialFingerprint: string | null;
    authorize: CapturedLearningAi['execution']['authorize'];
    onCleanupError: CapturedLearningAi['execution']['onCleanupError'];
    learningSelection: CapturedLearningAi['execution']['learningSelection'];
    providerRequest: CapturedLearningAi['execution']['providerRequest'];
    isolatedWorkspace: { directory: string; markCleanupUnconfirmed: () => void } | undefined;
    registerAudioEpisode: CapturedLearningAi['execution']['registerAudioEpisode'];
  };
  provider: AIProvider;
  userId: string;
  context: string;
  candidate: string;
  failure: TeachingFailure;
  failureEvidence: string;
  issuesEvidence: string;
  feedbackEvidence: string;
  introContext: Record<string, unknown>;
  items: readonly IntroAuditItem[];
  verdict: z.infer<typeof introTeachingQualityVerdictSchema>;
  consumed: boolean;
};

const priorIntroReviews = new WeakMap<TeachingQualityRejectionError, PriorIntroReview>();

export function authenticIntroTeachingFailure(
  rejection: TeachingQualityRejectionError
): TeachingFailure | undefined {
  const prior = priorIntroReviews.get(rejection);
  if (!prior) return undefined;
  return teachingFailureSchema.parse(JSON.parse(prior.failureEvidence));
}

export function getIntroRepairPlan(rejection: TeachingQualityRejectionError): {
  rejectedAddresses: readonly IntroAuditAddress[];
  rejectedFields: readonly string[];
  preserveVisuals: boolean;
} {
  const prior = priorIntroReviews.get(rejection);
  if (!prior || prior.consumed || !priorReceiptIsIntact(prior, rejection))
    throw new ReviewerProtocolError(authenticIntroTeachingFailure(rejection));

  const rejectedFields = new Set<string>();
  const rejectedAddresses: IntroAuditAddress[] = [];
  let preserveVisuals = false;
  for (const item of prior.verdict.items) {
    const auditItem = prior.items[item.index];
    if (!auditItem) throw new ReviewerProtocolError(authenticIntroTeachingFailure(rejection));
    if (!item.acceptable || item.issues.length > 0) {
      rejectedAddresses.push({ ...auditItem.address });
      rejectedFields.add(auditItem.address.field);
    } else if (auditItem.address.field === 'visuals') {
      preserveVisuals = true;
    }
  }
  if (rejectedFields.size === 0)
    throw new ReviewerProtocolError(authenticIntroTeachingFailure(rejection));
  return { rejectedAddresses, rejectedFields: [...rejectedFields], preserveVisuals };
}

/** Shared provider boundary for canonical teaching audits. */
export async function requestTeachingReview(options: {
  ai: CapturedLearningAi;
  provider: AIProvider;
  userId: string;
  prompt: string;
  variables: Record<string, string>;
  items: readonly unknown[];
  introContext?: Record<string, unknown>;
  jsonSchema: NonNullable<AIOptions['jsonSchema']>;
}): Promise<string> {
  if (options.items.length < 1 || options.items.length > 5) throw new SectionQualityError();
  if (options.introContext && options.prompt !== 'class/review-class-intro.md')
    throw new ReviewerProtocolError();
  const response = await options.provider.generateResponse(
    loadAndRender(options.prompt, options.variables),
    [
      {
        role: 'user',
        content: JSON.stringify({
          ...(options.introContext ? { introContext: options.introContext } : {}),
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

function parseTeachingVerdict(
  content: string,
  expectedItems: number,
  kind: TeachingFailure['kind']
): z.infer<typeof verdictSchema> {
  let parsed: z.infer<typeof verdictSchema>;
  try {
    parsed = verdictSchema.parse(JSON.parse(content));
  } catch {
    logger.warn('Teaching review protocol rejected content', {
      kind,
      reason: 'invalid_verdict',
    });
    throw new ReviewerProtocolError();
  }
  if (
    parsed.items.length !== expectedItems ||
    new Set(parsed.items.map((item) => item.index)).size !== expectedItems ||
    parsed.items.some((item) => item.index >= expectedItems)
  ) {
    logger.warn('Teaching review protocol rejected content', { kind, reason: 'indices' });
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
      kind,
      reason: 'inconsistent_verdict',
    });
    throw new ReviewerProtocolError();
  }
  return parsed;
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
  previousIntroRejection?: TeachingQualityRejectionError;
  kind: 'intro' | 'explanations' | 'writing' | 'listening' | 'speaking' | 'vocabulary';
  items: readonly unknown[];
}): Promise<void> {
  if (options.previousIntroRejection && options.kind !== 'intro')
    throw new ReviewerProtocolError(authenticIntroTeachingFailure(options.previousIntroRejection));
  const introAudit = options.kind === 'intro' ? buildIntroAuditItems(options.items) : undefined;
  const introItems = introAudit?.items;
  const allReviewedItems = introItems ?? options.items;
  if (introItems && options.previousIntroRejection)
    takePriorIntroReview(options, introItems, options.previousIntroRejection);
  const reviewedItems = allReviewedItems;
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
  const reviewVariables = {
    REVIEW_SCHEMA: JSON.stringify(TEACHING_QUALITY_JSON_SCHEMA.schema),
    LEVEL: options.level,
    NATIVE: options.nativeLang,
    TARGET: options.targetLang,
    KIND: options.kind,
    LANGUAGE_POLICY: languagePolicy,
    ...(options.kind === 'intro'
      ? { EXAMPLE_MEANING_POLICY: classIntroExampleMeaningPolicy(options) }
      : {}),
    TITLE: options.lessonContext?.title ?? '',
    OBJECTIVE: options.lessonContext?.objective ?? '',
    GRAMMAR_POINTS: options.lessonContext?.grammarPoints.join(', ') ?? '',
  };
  let parsed: z.infer<typeof verdictSchema> | z.infer<typeof introTeachingQualityVerdictSchema>;
  if (introAudit) {
    const aggregate: z.infer<typeof introTeachingQualityVerdictSchema>['items'] = [];
    for (let offset = 0; offset < reviewedItems.length; offset += 5) {
      const batch = reviewedItems.slice(offset, offset + 5);
      const content = await requestTeachingReview({
        ...options,
        items: batch,
        introContext: introAudit.introContext,
        prompt: 'class/review-class-intro.md',
        jsonSchema: TEACHING_QUALITY_JSON_SCHEMA,
        variables: reviewVariables,
      });
      const batchVerdict = parseTeachingVerdict(content, batch.length, options.kind);
      aggregate.push(
        ...batchVerdict.items.map((item) => ({ ...item, index: item.index + offset }))
      );
    }
    aggregate.sort((left, right) => left.index - right.index);
    parsed = introTeachingQualityVerdictSchema.parse({ items: aggregate });
  } else {
    const content = await requestTeachingReview({
      ...options,
      items: reviewedItems,
      prompt: 'class/review-teaching-content.md',
      jsonSchema: TEACHING_QUALITY_JSON_SCHEMA,
      variables: reviewVariables,
    });
    parsed = parseTeachingVerdict(content, reviewedItems.length, options.kind);
  }
  if (parsed.items.some((item) => !item.acceptable || item.issues.length > 0)) {
    const issues = [...new Set(parsed.items.flatMap((item) => item.issues))];
    logger.warn('Teaching quality review rejected content', { kind: options.kind, issues });
    const failure = captureTeachingFailure(
      options.kind,
      introAudit ? introAuditEvidence(introAudit) : reviewedItems,
      parsed
    );
    const rejection = new TeachingQualityRejectionError(
      issues,
      options.kind === 'intro'
        ? aggregateIntroFeedback(
            parsed.items.filter((item) => !item.acceptable || item.issues.length > 0),
            reviewedItems,
            failure
          )
        : parsed.items
            .filter((item) => !item.acceptable || item.issues.length > 0)
            .map(({ index, feedback }) => ({ index, feedback })),
      failure
    );
    if (introAudit && !options.previousIntroRejection) {
      const storedItems = JSON.parse(JSON.stringify(allReviewedItems)) as readonly IntroAuditItem[];
      priorIntroReviews.set(rejection, {
        ai: options.ai,
        selection: {
          provider: options.ai.provider,
          model: options.ai.model,
          endpoint: options.ai.endpoint,
          isolatedImage: options.ai.isolatedImage,
          userId: options.ai.execution.userId,
          signal: options.ai.execution.signal,
          signalAborted: options.ai.execution.signal?.aborted ?? false,
          apiKey: options.ai.apiKey,
          credentialFingerprint: learningCredentialFingerprint(options.ai.execution.credential),
          authorize: options.ai.execution.authorize,
          onCleanupError: options.ai.execution.onCleanupError,
          learningSelection: options.ai.execution.learningSelection
            ? structuredClone(options.ai.execution.learningSelection)
            : undefined,
          providerRequest: options.ai.execution.providerRequest,
          isolatedWorkspace: options.ai.execution.isolatedWorkspace
            ? {
                directory: options.ai.execution.isolatedWorkspace.directory,
                markCleanupUnconfirmed:
                  options.ai.execution.isolatedWorkspace.markCleanupUnconfirmed,
              }
            : undefined,
          registerAudioEpisode: options.ai.execution.registerAudioEpisode,
        },
        provider: options.provider,
        userId: options.userId,
        context: introReviewContext(options),
        candidate: JSON.stringify(options.items),
        failure,
        failureEvidence: JSON.stringify(failure),
        issuesEvidence: JSON.stringify(rejection.issues),
        feedbackEvidence: JSON.stringify(rejection.feedback),
        introContext: JSON.parse(JSON.stringify(introAudit.introContext)),
        items: storedItems,
        verdict: introTeachingQualityVerdictSchema.parse(parsed),
        consumed: false,
      });
    }
    throw rejection;
  }
}

function buildIntroAuditItems(items: readonly unknown[]): IntroAudit {
  if (items.length !== 1 || !items[0] || typeof items[0] !== 'object' || Array.isArray(items[0]))
    throw new ReviewerProtocolError();

  const intro = items[0] as Record<string, unknown>;
  const arrays = ['focus', 'tips', 'examples'] as const;
  for (const field of arrays) {
    if (!Array.isArray(intro[field])) throw new ReviewerProtocolError();
  }
  if (
    (intro.focus as unknown[]).length < 1 ||
    (intro.focus as unknown[]).length > 6 ||
    (intro.tips as unknown[]).length < 1 ||
    (intro.tips as unknown[]).length > 5 ||
    (intro.examples as unknown[]).length < 1 ||
    (intro.examples as unknown[]).length > 5
  )
    throw new ReviewerProtocolError();
  const scopes: Array<{ address: IntroAuditAddress; fields: Record<string, unknown> }> = [
    { address: { field: 'purpose' }, fields: { purpose: intro.purpose } },
    { address: { field: 'about' }, fields: { about: intro.about } },
  ];
  for (const [index, focus] of (Array.isArray(intro.focus) ? intro.focus : []).entries())
    scopes.push({ address: { field: 'focus', index }, fields: { focus } });
  for (const [index, tip] of (Array.isArray(intro.tips) ? intro.tips : []).entries())
    scopes.push({ address: { field: 'tips', index }, fields: { tips: tip } });
  for (const [index, example] of (Array.isArray(intro.examples) ? intro.examples : []).entries())
    scopes.push({ address: { field: 'examples', index }, fields: { example } });
  if (intro.visuals !== undefined)
    scopes.push({ address: { field: 'visuals' }, fields: { visuals: intro.visuals } });

  return { introContext: intro, items: scopes };
}

function introAuditEvidence(audit: IntroAudit) {
  return [
    { introContext: audit.introContext, addresses: audit.items.map(({ address }) => address) },
  ];
}

function aggregateIntroFeedback(
  rejected: Array<{ index: number; feedback: string[] }>,
  reviewedItems: readonly unknown[],
  teachingFailure: TeachingFailure
): Array<{ index: number; feedback: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const { index, feedback: details } of rejected) {
    const item = reviewedItems[index] as IntroAuditItem | undefined;
    if (!item) throw new ReviewerProtocolError(teachingFailure);
    const field = item.address.field;
    const detail = `${formatIntroAuditAddress(item.address)}: ${details.join(' ')}`;
    const entries = grouped.get(field) ?? [];
    entries.push(detail);
    grouped.set(field, entries);
  }
  return [
    {
      index: 0,
      feedback: [...grouped].map(([field, entries]) => `${field}: ${entries.join(' ')}`),
    },
  ];
}

function formatIntroAuditAddress(address: IntroAuditAddress): string {
  return 'index' in address ? `${address.field}[${address.index}]` : address.field;
}

function introAuditAddressKey(address: IntroAuditAddress): string {
  return 'index' in address ? `${address.field}:${address.index}` : address.field;
}

function introReviewContext(options: {
  level: string;
  nativeLang: string;
  targetLang: string;
  lessonContext?: { title: string; objective: string; grammarPoints: readonly string[] };
}): string {
  return JSON.stringify({
    level: options.level,
    nativeLang: options.nativeLang,
    targetLang: options.targetLang,
    lessonContext: options.lessonContext,
  });
}

function takePriorIntroReview(
  options: {
    ai: CapturedLearningAi;
    provider: AIProvider;
    userId: string;
    level: string;
    nativeLang: string;
    targetLang: string;
    lessonContext?: { title: string; objective: string; grammarPoints: readonly string[] };
    items: readonly unknown[];
  },
  currentItems: readonly IntroAuditItem[],
  rejection: TeachingQualityRejectionError
): void {
  const prior = priorIntroReviews.get(rejection);
  if (!prior || prior.consumed || !priorReceiptIsIntact(prior, rejection))
    throw new ReviewerProtocolError(authenticIntroTeachingFailure(rejection));
  prior.consumed = true;
  prior.selection.signal?.throwIfAborted();
  if (
    prior.ai !== options.ai ||
    prior.provider !== options.provider ||
    prior.userId !== options.userId ||
    prior.context !== introReviewContext(options) ||
    prior.selection.provider !== options.ai.provider ||
    prior.selection.model !== options.ai.model ||
    prior.selection.endpoint !== options.ai.endpoint ||
    prior.selection.isolatedImage !== options.ai.isolatedImage ||
    prior.selection.userId !== options.ai.execution.userId ||
    prior.selection.signal !== options.ai.execution.signal ||
    prior.selection.signalAborted !== (options.ai.execution.signal?.aborted ?? false) ||
    prior.selection.apiKey !== options.ai.apiKey ||
    prior.selection.credentialFingerprint !==
      learningCredentialFingerprint(options.ai.execution.credential) ||
    prior.selection.authorize !== options.ai.execution.authorize ||
    prior.selection.onCleanupError !== options.ai.execution.onCleanupError ||
    !isDeepStrictEqual(prior.selection.learningSelection, options.ai.execution.learningSelection) ||
    prior.selection.providerRequest !== options.ai.execution.providerRequest ||
    !isDeepStrictEqual(prior.selection.isolatedWorkspace, options.ai.execution.isolatedWorkspace) ||
    prior.selection.registerAudioEpisode !== options.ai.execution.registerAudioEpisode
  )
    throw new ReviewerProtocolError(authenticIntroTeachingFailure(rejection));

  const priorAddresses = new Set(prior.items.map((item) => introAuditAddressKey(item.address)));
  const currentAddresses = new Set(currentItems.map((item) => introAuditAddressKey(item.address)));
  const rejectedVisual = prior.items.some((item, index) => {
    if (item.address.field !== 'visuals') return false;
    const verdict = prior.verdict.items[index];
    return verdict && (!verdict.acceptable || verdict.issues.length > 0);
  });
  if (
    priorAddresses.size !== prior.items.length ||
    currentAddresses.size !== currentItems.length ||
    [...currentAddresses].some((address) => !priorAddresses.has(address)) ||
    [...priorAddresses].some(
      (address) => !currentAddresses.has(address) && !(address === 'visuals' && rejectedVisual)
    )
  )
    throw new ReviewerProtocolError(authenticIntroTeachingFailure(rejection));
}

function priorReceiptIsIntact(
  prior: PriorIntroReview,
  rejection: TeachingQualityRejectionError
): boolean {
  const evidence = prior.failure.reviews[0];
  const sourceIntro = prior.introContext;
  return (
    prior.failure === rejection.teachingFailure &&
    prior.failureEvidence === JSON.stringify(rejection.teachingFailure) &&
    prior.issuesEvidence === JSON.stringify(rejection.issues) &&
    prior.feedbackEvidence === JSON.stringify(rejection.feedback) &&
    prior.failure.kind === 'intro' &&
    prior.failure.reviews.length === 1 &&
    (evidence?.candidate ===
      JSON.stringify(introAuditEvidence({ introContext: sourceIntro, items: prior.items })) ||
      evidence?.omitted === 'size_limit') &&
    JSON.stringify(evidence?.verdict) === JSON.stringify(prior.verdict) &&
    Boolean(sourceIntro) &&
    JSON.stringify([sourceIntro]) === prior.candidate
  );
}
