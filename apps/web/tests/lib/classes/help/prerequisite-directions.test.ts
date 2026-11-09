import { describe, expect, it } from 'vitest';
import {
  prerequisiteDirectionsSchema,
  prerequisiteDirectionBatches,
  preflightPrerequisiteDirections,
  prerequisiteProviderBudget,
  prerequisiteDirectionPayload,
  requirePrerequisiteDirectionBatch,
  requireCompletePrerequisiteDirections,
} from '@/lib/classes/help/content/prerequisite-directions';
import { prerequisitePublicSourceSchema } from '@/lib/classes/help/content/prerequisite-source';
import { prerequisiteBaseAddendumSchema } from '@/lib/classes/help/lifecycle/prerequisite-contract';
import {
  requireModeratedPrerequisitePayload,
  requirePrerequisiteBaseCandidate,
  requirePrerequisiteBaseCapacity,
} from '@/lib/classes/help/content/prerequisite-json';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';

const source = {
  sections: [
    {
      id: 'grammar',
      skill: 'GRAMMAR',
      questions: [{ id: 'q1' }, { id: 'q2' }],
      speaking: [],
      writing: [],
    },
    { id: 'speaking', skill: 'SPEAKING', questions: [], speaking: [{ id: 's1' }], writing: [] },
    { id: 'writing', skill: 'WRITING', questions: [], speaking: [], writing: [{ id: 'w1' }] },
  ],
} as const;
const directions = {
  guided: 'Pide la bebida con cortesía.',
  tasks: [
    {
      sectionId: 'grammar',
      taskId: 'q1',
      kind: 'question',
      instruction: 'Identifica a la persona.',
    },
    { sectionId: 'grammar', taskId: 'q2', kind: 'question', instruction: 'Formula una pregunta.' },
    {
      sectionId: 'speaking',
      taskId: 's1',
      kind: 'speaking',
      instruction: 'Di la frase en voz alta.',
    },
    { sectionId: 'writing', taskId: 'w1', kind: 'writing', instruction: 'Escribe un saludo.' },
  ],
} as const;

