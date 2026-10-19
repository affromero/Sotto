// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { AIOptions, AIProvider, ChatMessage } from '@/lib/providers/ai';
import type { CapturedLearningAi } from '@/lib/learning-ai';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import {
  reviewTeachingContent,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import { teachingNovelFindingReceipts } from '@/lib/classes/quality/teaching-source/novel-findings';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});

type Row = {
  index: number;
  content: Record<string, unknown>;
  sourceParts: Array<{ index: number; fieldPath: string[]; quote: string }>;
};
type Payload = {
  items: Row[];
  introContext?: unknown;
  criticisms?: { items: Array<{ index: number; findings: unknown[] }> };
  novelFindingProposals?: Array<{ itemIndex: number; findingIndex: number }>;
};
type Finding = {
  claim: string;
  defect: string;
  correction: string;
  decision: 'supported' | 'dismissed';
  reason: string;
};
const target = 'Ich habe gestern zu Hause ein neues Regal gebaut.';
const qualifiedClaim =
  'Im Hauptsatz steht das Hilfsverb normalerweise auf Position zwei, das Partizip am Satzende. Bei sehen heißt das Partizip gesehen.';
const cases = [
  {
    name: 'a qualified usual-case claim survives an irrelevant question counterexample',
    claim: qualifiedClaim,
    defect: 'Main clauses include yes/no questions with the auxiliary in first position.',
    correction: 'Specify Aussagesatz rather than Hauptsatz.',
    decision: 'dismissed' as const,
    reason:
      'Normalerweise states the usual case; a yes/no question does not refute this qualified claim.',
  },
  {
    name: 'a false usual-case claim still blocks publication',
    claim: 'Im Aussagesatz steht das Hilfsverb normalerweise auf Position eins.',
    defect: 'The usual auxiliary position in a declarative clause is second, not first.',
    correction: 'Im Aussagesatz steht das Hilfsverb auf Position zwei.',
    decision: 'supported' as const,
    reason: 'Normalerweise does not make the false first-position claim accurate.',
  },
  {
    name: 'an unqualified universal claim still blocks publication',
    claim: 'Im Hauptsatz steht das Hilfsverb immer auf Position zwei.',
    defect: 'Immer includes yes/no questions, whose auxiliary occurs in first position.',
    correction: 'Hast du gestern das Regal gebaut?',
    decision: 'supported' as const,
    reason: 'The verb-first main-clause question refutes the explicitly universal claim.',
  },
  {
    name: 'a claim contradicted by its own quoted example still blocks publication',
    claim: `„${target}“: „Habe“ steht auf Position eins.`,
    defect: 'The quoted declarative has Ich first and habe second.',
    correction: '„Habe“ steht in diesem Beispiel auf Position zwei.',
    decision: 'supported' as const,
    reason: 'The complete quoted example contradicts the claimed first position.',
  },
] satisfies Array<Finding & { name: string }>;

