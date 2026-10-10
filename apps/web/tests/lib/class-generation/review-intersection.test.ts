import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';

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

import { generateSectionQuestions, type GeneratedQuestion } from '@/lib/class-generation';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';

const lemmas = ['gemacht', 'gegangen', 'gesehen', 'besucht', 'gestern'];
const sentences = [
  'Mila hat gestern eine Reise _____.',
  'Leon ist gestern zu Fuß nach Hause _____.',
  'Lea hat gestern einen Film _____.',
  'Noah hat gestern seine Tante _____.',
  'Am Tag vor heute, also _____, war Montag.',
];
type Item = {
  index: number;
  content: GeneratedQuestion;
  sourceParts: Array<{ index: number; fieldPath: string[]; quote: string }>;
};
type BlindItem = { index: number; question: string; options: string[] };
let generated: boolean;
let vocabulary: boolean;
let finalDefect: boolean;
let globalBlindDefect: boolean;
let blindDefect: 'issue' | 'wrong_key' | 'ambiguous';
let repairPrompt: string;
let teachingInputs: Item[][];
let blindInputs: BlindItem[][];

function authored(replacement: boolean) {
  const rows = sentences.map((question, targetIndex) => ({
    targetIndex,
    taskContext:
      !replacement && targetIndex === 0
        ? 'Wähle das Wort für eine unmögliche Reise.'
        : !replacement && targetIndex === 1
          ? 'Ich bin auf meinen Füßen nach Hause gelaufen.'
          : 'Ergänze das passende Wort.',
    question: replacement && targetIndex > 1 ? question.replace('gestern', 'am Montag') : question,
    distractors: ['getrunken', 'gegessen', 'geschrieben'],
    correctIndex: replacement ? 2 : 0,
    explanation:
      replacement && targetIndex === 1 && finalDefect
        ? 'Gehen bedeutet, ein Fahrzeug zu benutzen.'
        : `Die Situation verlangt „${lemmas[targetIndex]}“.`,
    passageRef: '',
  }));
  if (vocabulary) return rows;
  return rows.map(({ targetIndex, distractors, ...row }) => {
    const options = [...distractors];
    options.splice(row.correctIndex, 0, lemmas[targetIndex]);
    return { ...row, options };
  });
}

beforeEach(() => {
  generated = false;
  vocabulary = true;
  finalDefect = false;
  globalBlindDefect = false;
  blindDefect = 'issue';
  repairPrompt = '';
  teachingInputs = [];
  blindInputs = [];
  boundary.generate.mockReset();
  boundary.generate.mockImplementation(
    async (
      system: string,
      messages: Array<{ content: string }>,
      options: { jsonSchema: { name: string } }
    ) => {
      const name = options.jsonSchema.name;
      if (name === 'class_section_questions') {
        expect(system).toContain(params.objective);
        if (generated) repairPrompt = messages[0].content;
        const questions = authored(generated);
        generated = true;
        return { content: JSON.stringify({ passage: '', questions }), model: 'fixture' };
      }
      const input = JSON.parse(messages[0].content);
      if (name === 'class_section_quality') {
        blindInputs.push(input.questions);
        return {
          content: JSON.stringify({
            passageFindings: [],
            issues: globalBlindDefect && blindInputs.length === 1 ? ['unnatural'] : [],
            questions: input.questions.map((row: BlindItem) => ({
              index: row.index,
              acceptableOptionIndices:
                row.question.includes('unmögliche Reise') && blindDefect !== 'issue'
                  ? blindDefect === 'wrong_key'
                    ? [1]
                    : [0, 1]
                  : [row.options.findIndex((option) => lemmas.includes(option))],
              issues:
                row.question.includes('unmögliche Reise') && blindDefect === 'issue'
                  ? ['unnatural']
                  : [],
            })),
          }),
          model: 'fixture',
        };
      }
      const items = input.items as Item[];
      if (name === 'class_teaching_critic') teachingInputs.push(items);
      return {
        content: JSON.stringify({
          items: items.map((item) => {
            if (name === 'class_teaching_critic') {
              const unnatural = item.content.question.includes('auf meinen Füßen');
              const incorrect =
                item.content.explanation === 'Gehen bedeutet, ein Fahrzeug zu benutzen.';
              const source = item.sourceParts.find(
                (part) => part.fieldPath[0] === (incorrect ? 'explanation' : 'question')
              );
              return {
                index: item.index,
                findings:
                  unnatural || incorrect
                    ? [
                        {
                          sourcePartIndex: source!.index,
                          issue: incorrect ? 'incorrect' : 'unnatural',
                          rule: incorrect
                            ? 'Gehen describes travel on foot.'
                            : 'Use the conventional expression zu Fuß.',
                          defect: incorrect
                            ? 'The explanation incorrectly claims vehicle use.'
                            : 'The task uses an unnatural expression for walking.',
                          remedy: {
                            kind: 'correction',
                            text: incorrect
                              ? 'Gehen bedeutet, zu Fuß unterwegs zu sein.'
                              : 'Ich bin zu Fuß nach Hause gegangen.',
                          },
                        },
                      ]
                    : [],
              };
            }
            const findings: unknown[] = input.criticisms.items.find(
              (row: { index: number }) => row.index === item.index
            ).findings;
            return {
              index: item.index,
              criticDecisions: Array.from(findings.keys(), (findingIndex) => ({
                findingIndex,
                decision: 'supported',
                reason: 'The literal source contains the specified defect.',
              })),
              newFindings: [],
            };
          }),
        }),
        model: 'fixture',
      };
    }
  );
});

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  skill: 'GRAMMAR' as const,
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  objective: 'Use completed actions correctly.',
  grammarPoints: ['Perfekt'],
  targetVocab: lemmas.map((lemma) => ({ lemma, gloss: lemma })),
  seed: 'review-intersection',
};