describe('prerequisite direction coverage', () => {
  it.each(['\\', 'ࠀ'])(
    'reserves a full reviewed base response for worst-case text: %s',
    (character) => {
      const text = (count: number) => character.repeat(count);
      const base = prerequisiteBaseAddendumSchema.parse({
        title: text(120),
        explanation: text(2800),
        examples: Array.from({ length: 3 }, () => ({
          target: text(250),
          meaning: text(250),
          explanation: text(500),
        })),
      });
      const source = { material: 'x'.repeat(17_900) };
      expect(() => requirePrerequisiteBaseCapacity(JSON.stringify({ source }))).not.toThrow();
      expect(() => requirePrerequisiteBaseCandidate(base)).not.toThrow();
      expect(() =>
        requireModeratedPrerequisitePayload(JSON.stringify({ source, addendum: base }))
      ).not.toThrow();
      expect(
        prerequisiteBaseAddendumSchema.safeParse({ ...base, explanation: text(2801) }).success
      ).toBe(false);
    }
  );
  it('batches a full class without sending answer options, passages or listening transcripts', () => {
    const questions = (count: number, label: string) =>
      Array.from({ length: count }, (_, index) => ({
        id: `${label}-${index}`,
        question: `Instrucción ${index}`,
        options: ['PRIVATE_OPTION_A', 'PRIVATE_OPTION_B'],
        passageText: 'PRIVATE_PASSAGE',
      }));
    const section = (id: string, skill: string) => ({
      id,
      skill,
      attempt: 1,
      status: 'READY',
      questions: [],
      speaking: [],
      writing: [],
      listening: null,
    });
    const input = prerequisitePublicSourceSchema.parse({
      course: { nativeLang: 'es', targetLang: 'ru' },
      lesson: { level: 'A1', title: 'Ruso', objective: 'Pedir' },
      teaching: {
        ...sampleTeaching,
        guidedPractice: {
          prompt: sampleTeaching.guidedPractice.prompt,
          hint: sampleTeaching.guidedPractice.hint,
        },
      },
      sections: [
        { ...section('g', 'GRAMMAR'), questions: questions(5, 'g') },
        { ...section('r', 'READING'), questions: questions(5, 'r') },
        {
          ...section('l', 'LISTENING'),
          questions: questions(4, 'l'),
          listening: [{ speaker: 'A', text: 'PRIVATE_TRANSCRIPT' }],
        },
        {
          ...section('s', 'SPEAKING'),
          speaking: Array.from({ length: 4 }, (_, index) => ({
            id: `s-${index}`,
            targetPhrase: 'Habla',
            translation: 'Saluda',
            ipa: null,
            taskMode: index ? 'COMMUNICATIVE' : 'READ_ALOUD',
          })),
        },
        {
          ...section('w', 'WRITING'),
          writing: Array.from({ length: 3 }, (_, index) => ({
            id: `w-${index}`,
            task: 'Escribe',
            guidance: 'Saluda',
          })),
        },
      ],
    });
    input.sections[0]!.questions[0]!.question =
      'Преврати сообщение после приветствия в вопрос о собеседнике: сохрани лицо и настоящее время (sin añadir «ser»).\nПривет! Ты Павел.';
    const batches = prerequisiteDirectionBatches(input);
    expect(batches.map((batch) => batch.length)).toEqual([7, 7, 7]);
    expect(prerequisiteProviderBudget(batches.length)).toBe(29);
    const reviewed = batches[0]!.map(({ sectionId, taskId, kind }) => ({
      sectionId,
      taskId,
      kind,
      instruction: 'Lee la consigna y responde.',
    }));
    const candidate = { guided: 'Pide una bebida con cortesía.', tasks: reviewed };
    expect(requirePrerequisiteDirectionBatch(batches[0]!, candidate, true)).toEqual(candidate);
    expect(() =>
      requirePrerequisiteDirectionBatch(
        batches[0]!,
        { ...candidate, tasks: reviewed.slice(1) },
        true
      )
    ).toThrow('current exercises');
    expect(() =>
      requirePrerequisiteDirectionBatch(
        batches[0]!,
        {
          ...candidate,
          tasks: [reviewed[0], ...reviewed.slice(0, -1)],
        },
        true
      )
    ).toThrow('current exercises');
    expect(() =>
      requirePrerequisiteDirectionBatch(batches[0]!, { ...candidate, guided: null }, true)
    ).toThrow('guided exercise');
    const payload = prerequisiteDirectionPayload(input, batches[0]!, true, candidate);
    expect(JSON.parse(payload)).toMatchObject({ guided: input.teaching.guidedPractice, candidate });
    expect(payload).not.toMatch(/PRIVATE_OPTION|PRIVATE_PASSAGE|PRIVATE_TRANSCRIPT/);
    const forgedSource = structuredClone(input);
    Object.assign(forgedSource.teaching.guidedPractice, { answer: 'PRIVATE_GUIDED_ANSWER' });
    expect(() => prerequisiteDirectionPayload(forgedSource, batches[0]!, true)).toThrow();
    const forgedBatch = structuredClone(batches[0]!);
    Object.assign(forgedBatch[0]!, { correctIndex: 0 });
    expect(() => prerequisiteDirectionPayload(input, forgedBatch, true)).toThrow();
    expect(() => prerequisiteDirectionPayload(input, batches[1]!, false, candidate)).toThrow(
      'guided exercise'
    );
    const nextCandidate = {
      guided: null,
      tasks: batches[1]!.map(({ sectionId, taskId, kind }) => ({
        sectionId,
        taskId,
        kind,
        instruction: 'Lee la consigna y responde.',
      })),
    };
    expect(
      JSON.parse(prerequisiteDirectionPayload(input, batches[1]!, false, nextCandidate))
    ).toMatchObject({ guided: null, candidate: nextCandidate });
    expect(() => prerequisiteDirectionPayload(input, batches[0]!, true, nextCandidate)).toThrow();
    expect(JSON.stringify(batches)).not.toMatch(
      /PRIVATE_OPTION|PRIVATE_PASSAGE|PRIVATE_TRANSCRIPT/
    );
    expect(batches[0]![0]).toMatchObject({ prompt: expect.stringContaining('Преврати сообщение') });
    expect(batches.flat()).toContainEqual(
      expect.objectContaining({
        taskId: 's-0',
        kind: 'speaking',
        taskMode: 'READ_ALOUD',
      })
    );
    expect(batches.flat()).toContainEqual(
      expect.objectContaining({
        taskId: 's-1',
        kind: 'speaking',
        taskMode: 'COMMUNICATIVE',
      })
    );
    const oversized = structuredClone(input);
    oversized.sections[0]!.questions.forEach((question) => {
      question.question = 'а'.repeat(4000);
    });
    expect(prerequisiteDirectionBatches(oversized).length).toBeGreaterThan(3);
    oversized.sections[0]!.questions[0]!.question = 'а'.repeat(20_000);
    expect(() => prerequisiteDirectionBatches(oversized)).toThrow('too large to review safely');
    const tooManyBatches = structuredClone(input);
    tooManyBatches.sections = [
      {
        ...tooManyBatches.sections[0]!,
        questions: Array.from({ length: 21 }, (_, index) => ({
          id: `long-${index}`,
          question: 'a'.repeat(9000),
          options: ['x', 'y'],
          passageText: null,
        })),
      },
    ];
    expect(() => preflightPrerequisiteDirections(tooManyBatches)).toThrow(
      'too large to review safely'
    );
  });

  it.each([0, -1, 21, 1.5, Number.NaN])('rejects invalid batch counts: %s', (count) => {
    expect(() => prerequisiteProviderBudget(count)).toThrow('unsupported');
  });
  it('accepts complete Unicode text and rejects control characters or broken surrogates', () => {
    expect(
      prerequisiteDirectionsSchema.safeParse({ ...directions, guided: 'Saluda 🐈' }).success
    ).toBe(true);
    expect(
      prerequisiteDirectionsSchema.safeParse({ ...directions, guided: 'Hola\u0000' }).success
    ).toBe(false);
    expect(
      prerequisiteDirectionsSchema.safeParse({ ...directions, guided: 'Hola\ud800' }).success
    ).toBe(false);
  });
  it('accepts one direction for each current exercise in any order', () => {
    const parsed = prerequisiteDirectionsSchema.parse({
      ...directions,
      tasks: [...directions.tasks].reverse(),
    });
    expect(requireCompletePrerequisiteDirections(source, parsed)).toEqual(parsed);
  });

  it.each([
    ['missing', directions.tasks.slice(1)],
    ['duplicate', [...directions.tasks, directions.tasks[0]]],
    [
      'foreign question',
      [...directions.tasks.slice(0, -1), { ...directions.tasks[3], taskId: 'old' }],
    ],
    [
      'wrong section',
      [{ ...directions.tasks[0], sectionId: 'speaking' }, ...directions.tasks.slice(1)],
    ],
    [
      'wrong task kind',
      [{ ...directions.tasks[0], kind: 'writing' }, ...directions.tasks.slice(1)],
    ],
  ])('rejects %s exercise identities', (_description, tasks) => {
    const parsed = prerequisiteDirectionsSchema.parse({ ...directions, tasks });
    expect(() => requireCompletePrerequisiteDirections(source, parsed)).toThrow(
      'current exercises'
    );
  });

  it('rejects ambiguous source identities rather than assigning one instruction twice', () => {
    const ambiguous = { sections: [source.sections[0], source.sections[0]] };
    expect(() =>
      requireCompletePrerequisiteDirections(
        ambiguous,
        prerequisiteDirectionsSchema.parse(directions)
      )
    ).toThrow('ambiguous');
  });

  it('rejects exercise kinds that do not belong to their section', () => {
    const mixed = { sections: [{ ...source.sections[0], speaking: [{ id: 's2' }] }] };
    expect(() => requireCompletePrerequisiteDirections(mixed, directions)).toThrow('ambiguous');
  });
});
