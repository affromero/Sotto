import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';
import { withReadingSupportFixture } from '../quality/teaching/reading-support-fixture';

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
  objective: 'Choose words that complete meaningful sentences in context.',
  grammarPoints: [],
  targetVocab: lemmas.map((lemma) => ({ lemma, gloss: lemma })),
  seed: 'fixed-context-distractors',
};

// Retained generation 241. Only the distractor arrays for targets 1, 3 and 4 repeat an option.
const original = [
  {
    question: 'Aus alten Kartons habe ich für den Schulhof ein kleines Puppenhaus _____ .',
    correctIndex: 2,
    explanation:
      '„Gemacht“ passt, weil die Person aus den Kartons selbst einen neuen Gegenstand hergestellt hat.',
    passageRef: '',
    taskContext:
      'Die Person hat die Kartons selbst zu einem neuen Gegenstand zusammengesetzt und hergestellt.',
    targetIndex: 0,
    distractors: ['gesehen', 'besucht', 'gekocht'],
  },
  {
    question: 'Nach der Arbeit bin ich zu Fuß durch den Park nach Hause _____ .',
    correctIndex: 0,
    explanation:
      '„Gegangen“ beschreibt hier, dass die Person den ganzen Weg zu Fuß zurückgelegt hat.',
    passageRef: '',
    taskContext:
      'Die Person hat den ganzen Weg nach Hause zu Fuß zurückgelegt, ohne ein Fahrzeug zu benutzen.',
    targetIndex: 1,
    distractors: ['gegangen', 'gefahren', 'geblieben'],
  },
  {
    question: 'Im Museum habe ich zum ersten Mal ein echtes Mammut-Skelett _____ .',
    correctIndex: 1,
    explanation:
      '„Gesehen“ passt, weil die Person das Skelett mit den eigenen Augen wahrgenommen hat.',
    passageRef: '',
    taskContext: 'Die Person stand vor einem echten Mammut-Skelett und nahm es mit den Augen wahr.',
    targetIndex: 2,
    distractors: ['gehört', 'gesucht', 'besucht'],
  },
  {
    question:
      'Am Vormittag haben wir die Stadtbibliothek _____ und dort an einer Lesung teilgenommen.',
    correctIndex: 2,
    explanation:
      '„Besucht“ passt, weil die Gruppe in die Bibliothek gegangen ist und dort an einer Veranstaltung teilgenommen hat.',
    passageRef: '',
    taskContext:
      'Die Gruppe war zwei Stunden in der Bibliothek und nahm dort an einer Veranstaltung teil.',
    targetIndex: 3,
    distractors: ['gelesen', 'gesehen', 'besucht'],
  },
  {
    question: 'Leni hat _____ ihre Tante angerufen, bevor sie heute auf Reisen ging.',
    correctIndex: 1,
    explanation:
      '„Gestern“ bezeichnet den Tag vor heute und passt deshalb zum Anruf vor der heutigen Reise.',
    passageRef: '',
    taskContext: 'Der Anruf war am Tag vor heute, also weder heute noch morgen.',
    targetIndex: 4,
    distractors: ['heute', 'gestern', 'morgen'],
  },
];
const compiledSentences = [
  'Aus alten Kartons habe ich für den Schulhof ein kleines Puppenhaus _____.',
  'Nach der Arbeit bin ich zu Fuß durch den Park nach Hause _____.',
  'Im Museum habe ich zum ersten Mal ein echtes Mammut-Skelett _____.',
  'Am Vormittag haben wir die Stadtbibliothek _____ und dort an einer Lesung teilgenommen.',
  'Leni hat _____ ihre Tante angerufen, bevor sie heute auf Reisen ging.',
];
const replacement = {
  distractors: {
    '1': ['gefahren', 'geflogen', 'geschwommen'],
    '3': ['gelesen', 'gekocht', 'getrunken'],
    '4': ['heute', 'morgen', 'bald'],
  },
};

