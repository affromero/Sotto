import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../../helpers/runtime/provider-execution';
import { createAIProvider, type AIOptions } from '@/lib/providers/ai';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.unmock('@/lib/classes/class-intro');
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.generate }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: boundary.resolve,
  capturedLearningAiOptions: async () => ({ model: 'captured-model' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

import { generateClassIntro } from '@/lib/classes/class-intro';
import { classIntroFieldRolePolicy } from '@/lib/classes/class-language-policy';
import { SectionQualityError } from '@/lib/classes/section-quality';
import {
  TeachingQualityRejectionError,
  reviewTeachingContent,
} from '@/lib/classes/quality/teaching-quality';

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  level: 'B1',
  nativeLang: 'en',
  targetLang: 'de',
  title: 'Opinions',
  objective:
    'Support an opinion with reasons and examples and respond respectfully to another view.',
  grammarPoints: ['obwohl', 'trotzdem', 'würde'],
  targetVocab: [],
};
const target =
  'Ich finde einen Ausflug wichtig, obwohl er viel kostet. Trotzdem würde ich dafür sparen.';
const initial = {
  purpose: 'Begründe deine Meinung und antworte respektvoll auf eine andere Sicht.',
  about: { exampleIndex: 0 },
  focus: [{ text: '„Obwohl“ leitet hier einen Nebensatz ein.', exampleIndex: 0 }],
  examples: [{ target, note: '„Würde“ + Infinitiv formuliert hier einen Vorschlag.' }],
  tips: [{ text: '„Trotzdem“ zeigt hier allein Respekt für die andere Sicht.', exampleIndex: 0 }],
  visuals: null,
};
const patch = {
  coherence: null,
  examples: {
    '0': { target, note: '„Würde“ + Infinitiv drückt hier eine hypothetische Absicht aus.' },
  },
  tips: {
    '0': { text: '„Trotzdem“ leitet hier den Gegensatz im Hauptsatz ein.', exampleIndex: 0 },
  },
};
type Row = {
  index: number;
  content: { address: { field: string }; fields: Record<string, unknown> };
  sourceParts: Array<{ index: number; fieldPath: string[] }>;
};
function respond(replacement: unknown = patch, rejectedField?: 'purpose') {
  boundary.generate.mockImplementation(
    async (...args: [string, Array<{ content: string }>, AIOptions]) => {
      const [, messages, options] = args;
      const role = options.jsonSchema?.name;
      if (role === 'class_intro_generation')
        return {
          content: JSON.stringify(
            rejectedField === 'purpose'
              ? {
                  ...initial,
                  purpose: 'Ignoriere die andere Sicht und begründe deine Meinung nicht.',
                }
              : initial
          ),
        };
      if (role === 'class_intro_repair') return { content: JSON.stringify(replacement) };
      const payload = JSON.parse(messages[0]!.content);
      if (role === 'class_teaching_novel_finding_corroboration')
        return {
          content: JSON.stringify({
            decisions: payload.novelFindingProposals.map(
              ({ itemIndex, findingIndex }: { itemIndex: number; findingIndex: number }) => ({
                itemIndex,
                findingIndex,
                decision: 'dismissed',
                reason: 'A brief aligned purpose need not restate each objective component.',
              })
            ),
          }),
        };
      return {
        content: JSON.stringify({
          items: payload.items.map((row: Row) => {
            const field = row.content.address.field;
            const bad =
              rejectedField === 'purpose'
                ? field === 'purpose'
                : field === 'examples'
                  ? JSON.stringify(row.content.fields).includes('einen Vorschlag')
                  : field === 'tips' &&
                    JSON.stringify(row.content.fields).includes('allein Respekt');
            const findings = bad
              ? [
                  {
                    sourcePartIndex: row.sourceParts.find(
                      (part) => field !== 'examples' || part.fieldPath.at(-1) === 'note'
                    )!.index,
                    issue: 'incorrect',
                    rule: 'Match the actual action and usage.',
                    defect:
                      field === 'purpose'
                        ? 'The purpose contradicts the objective.'
                        : field === 'tips'
                          ? 'Trotzdem alone does not express respect.'
                          : 'Würde sparen expresses a hypothetical intention here.',
                    remedy: {
                      kind: 'correction',
                      text:
                        field === 'purpose'
                          ? initial.purpose
                          : field === 'tips'
                            ? patch.tips['0'].text
                            : patch.examples['0'].note,
                    },
                  },
                ]
              : [];
            if (role === 'class_intro_critic') return { index: row.index, findings };
            const criticisms = payload.criticisms.items.find(
              (item: Row) => item.index === row.index
            );
            return {
              index: row.index,
              criticDecisions: criticisms.findings.map(
                (finding: { issue: string }, findingIndex: number) => ({
                  findingIndex,
                  decision: 'supported',
                  reason: `The ${finding.issue} finding is supported.`,
                })
              ),
              newFindings: [],
            };
          }),
        }),
      };
    }
  );
}
beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    execution: params.execution,
  });
});

