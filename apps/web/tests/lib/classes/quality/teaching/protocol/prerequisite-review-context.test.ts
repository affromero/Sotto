import { describe, expect, it } from 'vitest';
import { teachingReviewCandidate } from '@/lib/classes/quality/teaching-source/request-candidate';
import type { AIProvider } from '@/lib/providers/ai';
import { sampleTeaching } from '../../../../../helpers/learning/class-teaching';
import { blockedProviderExecution } from '../../../../../helpers/runtime/provider-execution';

const initial = {
  ai: {
    provider: 'fixture',
    model: 'fixture',
    execution: { ...blockedProviderExecution('learner'), initialA1Class: true },
  },
  userId: 'learner',
  provider: {} as AIProvider,
  prompt: 'class/review-teaching-content.md',
  variables: { LEVEL: 'A1', KIND: 'writing', TEACHING_REVIEW_ROLE: 'critic', TARGET: 'ru' },
  items: [{ task: 'Ask for a drink.' }],
  lessonContext: {
    title: 'First class',
    objective: 'Make a request.',
    grammarPoints: [],
    teaching: sampleTeaching,
  },
  jsonSchema: { name: 'fixture', schema: {} },
};

describe('first A1 prerequisite review context', () => {
  it('shows the saved tea example to reviewers without treating the revealed answer as teaching', () => {
    const teaching = {
      ...sampleTeaching,
      workedExamples: [
        {
          prompt: 'Un amigo te da té. Dale las gracias.',
          answer: 'Спасибо за чай. Пожалуйста.',
          explanation: '«Пожалуйста» aquí significa «de nada» en respuesta a las gracias.',
        },
      ],
      guidedPractice: {
        prompt: 'Estás en una cafetería. En el menú pone «чай». Pide esta bebida con cortesía.',
        hint: 'Lee el nombre de la bebida. Añade la fórmula de cortesía.',
        answer: 'Чай, пожалуйста.',
        explanation: 'Al pedir, «пожалуйста» significa «por favor».',
      },
    };
    const candidate = teachingReviewCandidate({
      ...initial,
      lessonContext: { ...initial.lessonContext, teaching },
    });
    expect(candidate.lessonContext?.teaching?.workedExamples).toEqual(teaching.workedExamples);
    expect(candidate.lessonContext?.teaching?.guidedPractice).toEqual({
      prompt: teaching.guidedPractice.prompt,
      hint: teaching.guidedPractice.hint,
    });
    expect(JSON.stringify(candidate.lessonContext?.teaching)).not.toContain('Чай, пожалуйста.');
    expect(JSON.stringify(candidate.lessonContext?.teaching)).not.toContain(
      'Al pedir, «пожалуйста» significa «por favor».'
    );

    const taught = {
      ...teaching,
      workedExamples: [
        ...teaching.workedExamples,
        {
          prompt: 'Pide agua con cortesía.',
          answer: 'Вода, пожалуйста.',
          explanation: 'Al pedir, añade «пожалуйста» al nombre de la bebida.',
        },
      ],
    };
    const corrected = teachingReviewCandidate({
      ...initial,
      lessonContext: { ...initial.lessonContext, teaching: taught },
    });
    expect(corrected.lessonContext?.teaching?.workedExamples).toEqual(taught.workedExamples);
    expect(JSON.stringify(corrected.lessonContext?.teaching)).not.toContain('Чай, пожалуйста.');
  });

  it.each(['explanations', 'listening', 'speaking', 'writing'])(
    'shows pre-disclosure teaching for %s review roles without mutating the lesson',
    (kind) => {
      const original = structuredClone(sampleTeaching);
      for (const role of ['critic', 'adjudicator', 'corroborator']) {
        const candidate = teachingReviewCandidate({
          ...initial,
          variables: { ...initial.variables, KIND: kind, TEACHING_REVIEW_ROLE: role },
        });
        expect(candidate.lessonContext?.teaching?.guidedPractice).toEqual({
          prompt: sampleTeaching.guidedPractice.prompt,
          hint: sampleTeaching.guidedPractice.hint,
        });
        expect(candidate.lessonContext?.teaching?.workedExamples).toEqual(
          sampleTeaching.workedExamples
        );
        expect(candidate.items[0].content).toEqual(initial.items[0]);
      }
      expect(sampleTeaching).toEqual(original);
    }
  );

  it('keeps full teaching for unit review, later A1 classes and other levels', () => {
    for (const options of [
      { ...initial, variables: { ...initial.variables, KIND: 'teaching' } },
      {
        ...initial,
        ai: { ...initial.ai, execution: { ...initial.ai.execution, initialA1Class: false } },
      },
      { ...initial, variables: { ...initial.variables, LEVEL: 'A2' } },
    ]) {
      expect(teachingReviewCandidate(options).lessonContext?.teaching).toEqual(sampleTeaching);
    }
    expect(
      teachingReviewCandidate({ ...initial, lessonContext: undefined }).lessonContext
    ).toBeUndefined();
  });
});
