import { describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../../../helpers/runtime/provider-execution';
import type { AIProvider } from '@/lib/providers/ai';
vi.mock('@/lib/learning-ai', () => ({
  capturedLearningAiOptions: async (ai: { model: string }) => ({ model: ai.model }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
import { sectionReviewInput } from '@/lib/classes/section-quality';
import {
  reviewTeachingContent,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import { buildTeachingSourceParts } from '@/lib/classes/quality/teaching-source/protocol';

const question = {
  question:
    'Lena mischte die drei Zutaten selbst in einer Kanne; den fertigen Tee trank sie erst später beim Picknick.\nFür das Picknick hat Lena aus Minze, Zitrone und Wasser einen Kräutertee _____ .',
  options: ['gemacht', 'gekauft', 'gefunden', 'gebracht'],
  correctIndex: 0,
  explanation:
    '„Gemacht“ passt, weil Lena die Zutaten selbst zu einem fertigen Tee zusammengefügt hat.',
  passageRef: '',
};
const base = {
  ai: {
    provider: 'fixture',
    model: 'captured-model',
    execution: blockedProviderExecution('fixture'),
  },
  userId: 'fixture',
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
};
type Packet = {
  items: Array<{
    index: number;
    content: unknown;
    completedOptions?: string[];
    sourceParts: unknown[];
  }>;
  priorProtocolOutput?: unknown;
};

function provider(options: { malformedCritic?: boolean; reject?: boolean } = {}) {
  const packets: Packet[] = [];
  const generateResponse = vi.fn(async (...args: Parameters<AIProvider['generateResponse']>) => {
    const [, messages, ai] = args;
    const packet = JSON.parse(messages[0].content as string) as Packet;
    packets.push(packet);
    if (options.malformedCritic && packets.length === 1)
      return { content: '{', model: 'fixture', inputTokens: 0, outputTokens: 0 };
    const critic = ai?.jsonSchema?.name === 'class_teaching_critic';
    return {
      content: JSON.stringify({
        items: packet.items.map(({ index }) =>
          critic
            ? { index, findings: [] }
            : {
                index,
                criticDecisions: [],
                newFindings: options.reject
                  ? [
                      {
                        sourcePartIndex: 0,
                        issue: 'unnatural',
                        rule: 'The verb must fit its direct object.',
                        defect:
                          'Making flour, eggs and milk does not describe mixing those ingredients.',
                        remedy: {
                          kind: 'correction',
                          text: 'Use a verb for mixing, or make the batter the object.',
                        },
                      },
                    ]
                  : [],
              }
        ),
      }),
      model: 'fixture',
      inputTokens: 0,
      outputTokens: 0,
    };
  });
  const boundary: AIProvider = {
    generateResponse,
    async *streamResponse() {
      throw new Error('Streaming is not used for teaching review.');
    },
  };
  return { boundary, packets };
}

describe('literal completions in paired teaching review', () => {
  it.each([false, true])(
    'shares exact blind completions across both roles and protocol correction=%s',
    async (malformedCritic) => {
      const { boundary, packets } = provider({ malformedCritic });
      const before = structuredClone(question);
      await reviewTeachingContent({
        ...base,
        provider: boundary,
        kind: 'explanations',
        sectionSkill: 'GRAMMAR',
        items: [question],
      });
      const blind = JSON.parse(sectionReviewInput([question])).questions[0];
      expect(blind.completedOptions[3]).toBe(
        'Lena mischte die drei Zutaten selbst in einer Kanne; den fertigen Tee trank sie erst später beim Picknick.\nFür das Picknick hat Lena aus Minze, Zitrone und Wasser einen Kräutertee gebracht .'
      );
      expect(packets).toHaveLength(malformedCritic ? 3 : 2);
      for (const packet of packets) {
        expect(packet.items[0]).toEqual({
          index: 0,
          content: before,
          completedOptions: blind.completedOptions,
          sourceParts: buildTeachingSourceParts(before),
        });
        expect(packet.items[0].content).not.toHaveProperty('completedOptions');
      }
      if (malformedCritic) expect(packets[1].priorProtocolOutput).toBeDefined();
      expect(question).toEqual(before);
      expect(blind).not.toHaveProperty('correctIndex');
      expect(blind).not.toHaveProperty('explanation');
    }
  );

  it('preserves literal option text containing replacement-pattern characters in both stages', async () => {
    const literal = {
      ...question,
      question: 'Das Zeichen heißt _____.',
      options: ['$&', '$1', '$`', '$$'],
    };
    const { boundary, packets } = provider();
    await reviewTeachingContent({
      ...base,
      provider: boundary,
      kind: 'explanations',
      sectionSkill: 'GRAMMAR',
      items: [literal],
    });
    const completedOptions = [
      'Das Zeichen heißt $&.',
      'Das Zeichen heißt $1.',
      'Das Zeichen heißt $`.',
      'Das Zeichen heißt $$.',
    ];
    expect(JSON.parse(sectionReviewInput([literal])).questions[0].completedOptions).toEqual(
      completedOptions
    );
    expect(
      packets.every(
        (packet) =>
          JSON.stringify(packet.items[0].completedOptions) === JSON.stringify(completedOptions)
      )
    ).toBe(true);
  });

  it('retains a genuine collocation rejection rather than treating a rendered completion as valid', async () => {
    const invalid = {
      ...question,
      question:
        'Mehl, Eier und Milch werden verrührt.\nFür den Pfannkuchenteig habe ich Mehl, Eier und Milch in einer Schüssel _____ .',
      options: ['gemacht', 'gekocht', 'gebacken', 'gekauft'],
      explanation: 'Man verrührt die Zutaten zu einem Teig und hat ihn damit gemacht.',
    };
    const { boundary, packets } = provider({ reject: true });
    const failure = await reviewTeachingContent({
      ...base,
      provider: boundary,
      kind: 'explanations',
      sectionSkill: 'GRAMMAR',
      items: [invalid],
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    expect((failure as TeachingQualityRejectionError).issues).toContain('unnatural');
    expect((failure as TeachingQualityRejectionError).feedback[0].feedback.join(' ')).toContain(
      'mixing those ingredients'
    );
    expect(packets[1].items[0].content).toEqual(invalid);
    expect(packets[1].items[0].completedOptions?.[0]).toBe(
      'Mehl, Eier und Milch werden verrührt.\nFür den Pfannkuchenteig habe ich Mehl, Eier und Milch in einer Schüssel gemacht .'
    );
  });

  it.each(['explanations', 'writing'] as const)(
    'does not invent completions for other formats or kinds: %s',
    async (kind) => {
      const items =
        kind === 'writing'
          ? [question]
          : [
              { ...question, question: 'Welche Aussage passt?' },
              { ...question, question: 'Wir _____ gestern _____.' },
            ];
      const { boundary, packets } = provider();
      await reviewTeachingContent({
        ...base,
        provider: boundary,
        kind,
        ...(kind === 'explanations' ? { sectionSkill: 'GRAMMAR' as const } : {}),
        items,
      });
      for (const packet of packets)
        expect(packet.items.every((item) => item.completedOptions === undefined)).toBe(true);
    }
  );
});
