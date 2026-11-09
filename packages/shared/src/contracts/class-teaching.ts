import { z } from 'zod';

const phrase = z.string().trim().min(1).max(800);
const explanation = z.string().trim().min(1).max(1800);

/** A reviewed lesson, retained with the class that its exercises assess. */
export const classTeachingSchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1).max(160),
    explanation,
    workedExamples: z
      .array(z.object({ prompt: phrase, answer: phrase, explanation }).strict())
      .min(2)
      .max(3),
    commonMistake: z.object({ incorrect: phrase, correction: phrase, explanation }).strict(),
    guidedPractice: z
      .object({ prompt: phrase, hint: phrase, answer: phrase, explanation })
      .strict(),
  })
  .strict();

export type ClassTeaching = z.infer<typeof classTeachingSchema>;

/** Optional native-language scaffolding. Target sentences remain in the accepted lesson. */
export const classLessonHelpSchema = z
  .object({
    title: explanation,
    explanation: z.string().trim().min(1).max(6000),
    workedExamples: z
      .array(
        z
          .object({
            prompt: explanation,
            meaning: explanation,
            explanation,
          })
          .strict()
      )
      .min(2)
      .max(3),
    correctionExplanation: explanation,
    guidedPrompt: explanation,
    guidedHint: explanation,
  })
  .strict();

export type ClassLessonHelp = z.infer<typeof classLessonHelpSchema>;

export const classLessonHelpRequestSchema = z
  .object({
    operationId: z.uuid(),
    attempt: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    retryOf: z.uuid().nullable(),
  })
  .strict();

export const classLessonHelpResponseSchema = z
  .object({
    status: z.enum(['AVAILABLE', 'PENDING', 'READY', 'FAILED']),
    request: classLessonHelpRequestSchema,
    nativeLang: z.string().min(1),
    targetLang: z.string().min(1),
    canRetry: z.boolean(),
    help: classLessonHelpSchema.optional(),
    error: z.string().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'READY' && !value.help)
      context.addIssue({ code: 'custom', message: 'Ready help requires its saved content.' });
    if (value.status === 'FAILED' && !value.error)
      context.addIssue({ code: 'custom', message: 'Failed help requires an explanation.' });
  });

export type ClassLessonHelpResponse = z.infer<typeof classLessonHelpResponseSchema>;

const directionText = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\uD800-\uDFFF]*$/u);
export const classPrerequisiteDirectionTaskSchema = z
  .object({
    sectionId: z.string().min(1),
    taskId: z.string().min(1),
    kind: z.enum(['question', 'speaking', 'writing']),
    instruction: directionText,
  })
  .strict();

export const classPrerequisiteDirectionsSchema = z
  .object({
    guided: directionText,
    tasks: z.array(classPrerequisiteDirectionTaskSchema).min(1).max(100),
  })
  .strict();

export const classPrerequisiteContentSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    explanation: z.string().trim().min(1).max(8000),
    examples: z
      .array(
        z
          .object({
            target: z.string().trim().min(1).max(1000),
            meaning: z.string().trim().min(1).max(1000),
            explanation: z.string().trim().min(1).max(2000),
          })
          .strict()
      )
      .min(1)
      .max(8),
    directions: classPrerequisiteDirectionsSchema,
  })
  .strict();

export const classPrerequisiteRequestSchema = z
  .object({
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const classPrerequisiteAcknowledgmentSchema = z
  .object({
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    receiptId: z.uuid(),
  })
  .strict();

export const classPrerequisiteResponseSchema = z
  .object({
    status: z.enum([
      'AVAILABLE',
      'UNAVAILABLE',
      'PENDING',
      'UNRESOLVED',
      'READY',
      'FAILED',
      'STALE',
    ]),
    request: classPrerequisiteRequestSchema,
    nativeLang: z.string().regex(/^[a-z]{2}$/),
    targetLang: z.string().regex(/^[a-z]{2}$/),
    content: classPrerequisiteContentSchema.optional(),
    canRetry: z.boolean().optional(),
    recoverable: z.boolean().optional(),
    failure: z.literal('UNSAFE').optional(),
    receiptId: z.uuid().optional(),
    acknowledged: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === 'READY') !== (value.content !== undefined))
      context.addIssue({ code: 'custom', message: 'Ready status requires its saved content.' });
    if (
      (value.status === 'READY') !== (value.receiptId !== undefined) ||
      (value.status === 'READY') !== (value.acknowledged !== undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Ready status requires its receipt and acknowledgment state.',
      });
    if (['FAILED', 'STALE'].includes(value.status) !== (value.canRetry !== undefined))
      context.addIssue({
        code: 'custom',
        message: 'Retry availability requires a terminal status.',
      });
    if (value.recoverable !== undefined && value.status !== 'PENDING')
      context.addIssue({ code: 'custom', message: 'Recovery requires pending status.' });
    if (value.failure !== undefined && value.status !== 'FAILED')
      context.addIssue({ code: 'custom', message: 'Failure details require failed status.' });
  });

export type ClassPrerequisiteResponse = z.infer<typeof classPrerequisiteResponseSchema>;