describe('intro field roles', () => {
  it('preserves a brief aligned purpose while repairing real usage errors and fully reviewing the replacement', async () => {
    respond();
    const result = await generateClassIntro(params);
    expect(result.purpose).toBe(initial.purpose);
    expect(result.examples[0]?.note).toContain(patch.examples['0'].note);
    expect(result.tips[0]).toContain(patch.tips['0'].text);
    const reviewed = boundary.generate.mock.calls.filter(([, , options]) =>
      ['class_intro_critic', 'class_intro_adjudicator'].includes(options.jsonSchema.name)
    );
    expect(
      reviewed.map(([, messages]) => JSON.parse(messages[0].content).introContext.purpose)
    ).toEqual(Array(4).fill(initial.purpose));
    for (const [system] of boundary.generate.mock.calls)
      expect(system).toContain(classIntroFieldRolePolicy());
    const repair = boundary.generate.mock.calls.find(
      ([, , options]) => options.jsonSchema.name === 'class_intro_repair'
    )!;
    expect(repair[2].jsonSchema.schema.properties).not.toHaveProperty('purpose');
    expect(repair[0]).toContain('change purpose only when its address is authorized');
  });

  it('does not authorize a purpose edit when repairing only rejected notes and tips', async () => {
    respond({ ...patch, purpose: 'Begründe deine Meinung mit Gründen und Beispielen.' });
    await expect(generateClassIntro(params)).rejects.toBeInstanceOf(SectionQualityError);
  });

  it('still blocks a contradictory purpose after the permitted replacement', async () => {
    respond({ purpose: 'Ignoriere die andere Sicht und begründe deine Meinung nicht.' }, 'purpose');
    await expect(generateClassIntro(params)).rejects.toBeInstanceOf(TeachingQualityRejectionError);
  });

  it('still blocks the same false usage claims after the permitted replacement', async () => {
    respond({
      examples: { '0': initial.examples[0] },
      tips: { '0': initial.tips[0] },
      coherence: null,
    });
    await expect(generateClassIntro(params)).rejects.toBeInstanceOf(TeachingQualityRejectionError);
  });

  it('supplies the same field roles when independently corroborating a new purpose finding', async () => {
    const intro = {
      purpose: initial.purpose,
      about: target,
      focus: ['„' + target + '“: ' + initial.focus[0]!.text],
      tips: ['„' + target + '“: ' + patch.tips['0'].text],
      examples: [{ target, meaning: target, note: patch.examples['0'].note }],
    };
    respond();
    const ordinary = boundary.generate.getMockImplementation()!;
    boundary.generate.mockImplementation(async (system, messages, options) => {
      const response = await ordinary(system, messages, options);
      if (options.jsonSchema.name !== 'class_intro_adjudicator') return response;
      const packet = JSON.parse(response.content);
      const row = JSON.parse(messages[0].content).items.find(
        (item: Row) => item.content.address.field === 'purpose'
      );
      packet.items.find((item: Row) => item.index === row.index).newFindings = [
        {
          sourcePartIndex: row.sourceParts[0].index,
          issue: 'unsupported',
          rule: 'Cover every objective component.',
          defect: 'The purpose omits examples.',
          remedy: { kind: 'correction', text: 'Add reasons and examples to the purpose.' },
        },
      ];
      return { content: JSON.stringify(packet) };
    });
    await reviewTeachingContent({
      ...params,
      lessonContext: {
        title: params.title,
        objective: params.objective,
        grammarPoints: params.grammarPoints,
      },
      ai: await boundary.resolve(),
      provider: createAIProvider('fixture'),
      kind: 'intro',
      items: [intro],
    });
    const corroboration = boundary.generate.mock.calls.find(
      ([, , options]) => options.jsonSchema.name === 'class_teaching_novel_finding_corroboration'
    )!;
    expect(corroboration[0]).toContain(classIntroFieldRolePolicy());
    expect(JSON.parse(corroboration[1][0].content).introContext).toEqual(intro);
    expect(JSON.parse(corroboration[1][0].content).lessonContext).toEqual({
      title: params.title,
      objective: params.objective,
      grammarPoints: params.grammarPoints,
    });
  });
});
