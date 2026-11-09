import { describe, expect, it } from 'vitest';
import {
  classTeachingSchema,
  classLessonHelpSchema,
  classLessonHelpResponseSchema,
  classPrerequisiteRequestSchema,
  classPrerequisiteResponseSchema,
  classPrerequisiteAcknowledgmentSchema,
  classPreludeResponseSchema,
  classPreludeAcknowledgmentSchema,
  classAssessmentStatusSchema,
  classAssessmentMaterialSchema,
  classAssessmentSpeakingStatusSchema,
} from '../../src/contracts/class-teaching';
import { classDetailResponseSchema } from '../../src/contracts/schemas';

describe('assessment speaking status', () => {
  it('requires a request identity for retained work and rejects private feedback', () => {
    const requestId = '10000000-0000-4000-8000-000000000001';
    expect(classAssessmentSpeakingStatusSchema.safeParse({ status: 'NOT_STARTED' }).success).toBe(
      true
    );
    for (const status of ['RUNNING', 'UNRESOLVED', 'COMPLETED', 'FAILED']) {
      expect(classAssessmentSpeakingStatusSchema.safeParse({ status, requestId }).success).toBe(
        true
      );
      expect(classAssessmentSpeakingStatusSchema.safeParse({ status }).success).toBe(false);
      expect(
        classAssessmentSpeakingStatusSchema.safeParse({ status, requestId, transcript: 'private' })
          .success
      ).toBe(false);
    }
    expect(
      classAssessmentSpeakingStatusSchema.safeParse({ status: 'NOT_STARTED', requestId }).success
    ).toBe(false);
  });
});

const teaching = {
  version: 1,
  title: 'A missed train',
  explanation: 'Explain what happened before you arrived at the station.',
  workedExamples: [
    {
      prompt: 'Report the journey.',
      answer: 'Ich bin zum Bahnhof gefahren.',
      explanation: 'Fahren uses sein here because the person travelled to another place.',
    },
    {
      prompt: 'Report the purchase.',
      answer: 'Ich habe eine Fahrkarte gekauft.',
      explanation: 'Kaufen uses haben. The participle closes this statement.',
    },
  ],
  commonMistake: {
    incorrect: 'Ich habe zum Bahnhof gefahren.',
    correction: 'Ich bin zum Bahnhof gefahren.',
    explanation: 'Use sein for this journey.',
  },
  guidedPractice: {
    prompt: 'Report that Mia travelled home.',
    hint: 'Choose the auxiliary for the journey before adding the participle.',
    answer: 'Mia ist nach Hause gefahren.',
    explanation: 'The auxiliary agrees with Mia; gefahren stays at the end.',
  },
} as const;

const historicalClass = {
  id: 'class-1',
  courseId: 'course-1',
  status: 'AVAILABLE',
  order: 9,
  passThreshold: 0.7,
  submitted: false,
  sections: [],
};