/** The material available before a first-A1 learner opens guided practice. */
export const classPreludeResponseSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('NOT_REQUIRED') }).strict(),
    z.object({ kind: z.literal('REPLAY') }).strict(),
    z.object({ kind: z.literal('GENERATING') }).strict(),
    z.object({ kind: z.literal('UNAVAILABLE') }).strict(),
    z
      .object({
        kind: z.literal('BASE'),
        nativeLang: z.string().regex(/^[a-z]{2}$/),
        targetLang: z.string().regex(/^[a-z]{2}$/),
        receiptId: z.uuid(),
        acknowledged: z.boolean(),
        teaching: classTeachingSchema.omit({ guidedPractice: true }),
      })
      .strict(),
    z
      .object({
        kind: z.literal('ADDENDUM'),
        nativeLang: z.string().regex(/^[a-z]{2}$/),
        targetLang: z.string().regex(/^[a-z]{2}$/),
        request: classPrerequisiteRequestSchema,
        status: z.enum([
          'AVAILABLE',
          'UNAVAILABLE',
          'PENDING',
          'UNRESOLVED',
          'READY',
          'FAILED',
          'STALE',
        ]),
        content: classPrerequisiteContentSchema.omit({ directions: true }).optional(),
        receiptId: z.uuid().optional(),
        acknowledged: z.boolean().optional(),
        canRetry: z.boolean().optional(),
        recoverable: z.boolean().optional(),
        failure: z.literal('UNSAFE').optional(),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.kind !== 'ADDENDUM') return;
    const ready = value.status === 'READY';
    if (
      ready !== (value.content !== undefined) ||
      ready !== (value.receiptId !== undefined) ||
      ready !== (value.acknowledged !== undefined) ||
      ['FAILED', 'STALE'].includes(value.status) !== (value.canRetry !== undefined) ||
      (value.recoverable !== undefined && value.status !== 'PENDING') ||
      (value.failure !== undefined && value.status !== 'FAILED')
    )
      context.addIssue({ code: 'custom', message: 'Prelude status and content do not match.' });
  });

export const classPreludeAcknowledgmentSchema = z
  .object({
    kind: z.enum(['BASE', 'ADDENDUM']),
    receiptId: z.uuid(),
  })
  .strict();

export const classPreludeAcknowledgmentResponseSchema = z
  .object({
    kind: z.enum(['BASE', 'ADDENDUM']),
    receiptId: z.uuid(),
    acknowledged: z.literal(true),
  })
  .strict();

export type ClassPreludeResponse = z.infer<typeof classPreludeResponseSchema>;

export const classAssessmentStatusSchema = z.union([
  z
    .object({
      status: z.enum(['PRACTICE_REQUIRED', 'UNRESOLVED']),
      classAttempt: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      status: z.enum(['AVAILABLE', 'PENDING']),
      classAttempt: z.number().int().positive(),
      revision: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      status: z.literal('READY'),
      classAttempt: z.number().int().positive(),
      assessmentId: z.string().trim().min(1),
      revision: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export type ClassAssessmentStatus = z.infer<typeof classAssessmentStatusSchema>;
export const classAssessmentPrepareSchema = z
  .object({
    classAttempt: z.number().int().positive(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const assessmentId = z.string().trim().min(1).max(256);
const assessmentText = z.string().trim().min(1).max(100_000);
const assessmentQuestion = z
  .object({
    id: assessmentId,
    question: assessmentText,
    options: z.array(assessmentText).length(4),
  })
  .strict();
const assessmentChoiceSection = z
  .object({
    id: assessmentId,
    skill: z.enum(['GRAMMAR', 'READING', 'LISTENING']),
    passageText: z.string().max(100_000).nullable(),
    audioAvailable: z.boolean(),
    items: z.array(assessmentQuestion).max(20),
  })
  .strict();
const assessmentSpeakingSection = z
  .object({
    id: assessmentId,
    skill: z.literal('SPEAKING'),
    items: z
      .array(
        z
          .object({
            id: assessmentId,
            task: assessmentText,
            mode: z.enum(['READ_ALOUD', 'COMMUNICATIVE']),
            referenceAudioAvailable: z.boolean(),
          })
          .strict()
      )
      .max(20),
  })
  .strict();
const assessmentWritingSection = z
  .object({
    id: assessmentId,
    skill: z.literal('WRITING'),
    items: z.array(z.object({ id: assessmentId, task: assessmentText }).strict()).max(20),
  })
  .strict();
export const classAssessmentMaterialSchema = z
  .object({
    id: assessmentId,
    classAttempt: z.number().int().positive(),
    assessmentAttempt: z.number().int().positive(),
    sections: z
      .array(
        z.union([assessmentChoiceSection, assessmentSpeakingSection, assessmentWritingSection])
      )
      .max(5),
  })
  .strict();
export type ClassAssessmentMaterial = z.infer<typeof classAssessmentMaterialSchema>;

export const classAssessmentSubmitSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            itemId: z.string().min(1).max(256),
            selectedIndex: z.number().int().min(0).max(3),
          })
          .strict()
      )
      .max(100)
      .refine((choices) => new Set(choices.map((choice) => choice.itemId)).size === choices.length),
  })
  .strict();

export const classAssessmentWritingRequestSchema = z
  .object({
    text: z
      .string()
      .max(4000)
      .refine((value) => value.trim().length > 0),
  })
  .strict();

export const classAssessmentWritingStatusSchema = z.union([
  z.object({ status: z.literal('NOT_STARTED') }).strict(),
  z
    .object({
      status: z.enum(['RUNNING', 'UNRESOLVED', 'COMPLETED', 'FAILED']),
      text: z.string().max(100_000),
    })
    .strict(),
]);

export const classAssessmentSpeakingStatusSchema = z.union([
  z.object({ status: z.literal('NOT_STARTED') }).strict(),
  z
    .object({
      status: z.enum(['RUNNING', 'UNRESOLVED', 'COMPLETED', 'FAILED']),
      requestId: z.uuid(),
    })
    .strict(),
]);