function teaching(claim: string) {
  return {
    version: 1,
    title: 'Über Erlebnisse sprechen',
    explanation: claim,
    workedExamples: [
      {
        prompt: 'Du erzählst, dass du gestern zu Hause ein neues Regal gebaut hast. Was sagst du?',
        answer: target,
        explanation: '„Habe“ steht auf Position zwei; „gebaut“ steht am Satzende.',
      },
      {
        prompt: 'Du erzählst von deinem gestrigen Besuch bei Lea. Was sagst du?',
        answer: 'Ich habe gestern Lea besucht.',
        explanation: '„Besucht“ ist das Partizip von „besuchen“.',
      },
    ],
    commonMistake: {
      incorrect: 'Ich habe gestern ein Regal bauen.',
      correction: 'Ich habe gestern ein Regal gebaut.',
      explanation: 'Im Perfekt brauchst du hier das Partizip „gebaut“.',
    },
    guidedPractice: {
      prompt: 'Erzähle, dass du gestern Lea besucht hast.',
      hint: 'Wähle das passende Hilfsverb und Partizip.',
      answer: 'Ich habe gestern Lea besucht.',
      explanation: '„Besuchen“ bildet das Perfekt mit „haben“.',
    },
  };
}

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('qualified grammar claims in teaching review', () => {
  let instance: SharedTestInstance;
  let identity: { ownerId: string; ownerToken: string };
  let ai: CapturedLearningAi;
  const requests: Array<{ schema: string; system: string; payload: Payload }> = [];

  beforeAll(async () => {
    instance = await createSharedTestInstance('grammar_scope');
    binding.database = instance.database;
    identity = await instance.reset();
  });
  beforeEach(() => {
    const request = new Request('http://localhost/api/v1/classes', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    ai = {
      provider: 'codex',
      model: 'captured-review-model',
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
    requests.length = 0;
  });
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });

  function provider(
    finding: Finding,
    origin: 'critic' | 'adjudicator',
    fieldPath: string[]
  ): AIProvider {
    return {
      async generateResponse(system: string, messages: ChatMessage[], options?: AIOptions) {
        if (!options?.jsonSchema) throw new Error('A canonical review schema is required');
        const schema = options.jsonSchema.name;
        const payload = JSON.parse(messages[0].content as string) as Payload;
        requests.push({ schema, system, payload: structuredClone(payload) });
        let response: unknown;
        if (schema === 'class_teaching_novel_finding_corroboration') {
          response = {
            decisions: payload.novelFindingProposals!.map(({ itemIndex, findingIndex }) => ({
              itemIndex,
              findingIndex,
              decision: finding.decision,
              reason: finding.reason,
            })),
          };
        } else {
          const critic = schema === 'class_intro_critic' || schema === 'class_teaching_critic';
          if (
            !critic &&
            schema !== 'class_intro_adjudicator' &&
            schema !== 'class_teaching_adjudicator'
          )
            throw new Error(`Unexpected provider role ${schema}`);
          response = {
            items: payload.items.map((row) => {
              const part = row.sourceParts.find(
                (entry) => JSON.stringify(entry.fieldPath) === JSON.stringify(fieldPath)
              );
              const proposed = part
                ? [
                    {
                      sourcePartIndex: part.index,
                      issue: 'incorrect',
                      rule: 'Check the actual claim and preserve supplied facts.',
                      defect: finding.defect,
                      remedy: { kind: 'correction', text: finding.correction },
                    },
                  ]
                : [];
              return critic
                ? { index: row.index, findings: origin === 'critic' ? proposed : [] }
                : {
                    index: row.index,
                    criticDecisions: (
                      payload.criticisms?.items.find((item) => item.index === row.index)
                        ?.findings ?? []
                    ).map((_, findingIndex) => ({
                      findingIndex,
                      decision: finding.decision,
                      reason: finding.reason,
                    })),
                    newFindings: origin === 'adjudicator' ? proposed : [],
                  };
            }),
          };
        }
        return {
          content: JSON.stringify(response),
          model: ai.model,
          inputTokens: 0,
          outputTokens: 0,
        };
      },
      async *streamResponse() {
        throw new Error('Review does not stream');
      },
    };
  }

  async function review(
    kind: 'intro' | 'teaching',
    finding: Finding,
    origin: 'critic' | 'adjudicator',
    candidate: Record<string, unknown>,
    fieldPath: string[]
  ) {
    const result = reviewTeachingContent({
      ai,
      userId: identity.ownerId,
      provider: provider(finding, origin, fieldPath),
      kind,
      level: 'A2',
      nativeLang: 'en',
      targetLang: 'de',
      lessonContext: {
        title: 'Über Erlebnisse sprechen',
        objective: 'Erzähle von vergangenen Erlebnissen.',
        grammarPoints: ['Perfekt'],
      },
      items: [candidate],
    });
    if (finding.decision === 'dismissed') await expect(result).resolves.toBeUndefined();
    else {
      const error = await result.catch((value: unknown) => value);
      expect(error).toBeInstanceOf(TeachingQualityRejectionError);
      if (!(error instanceof TeachingQualityRejectionError)) throw error;
      expect(error.issues).toContain('incorrect');
      expect(error.teachingFailure).toMatchObject({
        kind,
        reviews: [expect.objectContaining({ candidate: expect.any(String) })],
      });
      expect(error.feedback.flatMap((entry) => entry.feedback).join(' ')).toContain(finding.defect);
    }
    const prefix = kind === 'intro' ? 'class_intro' : 'class_teaching';
    const schemas = [`${prefix}_critic`, `${prefix}_adjudicator`];
    if (origin === 'adjudicator') schemas.push('class_teaching_novel_finding_corroboration');
    expect(requests.map((request) => request.schema)).toEqual(expect.arrayContaining(schemas));
    for (const { system, payload } of requests) {
      expect(system).toContain('actual quantifiers and explicit local conditions');
      expect(system).toContain('A qualified usual-case statement does not assert a universal rule');
      expect(system).toContain('Counterexamples must refute the actual qualified claim');
      expect(system).toContain('Missing technical terminology alone is not a defect');
      expect(system).toContain('false usual-case claim');
      if (kind === 'intro') expect(payload.introContext).toEqual(candidate);
      else expect(payload.items[0].content).toEqual(candidate);
    }
    if (origin === 'adjudicator')
      expect(teachingNovelFindingReceipts(ai)).toEqual([
        expect.objectContaining({
          status: 'completed',
          decisions: [expect.objectContaining({ decision: finding.decision })],
        }),
      ]);
  }

  describe.each(['intro', 'teaching'] as const)('%s', (kind) => {
    describe.each(['critic', 'adjudicator'] as const)('%s finding', (origin) => {
      it.each(cases)('$name', async (finding) => {
        const candidate =
          kind === 'teaching'
            ? teaching(finding.claim)
            : {
                purpose: 'Erzähle von vergangenen Erlebnissen.',
                about: target,
                focus: [finding.claim],
                examples: [
                  {
                    target,
                    meaning: target,
                    note: `„${target}“: „Gebaut“ ist das Partizip von „bauen“.`,
                  },
                ],
                tips: [`„${target}“: Beachte das Partizip.`],
              };
        await review(
          kind,
          finding,
          origin,
          candidate,
          kind === 'intro' ? ['focus'] : ['explanation']
        );
      });
    });
  });

  it.each(['critic', 'adjudicator'] as const)(
    'retains a genuine omitted-place defect from the %s despite an accurate qualified rule',
    async (origin) => {
      const candidate = teaching(qualifiedClaim);
      candidate.workedExamples[0].answer = 'Ich habe gestern ein neues Regal gebaut.';
      await review(
        'teaching',
        {
          claim: qualifiedClaim,
          defect: 'The answer omits zu Hause, a fact required by the complete prompt.',
          correction: target,
          decision: 'supported',
          reason:
            'An accurate grammar rule does not excuse the omitted place in the worked answer.',
        },
        origin,
        candidate,
        ['workedExamples', '0', 'answer']
      );
    }
  );
});
