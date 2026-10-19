import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../helpers/runtime/provider-execution';

const boundary = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (userId: string) => ({
    provider: 'fixture',
    model: 'fixture',
    execution: blockedProviderExecution(userId),
  }),
  capturedLearningAiOptions: async () => ({ model: 'fixture' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { generateSectionQuestions, type GeneratedQuestion } from '@/lib/class-generation';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';

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
let finalAmbiguity: boolean;
let globalBlindDefect: boolean;
let lateDefinitionDefect: boolean;
let blindDefect: 'issue' | 'wrong_key' | 'ambiguous';
let repairPrompt: string;
let generationPrompts: string[];
let blindPrompts: string[];
let teachingInputs: Item[][];
let blindInputs: BlindItem[][];
let corroborationInputs: Array<{
  items: Item[];
  novelFindingProposals: Array<{ itemIndex: number; findingIndex: number }>;
}>;

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
      lateDefinitionDefect && targetIndex === 2
        ? '„Gesehen“ bedeutet immer, einen Film angeschaut zu haben.'
        : replacement && targetIndex === 1 && finalDefect
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
  finalAmbiguity = false;
  globalBlindDefect = false;
  lateDefinitionDefect = false;
  blindDefect = 'issue';
  repairPrompt = '';
  generationPrompts = [];
  blindPrompts = [];
  teachingInputs = [];
  blindInputs = [];
  corroborationInputs = [];
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
        generationPrompts.push(system);
        if (generated) repairPrompt = messages[0].content;
        const questions = authored(generated);
        generated = true;
        return { content: JSON.stringify({ passage: '', questions }), model: 'fixture' };
      }
      const input = JSON.parse(messages[0].content);
      if (name === 'class_teaching_novel_finding_corroboration') {
        corroborationInputs.push(input);
        return {
          content: JSON.stringify({
            decisions: input.novelFindingProposals.map(
              ({ itemIndex, findingIndex }: { itemIndex: number; findingIndex: number }) => ({
                itemIndex,
                findingIndex,
                decision: 'supported',
                reason: 'Seeing does not necessarily mean watching a film.',
              })
            ),
          }),
          model: 'fixture',
        };
      }
      if (name === 'class_section_quality') {
        blindPrompts.push(system);
        blindInputs.push(input.questions);
        return {
          content: JSON.stringify({
            passageFindings: [],
            issues: globalBlindDefect && blindInputs.length === 1 ? ['unnatural'] : [],
            questions: input.questions.map((row: BlindItem) => ({
              index: row.index,
              acceptableOptionIndices:
                finalAmbiguity && blindInputs.length > 1 && row.index === 1
                  ? [0, 2]
                  : row.question.includes('unmögliche Reise') && blindDefect !== 'issue'
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
              newFindings:
                lateDefinitionDefect && teachingInputs.length > 1 && item.index === 2
                  ? [
                      {
                        sourcePartIndex: item.sourceParts.find(
                          (part) => part.fieldPath[0] === 'explanation'
                        )!.index,
                        issue: 'incorrect',
                        rule: 'Incidental scene facts do not define a word.',
                        defect: 'Seeing does not necessarily mean watching a film.',
                        remedy: {
                          kind: 'correction',
                          text: 'Hier beschreibt „gesehen“, dass Lea einen Film angeschaut hat.',
                        },
                      },
                    ]
                  : [],
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
  it('sends contextual lexical meaning constraints through both authoring and blind review attempts', async () => {
    const result = await generateSectionQuestions({ ...params, vocabularyReview: true });
    expect(result.map((row) => row.options[row.correctIndex])).toEqual(lemmas);
    expect(generationPrompts).toHaveLength(2);
    for (const prompt of generationPrompts) {
      const policy = prompt.split('\n').find((line) => /vocabulary explanations/i.test(line));
      expect(policy).toEqual(expect.stringMatching(/why.*fits.*scene/i));
      expect(policy).toEqual(expect.stringMatching(/essential.*meaning.*incidental/i));
      expect(policy).toEqual(expect.stringMatching(/generic.*definition/i));
      for (const [index, lemma] of lemmas.entries())
        expect(prompt).toContain(`[${index}] ${lemma}`);
    }
    expect(blindPrompts).toHaveLength(2);
    for (const prompt of blindPrompts) {
      const policy = prompt.split('\n').find((line) => /vocabulary.*alternatives/i.test(line));
      expect(policy).toEqual(expect.stringMatching(/action.*sense/i));
      expect(policy).toEqual(expect.stringMatching(/accompany.*not.*meaning-preserving/i));
      expect(policy).toEqual(
        expect.stringMatching(/true synonyms.*ordinary alternative answers.*satisfy/i)
      );
      expect(policy).toEqual(
        expect.stringMatching(/multiple plausible venues.*public facts.*do not distinguish/i)
      );
    }
    expect(repairPrompt).toContain('acceptableOptionIndices');
  });

  it.each([false, true])(
    'repairs both defects and preserves only jointly approved rows: vocabulary=%s',
    async (vocabularyReview) => {
      vocabulary = vocabularyReview;
      const result = await generateSectionQuestions({ ...params, vocabularyReview });
      expect(repairPrompt).toContain('unmögliche Reise');
      expect(repairPrompt).toContain('Correction: Ich bin zu Fuß nach Hause gegangen.');
      expect(repairPrompt).toContain('acceptableOptionIndices');
      expect(repairPrompt).toContain('independently insert all four options');
      expect(repairPrompt).toContain('Repair its context, options and explanation together');
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

  it('retains a later corroborated definition rejection in an unchanged previously approved row', async () => {
    lateDefinitionDefect = true;
    const error = await generateSectionQuestions({ ...params, vocabularyReview: true }).catch(
      (failure: unknown) => failure
    );
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    const failure = captureGenerationFailure(error);
    expect(failure.category).toBe('teaching_rejected');
    expect(failure.teachingFailure?.reviews).toHaveLength(2);
    const [initial, terminal] = failure.teachingFailure!.reviews;
    expect(initial.verdict.items[2]).toMatchObject({ acceptable: true, issues: [] });
    expect(terminal.verdict.items[2]).toMatchObject({ acceptable: false, issues: ['incorrect'] });
    const before = JSON.parse(initial.candidate!)[0];
    const after = JSON.parse(terminal.candidate!)[0];
    expect(after.items[2]).toEqual(before.items[2]);
    expect(after.items[2].explanation).toContain('immer, einen Film');
    expect(after.reviewPackets[0].critic.items[2].findings).toEqual([]);
    expect(after.reviewPackets[0].adjudicator.items[2].findings).toEqual([
      expect.objectContaining({
        fieldPath: ['explanation'],
        defect: 'Seeing does not necessarily mean watching a film.',
      }),
    ]);
    expect(after.reviewPackets[0].novelFindingCorroboration).toBeDefined();
    const corroboration = corroborationInputs.find((input) =>
      input.novelFindingProposals.some((proposal) => proposal.itemIndex === 2)
    );
    expect(corroboration?.items[2].content).toEqual(before.items[2]);
    expect(corroboration?.novelFindingProposals).toMatchObject([{ itemIndex: 2, findingIndex: 0 }]);
    expect(after.items[0].question).not.toContain('unmögliche Reise');
    expect(after.items[1].question).not.toContain('auf meinen Füßen');
  });

  it.each([false, true])(
    'retains terminal ambiguity with bounded teaching evidence: terminal teaching rejection=%s',
    async (teachingRejected) => {
      finalDefect = teachingRejected;
      finalAmbiguity = true;
      const error = await generateSectionQuestions({ ...params, vocabularyReview: true }).catch(
        (failure: unknown) => failure
      );
      const failure = captureGenerationFailure(error);
      expect(failure.category).toBe(teachingRejected ? 'teaching_rejected' : 'section_quality');
      expect(failure.teachingFailure?.reviews).toHaveLength(2);
      const [teaching, blind] = failure.teachingFailure!.reviews;
      expect(teaching.verdict.items[1].issues).toEqual([
        teachingRejected ? 'incorrect' : 'unnatural',
      ]);
      expect(JSON.parse(teaching.candidate!)[0].items[1].question).toBe(
        teachingInputs[teachingRejected ? 1 : 0][1].content.question
      );
      const retained = JSON.parse(blind.candidate!);
      expect(retained.reviewType).toBe('blind_section');
      expect(retained.blindVerdict.questions[1].acceptableOptionIndices).toEqual([0, 2]);
      expect(retained.questions[1].question).toBe(blindInputs.at(-1)![1].question);
      expect(retained.questions[1].options).toEqual(blindInputs.at(-1)![1].options);
      expect(retained.questions[1].question).not.toContain('auf meinen Füßen');
      expect(blind.verdict.items[1]).toMatchObject({ acceptable: false, issues: ['uncertain'] });
    }
  );

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