type Request = { name: string; schema: Record<string, unknown>; input: unknown; system: string };
let requests: Request[];
let initial: typeof original;
let patches: unknown[];
let rejectRetained: boolean;
let authorResponses: Array<typeof original | string>;
let rejectBlindOnce: boolean;
beforeEach(() => {
  requests = [];
  initial = structuredClone(original);
  patches = [replacement];
  rejectRetained = false;
  authorResponses = [];
  rejectBlindOnce = false;
  boundary.generate.mockReset();
  boundary.generate.mockImplementation(
    async (
      system: string,
      messages: Array<{ content: string }>,
      options: { jsonSchema: { name: string; schema: Record<string, unknown> } }
    ) => {
      const { name, schema } = options.jsonSchema;
      const input =
        name.startsWith('class_section_') && name !== 'class_section_quality'
          ? messages[0].content
          : name === 'class_vocabulary_distractors'
            ? messages[0].content
            : JSON.parse(messages[0].content);
      requests.push({ name, schema, input, system });
      let content: unknown;
      if (name === 'class_section_questions') {
        const candidate = authorResponses.length ? authorResponses.shift()! : initial;
        if (typeof candidate === 'string') return { content: candidate, model: 'fixture' };
        content = { passage: '', questions: candidate };
      } else if (name === 'class_vocabulary_distractors') {
        const patch = patches.shift();
        return {
          content: typeof patch === 'string' ? patch : JSON.stringify(patch),
          model: 'fixture',
        };
      } else if (name === 'class_section_quality') {
        const questions = (input as { questions: Array<{ options: string[] }> }).questions;
        const rejected = rejectRetained || rejectBlindOnce;
        rejectBlindOnce = false;
        content = {
          passageFindings: [],
          issues: [],
          questions: questions.map((question, index) => ({
            index,
            acceptableOptionIndices:
              rejected && index === 0
                ? []
                : question.options.flatMap((option, optionIndex) =>
                    option === lemmas[initial[index].targetIndex] ? [optionIndex] : []
                  ),
            issues: rejected && index === 0 ? ['unnatural'] : [],
          })),
        };
      } else {
        content = {
          items: (input as { items: Array<{ index: number }> }).items.map(({ index }) =>
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

describe('fixed-context vocabulary distractor repair', () => {
  it('repairs sparse duplicate arrays while retaining every original context and keyed explanation', async () => {
    const result = await generateSectionQuestions(params);
    expect(result).toEqual(
      original.map((row) => {
        const distractors =
          replacement.distractors[
            String(row.targetIndex) as keyof typeof replacement.distractors
          ] ?? row.distractors;
        const options = [...distractors];
        options.splice(row.correctIndex, 0, lemmas[row.targetIndex]);
        return {
          question: `${row.taskContext}\n${compiledSentences[row.targetIndex]}`,
          options,
          correctIndex: row.correctIndex,
          explanation: row.explanation,
          passageRef: row.passageRef,
          passageText: undefined,
        };
      })
    );
    const patchRequest = requests.find(({ name }) => name === 'class_vocabulary_distractors')!;
    expect(patchRequest.schema).toMatchObject({
      properties: { distractors: { required: ['1', '3', '4'], additionalProperties: false } },
      required: ['distractors'],
      additionalProperties: false,
    });
    expect(patchRequest.system).toContain(JSON.stringify(original));
    expect(patchRequest.system).not.toContain('DIFFERENT set of items');
    const blind = requests.filter(({ name }) => name === 'class_section_quality').at(-1)!.input;
    expect(blind).toMatchObject({
      questions: result.map(({ question, options }, index) => ({ index, question, options })),
    });
    expect(JSON.stringify(blind)).not.toContain('correctIndex');
    expect(JSON.stringify(blind)).not.toContain('explanation');
    for (const name of ['class_teaching_critic', 'class_teaching_adjudicator'])
      expect(requests.find((request) => request.name === name)!.input).toMatchObject({
        items: result.map((content, index) => ({
          index,
          content: JSON.parse(JSON.stringify(content)),
        })),
      });
    expect(requests.filter(({ name }) => name === 'class_section_questions')).toHaveLength(1);
  });

  it('rejects a collocation defect that survives the combined structural and semantic repair', async () => {
    initial[0].question =
      'Für den Pfannkuchenteig habe ich Mehl, Eier und Milch in einer Schüssel _____ .';
    initial[0].taskContext = 'Mehl, Eier und Milch kommen in eine Schüssel und werden verrührt.';
    rejectRetained = true;
    authorResponses = [
      initial,
      initial
        .filter((row) => row.targetIndex !== 2)
        .map((row) => ({
          ...row,
          distractors:
            replacement.distractors[
              String(row.targetIndex) as keyof typeof replacement.distractors
            ] ?? row.distractors,
        })),
    ];
    await expect(generateSectionQuestions(params)).rejects.toBeInstanceOf(SectionQualityError);
    expect(requests.filter(({ name }) => name === 'class_teaching_critic')).toEqual([]);
    expect(
      requests.filter(({ name }) => name === 'class_section_quality').at(-1)!.input
    ).toMatchObject({
      questions: [
        expect.objectContaining({
          question: `${initial[0].taskContext}\nFür den Pfannkuchenteig habe ich Mehl, Eier und Milch in einer Schüssel _____.`,
        }),
        {},
        {},
        {},
        {},
      ],
    });
  });

  it.each([
    {
      name: 'missing target key',
      patch: {
        distractors: { '1': replacement.distractors['1'], '3': replacement.distractors['3'] },
      },
    },
    {
      name: 'unaddressed target key',
      patch: {
        distractors: { ...replacement.distractors, '0': ['gekocht', 'gebacken', 'gekauft'] },
      },
    },
    {
      name: 'rewritten context',
      patch: { ...replacement, question: 'Unapproved replacement _____.' },
    },
    {
      name: 'wrong array length',
      patch: { distractors: { ...replacement.distractors, '1': ['gefahren', 'geflogen'] } },
    },
    {
      name: 'duplicate target',
      patch: {
        distractors: { ...replacement.distractors, '1': ['gegangen', 'geflogen', 'geschwommen'] },
      },
    },
    {
      name: 'case-insensitive duplicate',
      patch: {
        distractors: { ...replacement.distractors, '1': [' GEGANGEN ', 'geflogen', 'geschwommen'] },
      },
    },
    {
      name: 'blank distractor',
      patch: { distractors: { ...replacement.distractors, '1': [' ', 'geflogen', 'geschwommen'] } },
    },
    { name: 'invalid JSON', patch: '{' },
  ])('keeps the existing final protocol correction bound after a $name', async ({ patch }) => {
    patches = [patch, replacement];
    const result = await generateSectionQuestions(params);
    expect(result[0].question).toBe(`${original[0].taskContext}\n${compiledSentences[0]}`);
    const patchRequests = requests.filter(({ name }) => name === 'class_vocabulary_distractors');
    expect(patchRequests).toHaveLength(2);
    expect(patchRequests[1].schema).toEqual(patchRequests[0].schema);
    expect(patchRequests[1].system).toContain(JSON.stringify(original));
    expect(requests.filter(({ name }) => name === 'class_section_questions')).toHaveLength(1);
  });

  it('fails closed when the one existing protocol correction still changes fixed fields', async () => {
    patches = [
      { ...replacement, correctIndex: 3 },
      { ...replacement, questions: [] },
    ];
    await expect(generateSectionQuestions(params)).rejects.toBeInstanceOf(SectionQualityError);
    expect(requests.filter(({ name }) => name.startsWith('class_teaching_'))).toEqual([]);
  });

  it.each(['missing task context', 'duplicate target identity', 'oversized snapshot'])(
    'keeps %s on the existing whole-question path',
    async (defect) => {
      if (defect === 'missing task context') initial[0].taskContext = '';
      else if (defect === 'duplicate target identity') initial[4].targetIndex = 3;
      else initial[0].question += 'x'.repeat(32 * 1024);
      await expect(generateSectionQuestions(params)).rejects.toThrow(
        /malformed output|no usable questions/i
      );
      expect(requests.every(({ name }) => name === 'class_section_questions')).toBe(true);
      expect(requests).toHaveLength(3);
    }
  );

  it('binds sparse repair keys to original target identities when the returned rows are reordered', async () => {
    initial = [original[4], original[0], original[3], original[2], original[1]];
    const result = await generateSectionQuestions(params);
    expect(result.map((row) => row.options[row.correctIndex])).toEqual([
      'gestern',
      'gemacht',
      'besucht',
      'gesehen',
      'gegangen',
    ]);
    expect(result.map((row) => row.question)).toEqual(
      initial.map((row) => `${row.taskContext}\n${compiledSentences[row.targetIndex]}`)
    );
    expect(
      requests.find(({ name }) => name === 'class_vocabulary_distractors')!.schema
    ).toMatchObject({
      properties: { distractors: { required: ['4', '3', '1'] } },
    });
  });
});

describe('compiled vocabulary gap typography', () => {
  const context =
    'Lena mischte die drei Zutaten selbst in einer Kanne; den fertigen Tee trank sie erst später beim Picknick.';
  const sentence = 'Für das Picknick hat Lena aus Minze, Zitrone und Wasser einen Kräutertee';
  it.each([
    { path: 'initial', question: `${sentence} _____ \t.`, expected: `${sentence} _____.` },
    { path: 'JSON repair', question: `${sentence} _____ .`, expected: `${sentence} _____.` },
    {
      path: 'semantic replacement',
      question: `${sentence} _____ .`,
      expected: `${sentence} _____.`,
    },
    {
      path: 'comma',
      question: `${sentence} _____ , den sie trank.`,
      expected: `${sentence} _____, den sie trank.`,
    },
    ...['?', '!', ':', ';'].map((punctuation) => ({
      path: `French spacing before ${punctuation}`,
      question: `Lena a _____ ${punctuation}`,
      expected: `Lena a _____ ${punctuation}`,
    })),
    { path: 'line break', question: `${sentence} _____\n.`, expected: `${sentence} _____\n.` },
  ])(
    'preserves the reviewed and published text through $path',
    async ({ path, question, expected }) => {
      initial = [
        {
          ...original[0],
          question,
          taskContext: context,
          correctIndex: 0,
          distractors: ['gekauft', 'gefunden', 'gebracht'],
          explanation:
            '„Gemacht“ passt, weil Lena die Zutaten selbst zu einem fertigen Tee zusammengefügt hat.',
        },
      ];
      if (path === 'JSON repair') authorResponses = ['{', '{'];
      if (path === 'semantic replacement') {
        authorResponses = [
          [
            {
              ...initial[0],
              question:
                'Für den Pfannkuchenteig habe ich Mehl, Eier und Milch in einer Schüssel _____ .',
              taskContext: 'Mehl, Eier und Milch kommen in eine Schüssel und werden verrührt.',
            },
          ],
        ];
        rejectBlindOnce = true;
      }
      const result = await generateSectionQuestions({
        ...params,
        targetVocab: [params.targetVocab[0]],
      });
      expect(result[0]).toMatchObject({
        question: `${context}\n${expected}`,
        options: ['gemacht', 'gekauft', 'gefunden', 'gebracht'],
        correctIndex: 0,
        explanation: initial[0].explanation,
        passageRef: '',
      });
      const completedOptions = result[0].options.map(
        (option) => `${context}\n${expected.replace('_____', option)}`
      );
      for (const name of [
        'class_section_quality',
        'class_teaching_critic',
        'class_teaching_adjudicator',
      ]) {
        const input = requests.filter((request) => request.name === name).at(-1)!.input;
        expect(input).toMatchObject(
          name === 'class_section_quality'
            ? { questions: [{ question: result[0].question, completedOptions }] }
            : { items: [{ content: JSON.parse(JSON.stringify(result[0])), completedOptions }] }
        );
      }
      expect(initial[0].question).toBe(question);
    }
  );

  it('preserves supplied reading text and reading questions containing the same gap spacing', async () => {
    const passage = '  Lena a préparé du thé : elle a _____ .\n  Elle demande : pourquoi ?  ';
    const question = 'Lena a _____ .';
    const generate = boundary.generate.getMockImplementation()!;
    boundary.generate.mockImplementation(async (system, messages, options) => {
      if (options.jsonSchema.name === 'class_section_questions') {
        return {
          model: 'fixture',
          content: JSON.stringify({
            passage: 'Unused generated text.',
            questions: original.map((row, index) => ({
              question,
              options: [lemmas[index], 'a', 'b', 'c'],
              correctIndex: 0,
              explanation: row.explanation,
              passageRef: '',
            })),
          }),
        };
      }
      return withReadingSupportFixture(
        messages,
        options,
        await generate(system, messages, options)
      );
    });
    const result = await generateSectionQuestions({
      ...params,
      skill: 'READING',
      vocabularyReview: false,
      sourceContent: passage,
    });
    expect(result.every((item) => item.question === question && item.passageText === passage)).toBe(
      true
    );
    expect(requests.find(({ name }) => name === 'class_section_quality')!.input).toMatchObject({
      passage,
      questions: result.map((item) => ({ question: item.question })),
    });
  });
});
