import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'fixture', model: 'fixture' }),
  capturedLearningAiOptions: async () => ({ model: 'fixture' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { generateSectionQuestions } from '@/lib/class-generation';
import { SectionQualityError } from '@/lib/classes/section-quality';

const lemmas = ['gemacht', 'gegangen', 'gesehen', 'besucht', 'gestern'];
const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  skill: 'GRAMMAR' as const,
  vocabularyReview: true,
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  objective: 'Understand actions and time in context.',
  grammarPoints: [],
  targetVocab: lemmas.map((lemma) => ({ lemma, gloss: lemma })),
  seed: 'full617-competing-verbs',
};

// FULL617 generation: a duplicate in item 2 prevented the blind solve from
// exposing the competing seen/done and seen/visited options before replacement.
const original = [
  {
    targetIndex: 0,
    taskContext: 'Ben hat jede Aufgabe selbst erledigt, bevor er zum Training ging.',
    question: 'Vor dem Fußballtraining hat Ben alle Aufgaben für die Schule _____.',
    distractors: ['gesehen', 'besucht', 'gegangen'],
    correctIndex: 2,
    explanation: 'Ben hat die Aufgaben erledigt; hier passt „gemacht“.',
    passageRef: '',
  },
  {
    targetIndex: 1,
    taskContext: 'Nora verließ nach dem Frühstück das Haus und lief zu Fuß zur Bäckerei.',
    question: 'Nach dem Frühstück ist Nora zu Fuß zur Bäckerei _____.',
    distractors: ['gefahren', 'gemacht', 'besucht'],
    correctIndex: 0,
    explanation: 'Nora war zu Fuß unterwegs; dazu passt „gegangen“.',
    passageRef: '',
  },
  {
    targetIndex: 2,
    taskContext:
      'Leo stand eine Minute vor dem Bild und betrachtete es, ohne es zu kaufen oder zu fotografieren.',
    question: 'Im Museum hat Leo ein Bild von Monet _____.',
    distractors: ['gemalt', 'gesehen', 'besucht'],
    correctIndex: 1,
    explanation: 'Leo betrachtete das Bild; hier passt „gesehen“.',
    passageRef: '',
  },
  {
    targetIndex: 3,
    taskContext:
      'Sara war den ganzen Nachmittag bei ihrer Tante zu Hause und verbrachte Zeit mit ihr.',
    question: 'Am Samstag hat Sara ihre Tante in Bonn _____.',
    distractors: ['gesehen', 'gemacht', 'gegangen'],
    correctIndex: 3,
    explanation: 'Sara verbrachte Zeit bei ihrer Tante; dazu passt „besucht“.',
    passageRef: '',
  },
  {
    targetIndex: 4,
    taskContext: 'Der Kinobesuch war am Tag vor dem heutigen Tag.',
    question: 'Amir war _____ im Kino; heute bleibt er zu Hause.',
    distractors: ['heute', 'morgen', 'später'],
    correctIndex: 2,
    explanation: 'Der Tag vor heute heißt „gestern“.',
    passageRef: '',
  },
];
const replacements = [
  {
    ...original[0],
    taskContext:
      'Ben hat jede Aufgabe selbst erledigt. Wähle die Ergänzung, die ausdrückt, dass er alle Aufgaben erledigt hat.',
    distractors: ['gegessen', 'getrunken', 'gegangen'],
  },
  { ...original[2], distractors: ['gekauft', 'fotografiert', 'besucht'] },
  {
    ...original[3],
    taskContext:
      'Sara war zu Besuch bei ihrer Tante. Wähle die Ergänzung, die diesen Besuch ausdrückt.',
    distractors: ['gekocht', 'getrunken', 'gegangen'],
  },
];
type Request = { name: string; schema: Record<string, unknown>; input: unknown };
type BlindQuestion = {
  index: number;
  question: string;
  options: string[];
  completedOptions: string[];
};
type TeachingItem = { index: number; content: { question: string; options: string[] } };
let requests: Request[];
let finalDefect: 'none' | 'seen_done' | 'seen_visited' | 'duplicate' | 'malformed';
let blindAcceptsDuplicate: boolean;

beforeEach(() => {
  requests = [];
  finalDefect = 'none';
  blindAcceptsDuplicate = false;
  boundary.generate.mockReset();
  boundary.generate.mockImplementation(
    async (
      _system: string,
      messages: Array<{ content: string }>,
      options: { jsonSchema: { name: string; schema: Record<string, unknown> } }
    ) => {
      const { name, schema } = options.jsonSchema;
      const input =
        name === 'class_section_questions' || name === 'class_vocabulary_distractors'
          ? messages[0].content
          : JSON.parse(messages[0].content);
      requests.push({ name, schema, input });
      let content: unknown;
      if (name === 'class_section_questions') {
        const targets = (
          schema as {
            properties: {
              questions: { items: { properties: { targetIndex: { enum: number[] } } } };
            };
          }
        ).properties.questions.items.properties.targetIndex.enum;
        if (targets.length === lemmas.length) content = { passage: '', questions: original };
        else {
          if (finalDefect === 'malformed') return { content: '{', model: 'fixture' };
          const rows = structuredClone(replacements);
          if (finalDefect === 'duplicate') rows[1].distractors[0] = 'gesehen';
          if (finalDefect === 'seen_done') {
            rows[0].distractors[0] = 'gesehen';
            rows[0].taskContext = original[0].taskContext;
          }
          if (finalDefect === 'seen_visited') {
            rows[2].distractors[0] = 'gesehen';
            rows[2].taskContext = original[3].taskContext;
          }
          content = { passage: '', questions: rows };
        }
      } else if (name === 'class_vocabulary_distractors') {
        content = { distractors: { '2': ['gesehen', 'fotografiert', 'besucht'] } };
      } else if (name === 'class_section_quality') {
        const questions = (input as { questions: BlindQuestion[] }).questions;
        const first = questions[2].options.filter((option) => option === 'gesehen').length > 1;
        content = {
          passageFindings: [],
          issues: [],
          questions: questions.map((question, index) => {
            let acceptableOptionIndices = question.options.flatMap((option, optionIndex) =>
              option === lemmas[index] ? [optionIndex] : []
            );
            if (first && !blindAcceptsDuplicate && [0, 3].includes(index))
              acceptableOptionIndices = [0, original[index].correctIndex];
            if (
              !first &&
              ((finalDefect === 'seen_done' && index === 0) ||
                (finalDefect === 'seen_visited' && index === 3))
            )
              acceptableOptionIndices = [0, original[index].correctIndex];
            if (blindAcceptsDuplicate) acceptableOptionIndices = [original[index].correctIndex];
            return {
              index,
              acceptableOptionIndices,
              issues: acceptableOptionIndices.length === 1 ? [] : ['ambiguous'],
            };
          }),
        };
      } else {
        content = {
          items: (input as { items: TeachingItem[] }).items.map(({ index }) =>
            name === 'class_teaching_critic'
              ? { index, findings: [] }
              : { index, criticDecisions: [], newFindings: [] }
          ),
        };
      }
      return { content: JSON.stringify(content), model: 'fixture' };
    }
  );
});

describe('combined vocabulary structural and meaning repair', () => {
  it('repairs the duplicate and competing ordinary verbs together while retaining approved questions exactly', async () => {
    const result = await generateSectionQuestions(params);
    const replacementRequest = requests
      .filter(({ name }) => name === 'class_section_questions')
      .at(-1)!;
    expect(replacementRequest.schema).toMatchObject({
      properties: { questions: { items: { properties: { targetIndex: { enum: [0, 2, 3] } } } } },
    });
    expect(replacementRequest.input).toContain(original[0].taskContext);
    expect(replacementRequest.input).toContain(original[3].taskContext);
    const blindInputs = requests
      .filter(({ name }) => name === 'class_section_quality')
      .map(({ input }) => (input as { questions: BlindQuestion[] }).questions);
    expect(blindInputs[0][2].options).toEqual(['gemalt', 'gesehen', 'gesehen', 'besucht']);
    for (const index of [1, 4]) {
      expect(blindInputs[1][index]).toEqual(blindInputs[0][index]);
      expect(result[index]).toMatchObject({
        question: `${original[index].taskContext}\n${original[index].question}`,
        explanation: original[index].explanation,
      });
    }
    for (const row of replacements) {
      const options = [...row.distractors];
      options.splice(row.correctIndex, 0, lemmas[row.targetIndex]);
      expect(result[row.targetIndex]).toMatchObject({
        question: `${row.taskContext}\n${row.question}`,
        options,
        correctIndex: row.correctIndex,
        explanation: row.explanation,
      });
    }
    for (const name of ['class_teaching_critic', 'class_teaching_adjudicator']) {
      const teaching = requests.find((request) => request.name === name)!.input as {
        items: TeachingItem[];
      };
      expect(teaching.items.map(({ content }) => content)).toEqual(
        JSON.parse(JSON.stringify(result))
      );
    }
    expect(JSON.stringify(blindInputs)).not.toContain('correctIndex');
    expect(JSON.stringify(blindInputs)).not.toContain('explanation');
  });

  it.each(['seen_done', 'seen_visited'] as const)(
    'rejects a replacement whose %s ambiguity remains',
    async (defect) => {
      finalDefect = defect;
      await expect(generateSectionQuestions(params)).rejects.toBeInstanceOf(SectionQualityError);
      const final = requests.filter(({ name }) => name === 'class_section_quality').at(-1)!
        .input as { questions: BlindQuestion[] };
      expect(final.questions[defect === 'seen_done' ? 0 : 3].options).toContain('gesehen');
      const teaching = requests.filter(({ name }) => name === 'class_teaching_adjudicator').at(-1)!
        .input as { items: TeachingItem[] };
      expect(
        teaching.items.map(({ content: { question, options } }) => ({ question, options }))
      ).toEqual(final.questions.map(({ question, options }) => ({ question, options })));
    }
  );

  it.each(['duplicate', 'malformed'] as const)(
    'fails closed when the bounded replacement and protocol correction remain %s',
    async (defect) => {
      finalDefect = defect;
      await expect(generateSectionQuestions(params)).rejects.toBeInstanceOf(SectionQualityError);
      expect(requests.filter(({ name }) => name.startsWith('class_teaching_'))).toEqual([]);
      const corrections = requests
        .filter(({ name }) => name === 'class_section_questions')
        .slice(1);
      for (const correction of corrections)
        expect(correction.schema).toMatchObject({
          properties: {
            questions: { items: { properties: { targetIndex: { enum: [0, 2, 3] } } } },
          },
        });
    }
  );

  it('never publishes duplicate options even when the blind solve selects just the proposed index', async () => {
    blindAcceptsDuplicate = true;
    await expect(generateSectionQuestions(params)).rejects.toBeInstanceOf(SectionQualityError);
    expect(
      requests.find(({ name }) => name === 'class_vocabulary_distractors')!.schema
    ).toMatchObject({ properties: { distractors: { required: ['2'] } } });
    expect(requests.filter(({ name }) => name.startsWith('class_teaching_'))).toEqual([]);
  });
});