describe('class lesson contract', () => {
  it('rejects private answers, rubrics, and media locators in assessment material', () => {
    const material = {
      id: 'assessment',
      classAttempt: 1,
      assessmentAttempt: 1,
      sections: [
        {
          id: 'reading',
          skill: 'READING',
          passageText: 'Texto',
          audioAvailable: false,
          items: [{ id: 'question', question: '¿Qué?', options: ['a', 'b', 'c', 'd'] }],
        },
        {
          id: 'speaking',
          skill: 'SPEAKING',
          items: [
            { id: 'prompt', task: 'Saluda', mode: 'READ_ALOUD', referenceAudioAvailable: true },
          ],
        },
        { id: 'writing', skill: 'WRITING', items: [{ id: 'writing-task', task: 'Escribe' }] },
        {
          id: 'listening',
          skill: 'LISTENING',
          passageText: null,
          audioAvailable: true,
          items: [{ id: 'audio-question', question: '¿Qué oyes?', options: ['a', 'b', 'c', 'd'] }],
        },
      ],
    };
    expect(classAssessmentMaterialSchema.safeParse(material).success).toBe(true);
    const choice = material.sections[0] as { items: Array<Record<string, unknown>> };
    expect(
      classAssessmentMaterialSchema.safeParse({
        ...material,
        sections: [{ ...choice, items: [{ ...choice.items[0], correctIndex: 1 }] }],
      }).success
    ).toBe(false);
    const speech = material.sections[1] as { items: Array<Record<string, unknown>> };
    expect(
      classAssessmentMaterialSchema.safeParse({
        ...material,
        sections: [
          {
            ...speech,
            items: [{ ...speech.items[0], privateRubric: 'secret', storageRef: '/private' }],
          },
        ],
      }).success
    ).toBe(false);
    expect(
      classAssessmentMaterialSchema.safeParse({
        ...material,
        sections: [{ ...material.sections[3], audioUrl: '/private', privateTranscript: 'secret' }],
      }).success
    ).toBe(false);
  });
  it('exposes only the assessment identifier when an owned assessment is ready', () => {
    for (const status of ['PRACTICE_REQUIRED', 'UNRESOLVED']) {
      expect(classAssessmentStatusSchema.safeParse({ status, classAttempt: 1 }).success).toBe(true);
      expect(
        classAssessmentStatusSchema.safeParse({ status, classAttempt: 1, assessmentId: 'hidden' })
          .success
      ).toBe(false);
    }
    expect(
      classAssessmentStatusSchema.safeParse({
        status: 'PENDING',
        classAttempt: 1,
        revision: 'a'.repeat(64),
      }).success
    ).toBe(true);
    expect(
      classAssessmentStatusSchema.safeParse({ status: 'PENDING', classAttempt: 1 }).success
    ).toBe(false);
    expect(
      classAssessmentStatusSchema.safeParse({
        status: 'AVAILABLE',
        classAttempt: 1,
        revision: 'a'.repeat(64),
      }).success
    ).toBe(true);
    expect(
      classAssessmentStatusSchema.safeParse({ status: 'AVAILABLE', classAttempt: 1 }).success
    ).toBe(false);
    expect(
      classAssessmentStatusSchema.safeParse({
        status: 'READY',
        classAttempt: 1,
        assessmentId: 'assessment',
        revision: 'a'.repeat(64),
      }).success
    ).toBe(true);
    expect(
      classAssessmentStatusSchema.safeParse({ status: 'READY', classAttempt: 1 }).success
    ).toBe(false);
    expect(
      classAssessmentStatusSchema.safeParse({
        status: 'READY',
        classAttempt: 1,
        assessmentId: 'assessment',
        revision: 'a'.repeat(64),
        correctIndex: 1,
      }).success
    ).toBe(false);
  });
  it('accepts only a prelude that omits guided work and uses an opaque receipt', () => {
    const { guidedPractice, ...beforePractice } = teaching;
    const base = {
      kind: 'BASE',
      nativeLang: 'en',
      targetLang: 'de',
      receiptId: '00000000-0000-4000-a000-000000000001',
      acknowledged: false,
      teaching: beforePractice,
    };
    expect(classPreludeResponseSchema.safeParse(base).success).toBe(true);
    expect(
      classPreludeResponseSchema.safeParse({
        ...base,
        teaching: { ...beforePractice, guidedPractice },
      }).success
    ).toBe(false);
    expect(
      classPreludeResponseSchema.safeParse({ ...base, materialHash: 'a'.repeat(64) }).success
    ).toBe(false);
    expect(
      classPreludeAcknowledgmentSchema.safeParse({ kind: 'BASE', receiptId: base.receiptId })
        .success
    ).toBe(true);
    expect(
      classPreludeAcknowledgmentSchema.safeParse({
        kind: 'BASE',
        receiptId: base.receiptId,
        sourceHash: 'a'.repeat(64),
      }).success
    ).toBe(false);
    expect(
      classPreludeResponseSchema.safeParse({
        kind: 'ADDENDUM',
        nativeLang: 'es',
        targetLang: 'ru',
        request: { sourceHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64) },
        status: 'READY',
      }).success
    ).toBe(false);
    expect(
      classPreludeResponseSchema.safeParse({
        kind: 'ADDENDUM',
        nativeLang: 'es',
        targetLang: 'ru',
        status: 'AVAILABLE',
        request: { sourceHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64) },
      }).success
    ).toBe(true);
  });
  it('requires the current revision and only exposes complete ready teaching', () => {
    const request = { sourceHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64) };
    const languages = { nativeLang: 'es', targetLang: 'ru' };
    expect(classPrerequisiteRequestSchema.safeParse({ ...request, extra: true }).success).toBe(
      false
    );
    expect(
      classPrerequisiteResponseSchema.safeParse({ status: 'READY', request, ...languages }).success
    ).toBe(false);
    expect(
      classPrerequisiteResponseSchema.safeParse({
        status: 'PENDING',
        request,
        ...languages,
        content: 'leak',
      }).success
    ).toBe(false);
    for (const extra of [
      { receiptId: '00000000-0000-4000-a000-000000000001' },
      { acknowledged: false },
      { receiptId: '00000000-0000-4000-a000-000000000001', acknowledged: false },
    ])
      expect(
        classPrerequisiteResponseSchema.safeParse({
          status: 'AVAILABLE',
          request,
          ...languages,
          ...extra,
        }).success
      ).toBe(false);
    expect(
      classPrerequisiteResponseSchema.safeParse({
        status: 'AVAILABLE',
        request,
        ...languages,
        recoverable: true,
      }).success
    ).toBe(false);
    expect(
      classPrerequisiteResponseSchema.safeParse({
        status: 'PENDING',
        request,
        ...languages,
        failure: 'UNSAFE',
      }).success
    ).toBe(false);
    expect(
      classPrerequisiteResponseSchema.parse({
        status: 'READY',
        receiptId: '00000000-0000-4000-a000-000000000001',
        acknowledged: false,
        request,
        ...languages,
        content: {
          title: 'Pedir',
          explanation: 'Pide con cortesía.',
          examples: [
            {
              target: 'Вода, пожалуйста',
              meaning: 'Agua, por favor',
              explanation: 'Una petición.',
            },
          ],
          directions: {
            guided: 'Pide una bebida.',
            tasks: [
              {
                sectionId: 'g',
                taskId: 'q',
                kind: 'question',
                instruction: 'Formula una pregunta.',
              },
            ],
          },
        },
      }).status
    ).toBe('READY');
    expect(
      classPrerequisiteAcknowledgmentSchema.safeParse({
        sourceHash: request.sourceHash,
        receiptId: '00000000-0000-4000-a000-000000000001',
      }).success
    ).toBe(true);
    expect(
      classPrerequisiteAcknowledgmentSchema.safeParse({
        sourceHash: request.sourceHash,
        receiptId: 'invalid',
      }).success
    ).toBe(false);
  });
  it('keeps native explanations separate from authoritative target answers', () => {
    const help = {
      title: 'Explain the journey',
      explanation: 'Choose the auxiliary for the journey.',
      workedExamples: teaching.workedExamples.map((example) => ({
        prompt: example.prompt,
        meaning: 'A completed journey or purchase.',
        explanation: example.explanation,
      })),
      correctionExplanation: 'Use sein for this journey.',
      guidedPrompt: 'Report the journey.',
      guidedHint: 'Choose the auxiliary first.',
    };
    expect(classLessonHelpSchema.parse(help).workedExamples[0].meaning).toContain('journey');
    expect(
      classLessonHelpSchema.safeParse({ ...help, guidedAnswer: teaching.guidedPractice.answer })
        .success
    ).toBe(false);
    expect(
      classLessonHelpSchema.safeParse({
        ...help,
        workedExamples: help.workedExamples.map((example, index) =>
          index === 0 ? { ...example, answer: 'changed target' } : example
        ),
      }).success
    ).toBe(false);
    expect(
      classLessonHelpResponseSchema.safeParse({
        status: 'READY',
        request: {
          operationId: '00000000-0000-4000-a000-000000000001',
          attempt: 1,
          sourceHash: 'a'.repeat(64),
          retryOf: null,
        },
        nativeLang: 'en',
        targetLang: 'de',
        canRetry: false,
      }).success
    ).toBe(false);
  });
  it('retains worked examples and guided practice in the class response', () => {
    const parsed = classDetailResponseSchema.parse({ ...historicalClass, teaching });
    expect(parsed.teaching).toEqual(teaching);
  });

  it('loads historical classes without inventing a lesson', () => {
    const parsed = classDetailResponseSchema.parse(historicalClass);
    expect(parsed).not.toHaveProperty('teaching');
  });

  it('retains the saved assessment receipt in a class response', () => {
    const receipt = {
      source: 'ASSESSMENT',
      passed: true,
      overallScore: 0.9,
      passedSections: 1,
      totalSections: 1,
      sections: [{ id: 'assessment-reading', skill: 'READING', score: 0.9, passed: true }],
    };
    const parsed = classDetailResponseSchema.parse({
      ...historicalClass,
      submission: { passed: true, overallScore: 0.9, receipt },
    });
    expect(parsed.submission?.receipt).toEqual(receipt);
  });

  it('accepts only a valid optional prerequisite source revision', () => {
    expect(
      classDetailResponseSchema.parse({
        ...historicalClass,
        prerequisiteSourceHash: 'a'.repeat(64),
      }).prerequisiteSourceHash
    ).toBe('a'.repeat(64));
    expect(
      classDetailResponseSchema.safeParse({ ...historicalClass, prerequisiteSourceHash: 'invalid' })
        .success
    ).toBe(false);
    expect(
      classDetailResponseSchema.parse({ ...historicalClass, prerequisiteSourceHash: null })
        .prerequisiteSourceHash
    ).toBeNull();
  });

  it('rejects incomplete teaching instead of publishing a quiz-only lesson', () => {
    const incomplete = { ...teaching, workedExamples: [], explanation: '' };
    expect(classTeachingSchema.safeParse(incomplete).success).toBe(false);
    expect(
      classDetailResponseSchema.safeParse({ ...historicalClass, teaching: incomplete }).success
    ).toBe(false);
  });
});