describe('question repair from both independent audits', () => {
  it.each([false, true])(
    'repairs both defects and preserves only jointly approved rows: vocabulary=%s',
    async (vocabularyReview) => {
      vocabulary = vocabularyReview;
      const result = await generateSectionQuestions({ ...params, vocabularyReview });
      expect(repairPrompt).toContain('unmögliche Reise');
      expect(repairPrompt).toContain('Correction: Ich bin zu Fuß nach Hause gegangen.');
      expect(repairPrompt).toContain('acceptableOptionIndices');
      expect(result[0].question).not.toContain('unmögliche Reise');
      expect(result[1].question).not.toContain('auf meinen Füßen');
      const original = teachingInputs[0];
      const final = teachingInputs.at(-1)!;
      for (const row of original.slice(2)) {
        expect(result[row.index]).toEqual(row.content);
        expect(final[row.index].content).toEqual(row.content);
        expect(blindInputs.at(-1)![row.index]).toEqual(blindInputs[0][row.index]);
      }
    }
  );

  it('keeps a genuine second teaching defect terminal after collecting both initial audits', async () => {
    finalDefect = true;
    const error = await generateSectionQuestions({ ...params, vocabularyReview: true }).catch(
      (failure: unknown) => failure
    );
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    expect((error as TeachingQualityRejectionError).issues).toContain('incorrect');
    expect(repairPrompt).toContain('Correction: Ich bin zu Fuß nach Hause gegangen.');
    expect(teachingInputs.at(-1)![1].content.explanation).toContain('Fahrzeug');
  });

  it('preserves no rows when the initial blind audit has a global defect', async () => {
    globalBlindDefect = true;
    const result = await generateSectionQuestions({ ...params, vocabularyReview: true });
    expect(result[2]).not.toEqual(teachingInputs[0][2].content);
    expect(result[2]).toEqual(teachingInputs.at(-1)![2].content);
    expect(result[2].question).toContain('am Montag');
  });

  it.each(['wrong_key', 'ambiguous'] as const)(
    'repairs a blind %s row even when teaching approves it',
    async (defect) => {
      blindDefect = defect;
      const result = await generateSectionQuestions({ ...params, vocabularyReview: true });
      expect(result[0].question).not.toContain('unmögliche Reise');
      expect(result[0]).not.toEqual(teachingInputs[0][0].content);
      expect(teachingInputs.at(-1)![0].content).toEqual(result[0]);
      expect(result[2]).toEqual(teachingInputs[0][2].content);
    }
  );
});
