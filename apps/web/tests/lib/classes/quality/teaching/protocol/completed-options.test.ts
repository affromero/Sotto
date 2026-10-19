// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { novelFindingCorroborationFixture } from '../../intro-provider-fixture';
import type { AIProvider } from '@/lib/providers/ai';
import type { CapturedLearningAi } from '@/lib/learning-ai';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});
import { sectionReviewInput } from '@/lib/classes/section-quality';
import { ReviewerProtocolError } from '@/lib/classes/quality/teaching-review-protocol';
import {
  reviewTeachingContent,
  requestTeachingReview,
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
let identity: { ownerId: string; ownerToken: string };
function base() {
  const request = new Request('http://localhost/api/v1/classes', {
    headers: { cookie: `sotto_session=${identity.ownerToken}` },
  });
  const ai: CapturedLearningAi = {
    provider: 'codex',
    model: 'captured-model',
    execution: {
      userId: identity.ownerId,
      signal: new AbortController().signal,
      authorize: async (database) => {
        const current = await resolveSottoRequest(database, request);
        if (!current || current.kind !== 'content') throw new Error('Fixture admission expired');
        return current;
      },
    },
  };
  return { ai, userId: identity.ownerId, level: 'A2', nativeLang: 'en', targetLang: 'de' };
}
type Packet = {
  exerciseMode?: 'vocabulary_recall';
  items: Array<{
    index: number;
    content: unknown;
    completedOptions?: string[];
    sourceParts: unknown[];
  }>;
  priorProtocolOutput?: unknown;
};

function provider(
  options: { malformedCritic?: boolean; reject?: boolean; missingWordingEvidence?: boolean } = {}
) {
  const packets: Packet[] = [];
  const generateResponse = vi.fn(async (...args: Parameters<AIProvider['generateResponse']>) => {
    const [, messages, ai] = args;
    const corroboration = novelFindingCorroborationFixture(
      messages as Array<{ content: string }>,
      ai
    );
    if (corroboration) return { ...corroboration, inputTokens: 0, outputTokens: 0 };
    const packet = JSON.parse(messages[0].content as string) as Packet;
    packets.push(packet);
    if (options.malformedCritic && packets.length === 1)
      return { content: '{', model: 'fixture', inputTokens: 0, outputTokens: 0 };
    const critic = ai?.jsonSchema?.name === 'class_teaching_critic';
    return {
      content: JSON.stringify({
        items: packet.items.map(({ index }) =>
          critic
            ? {
                index,
                findings: options.missingWordingEvidence
                  ? [
                      {
                        sourcePartIndex: 0,
                        issue: 'unnatural',
                        rule: 'Use clear wording.',
                        defect: 'Another instruction would sound smoother.',
                        remedy: { kind: 'correction', text: 'Choose the appropriate verb.' },
                      },
                    ]
                  : [],
              }
            : {
                index,
                criticDecisions: options.missingWordingEvidence
                  ? [
                      {
                        findingIndex: 0,
                        decision: packet.priorProtocolOutput ? 'dismissed' : 'supported',
                        reason: 'The complete task is clear; only a wording preference remains.',
                      },
                    ]
                  : [],
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

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('literal completions in paired teaching review', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    instance = await createSharedTestInstance('literal_completions');
    binding.database = instance.database;
    identity = await instance.reset();
  });
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });
  it.each([
    { malformedCritic: false, vocabularyRecall: false },
    { malformedCritic: true, vocabularyRecall: false },
    { malformedCritic: false, vocabularyRecall: true },
    { malformedCritic: true, vocabularyRecall: true },
  ])(
    'shares exact completions and task identity: correction=$malformedCritic, vocabulary=$vocabularyRecall',
    async ({ malformedCritic, vocabularyRecall }) => {
      const { boundary, packets } = provider({ malformedCritic });
      const before = structuredClone(question);
      await reviewTeachingContent({
        ...base(),
        provider: boundary,
        kind: 'explanations',
        sectionSkill: 'GRAMMAR',
        ...(vocabularyRecall ? { exerciseMode: 'vocabulary_recall' as const } : {}),
        items: [question],
      });
      const blind = JSON.parse(sectionReviewInput([question])).questions[0];
      expect(blind.completedOptions[3]).toBe(
        'Lena mischte die drei Zutaten selbst in einer Kanne; den fertigen Tee trank sie erst später beim Picknick.\nFür das Picknick hat Lena aus Minze, Zitrone und Wasser einen Kräutertee gebracht .'
      );
      expect(packets).toHaveLength(malformedCritic ? 3 : 2);
      for (const packet of packets) {
        expect(packet.exerciseMode).toBe(vocabularyRecall ? 'vocabulary_recall' : undefined);
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

  it('corrects missing blocking evidence under the same vocabulary task before accepting dismissal', async () => {
    const { boundary, packets } = provider({ missingWordingEvidence: true });
    await expect(
      reviewTeachingContent({
        ...base(),
        provider: boundary,
        kind: 'explanations',
        sectionSkill: 'GRAMMAR',
        exerciseMode: 'vocabulary_recall',
        items: [question],
      })
    ).resolves.toBeUndefined();
    expect(packets).toHaveLength(3);
    expect(packets[1].priorProtocolOutput).toBeUndefined();
    expect(packets[2].priorProtocolOutput).toBeDefined();
    for (const packet of packets) {
      expect(packet.exerciseMode).toBe('vocabulary_recall');
      expect(packet.items[0].content).toEqual(question);
      expect(packet.items[0].sourceParts).toEqual(buildTeachingSourceParts(question));
    }
  });

  it.each([
    { kind: 'writing' as const, sectionSkill: undefined },
    { kind: 'explanations' as const, sectionSkill: 'READING' as const },
  ])('rejects vocabulary task identity on $kind/$sectionSkill before review', async (mode) => {
    const { boundary, packets } = provider();
    await expect(
      reviewTeachingContent({
        ...base(),
        ...mode,
        provider: boundary,
        exerciseMode: 'vocabulary_recall',
        items: [question],
      })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(packets).toEqual([]);
  });

  it.each([
    { kind: 'explanations', sectionSkill: undefined },
    { kind: 'explanations', sectionSkill: 'READING' as const },
    { kind: 'writing', sectionSkill: 'GRAMMAR' as const },
  ])('rejects recall mode on an incompatible request scope: $kind/$sectionSkill', async (scope) => {
    const { boundary, packets } = provider();
    await expect(
      requestTeachingReview({
        ...base(),
        provider: boundary,
        prompt: 'class/review-teaching-content.md',
        variables: { KIND: scope.kind, TEACHING_REVIEW_ROLE: 'critic' },
        sectionSkill: scope.sectionSkill,
        exerciseMode: 'vocabulary_recall',
        items: [question],
        jsonSchema: { name: 'class_teaching_critic', schema: { type: 'object' } },
      })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(packets).toEqual([]);
  });

  it('preserves literal option text containing replacement-pattern characters in both stages', async () => {
    const literal = {
      ...question,
      question: 'Das Zeichen heißt _____.',
      options: ['$&', '$1', '$`', '$$'],
    };
    const { boundary, packets } = provider();
    await reviewTeachingContent({
      ...base(),
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
      ...base(),
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
        ...base(),
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
