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
  authenticTeachingFailure,
  reviewTeachingContent,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import { ReviewerProtocolError } from '@/lib/classes/quality/teaching-review-protocol';
import { teachingNovelFindingReceipts } from '@/lib/classes/quality/teaching-source/novel-findings';
import { assessSectionReview } from '@/lib/classes/section-quality';
import { readingSupportFixture } from '../reading-support-fixture';
import {
  listeningExtractionFixture,
  listeningTurnsFixture,
  listeningWitnessFixture,
} from '../../../listening/witness-fixture';
import { intro } from '../fixture';
import { loadAndRender } from '@/lib/prompt-loader';
import { classIntroGrammarRulePolicy } from '@/lib/classes/class-language-policy';

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
type Proposal = {
  itemIndex: number;
  findingIndex: number;
  finding: unknown;
  passageConcerns?: Array<{ concernIndex: number; quote: string; reason: string }>;
};
type Payload = {
  items: Row[];
  introContext?: unknown;
  criticisms?: { items: Array<{ index: number; findings: unknown[] }> };
  novelFindingProposals?: Proposal[];
  listeningTurns?: ReturnType<typeof listeningTurnsFixture>;
  priorProtocolOutput?: unknown;
};
type Decision = { itemIndex: number; findingIndex: number; decision: string; reason: string };
type Plan = {
  decision?: 'supported' | 'dismissed';
  criticFinding?: boolean;
  targetIndex?: number;
  negative?: 'reading' | 'listening';
  concern?: boolean;
  concernFindingIndex?: number;
  concernDecision?: 'supported' | 'dismissed' | 'uncertain';
  twoFindings?: boolean;
  malformedCritic?: boolean;
  corroborate?: (decisions: Decision[], payload: Payload) => unknown;
  providerError?: Error;
  introFinding?: {
    issue: 'incorrect' | 'unnatural';
    defect: string;
    correction: string;
  };
};

const writing = {
  task: 'Schreibe, dass Lea gestern in Bonn war.',
  sourceText: 'Lea war gestern in Bonn.',
  guidance: 'Behalte den Ort und den Tag.',
};
const passageText = 'HOST: Wenn ich Lea besuchen will, sage ich: „Ich habe gestern Lea besucht.“';
const listening = {
  passageText,
  question: 'Wen hat die Person besucht?',
  options: ['Lea', 'Mia', 'Ben', 'Tom'],
  correctIndex: 0,
  explanation: 'Die Person hat Lea besucht.',
};
const turns = listeningTurnsFixture(passageText);
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;

suite('independent corroboration of novel teaching findings', () => {
  let instance: SharedTestInstance;
  let ai: CapturedLearningAi;
  let userId: string;
  let identity: { ownerId: string; ownerToken: string };
  const requests: Array<{
    schema: string;
    system: string;
    payload: Payload;
    options: AIOptions;
    response?: string;
  }> = [];
  beforeAll(async () => {
    instance = await createSharedTestInstance('teaching_novel');
    binding.database = instance.database;
    identity = await instance.reset();
  });
  beforeEach(() => {
    userId = identity.ownerId;
    const request = new Request('http://localhost/api/v1/classes', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    ai = {
      provider: 'codex',
      model: 'captured-review-model',
      execution: {
        userId,
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

  function provider(plan: Plan = {}): AIProvider {
    let malformedCritic = plan.malformedCritic;
    return {
      async generateResponse(system: string, messages: ChatMessage[], options?: AIOptions) {
        if (!options?.jsonSchema) throw new Error('A canonical review schema is required');
        const schema = options.jsonSchema.name;
        const payload = JSON.parse(messages[0].content as string) as Payload;
        const captured = {
          schema,
          system,
          payload: structuredClone(payload),
          options,
          response: undefined as string | undefined,
        };
        requests.push(captured);
        expect(options.model).toBe(ai.model);
        expect(options.signal).toBe(ai.execution.signal);
        expect(options.apiKeyOverride).toBeUndefined();
        const reply = (content: unknown) => {
          captured.response = typeof content === 'string' ? content : JSON.stringify(content);
          return { content: captured.response, model: ai.model, inputTokens: 0, outputTokens: 0 };
        };
        if (schema === 'class_teaching_novel_finding_corroboration') {
          if (plan.providerError) throw plan.providerError;
          const decisions = payload.novelFindingProposals!.map(({ itemIndex, findingIndex }) => ({
            itemIndex,
            findingIndex,
            decision: plan.decision ?? 'dismissed',
            reason:
              plan.decision === 'supported'
                ? 'The requested statement changes the supplied place.'
                : 'The complete supplied source states the alleged missing place and day.',
          }));
          return reply(
            plan.corroborate?.(decisions, payload) ?? {
              decisions,
              ...(plan.concernDecision
                ? {
                    passageConcernDecisions: payload.novelFindingProposals!.flatMap((proposal) =>
                      (proposal.passageConcerns ?? []).map(({ concernIndex }) => ({
                        concernIndex,
                        decision: plan.concernDecision,
                        reason: 'The original allegation is absent from the complete passage.',
                      }))
                    ),
                  }
                : {}),
            }
          );
        }
        const critic = schema === 'class_teaching_critic' || schema === 'class_intro_critic';
        if (critic && malformedCritic) {
          malformedCritic = false;
          return reply('{');
        }
        if (
          !critic &&
          schema !== 'class_teaching_adjudicator' &&
          schema !== 'class_intro_adjudicator'
        )
          throw new Error(`Unexpected provider role ${schema}`);
        const finding = (row: Row, original = false) =>
          plan.introFinding
            ? {
                sourcePartIndex: row.sourceParts.find((part) => part.fieldPath[0] === 'tips')!
                  .index,
                issue: plan.introFinding.issue,
                rule: 'Check the complete written explanation and quoted forms.',
                defect: plan.introFinding.defect,
                remedy: {
                  kind: 'correction',
                  text: plan.introFinding.correction,
                },
              }
            : {
                sourcePartIndex:
                  row.sourceParts.find(
                    (part) =>
                      part.fieldPath[0] ===
                      (plan.concern ? 'passageText' : original ? 'task' : 'guidance')
                  )?.index ?? row.sourceParts[0].index,
                issue: 'unsupported',
                rule: 'Preserve the supplied actor, place and day.',
                defect: original
                  ? 'The task changes the supplied place.'
                  : 'The stated place and day are absent.',
                remedy: {
                  kind: 'correction',
                  text: 'Use the supplied place and day.',
                },
              };
        const items = payload.items.map((row) => {
          const target = row.index === (plan.targetIndex ?? 0);
          const correctIndex = row.content.correctIndex;
          if (plan.negative === 'reading' && typeof correctIndex !== 'number')
            throw new Error('Reading evidence requires its supplied key.');
          const support =
            plan.negative === 'reading' && typeof correctIndex === 'number'
              ? readingSupportFixture({ ...row, content: { correctIndex } })
              : undefined;
          if (support)
            support.options = support.options.map((option) => ({
              ...option,
              status: option.optionIndex === 1 ? 'supported' : 'unstated',
              passagePartIndices:
                option.optionIndex === 1
                  ? [row.sourceParts.find((part) => part.fieldPath[0] === 'passageText')!.index]
                  : [],
            }));
          return {
            index: row.index,
            ...(support ? { answerSupport: support } : {}),
            ...(schema === 'class_teaching_critic' && row.index === 0 && payload.listeningTurns
              ? { passageWitness: listeningExtractionFixture(payload.listeningTurns) }
              : schema === 'class_teaching_adjudicator' && row.index === 0 && payload.listeningTurns
                ? {
                    passageWitness: {
                      ...listeningWitnessFixture(),
                      additionalPairs:
                        plan.negative === 'listening'
                          ? [
                              {
                                premiseUnitIndex: 0,
                                exampleUnitIndex: 0,
                                premiseMeaning: 'The speaker intends to visit Lea.',
                                exampleMeaning: 'The speaker completed a visit to Lea.',
                                relation: 'claimed_equivalence',
                                checks: {
                                  actor: 'aligned',
                                  event: 'aligned',
                                  time: 'different',
                                  modality: 'different',
                                  negation: 'not_applicable',
                                },
                                status: 'contradicted',
                                reason: 'The completed visit changes the intended event.',
                                remedy: {
                                  kind: 'correction',
                                  text: 'For the intention, say: Ich möchte Lea besuchen.',
                                },
                              },
                            ]
                          : [],
                    },
                  }
                : {}),
            ...(critic
              ? { findings: plan.criticFinding && target ? [finding(row, true)] : [] }
              : {
                  criticDecisions: (
                    payload.criticisms?.items.find((item) => item.index === row.index)?.findings ??
                    []
                  ).map((_, findingIndex) => ({
                    findingIndex,
                    decision: 'supported',
                    reason: 'The requested place differs from the supplied place.',
                  })),
                  newFindings: target
                    ? [
                        finding(row),
                        ...(plan.twoFindings
                          ? [
                              {
                                ...finding(row),
                                rule: 'Preserve the event modality.',
                                defect: 'The completed visit replaces an intended visit.',
                              },
                            ]
                          : []),
                      ]
                    : [],
                }),
          };
        });
        return reply({
          items,
          ...(!critic && plan.concern
            ? {
                passageConcernDecisions: [
                  {
                    concernIndex: 0,
                    decision: 'supported',
                    reason: 'This is the alleged passage defect.',
                    itemIndex: plan.targetIndex ?? 0,
                    findingIndex: plan.concernFindingIndex ?? 0,
                  },
                ],
              }
            : {}),
        });
      },
      async *streamResponse() {
        throw new Error('Review does not stream');
      },
    } as AIProvider;
  }
  const review = (
    plan: Plan = {},
    extra: Partial<Parameters<typeof reviewTeachingContent>[0]> = {}
  ) =>
    reviewTeachingContent({
      ai,
      userId,
      provider: provider(plan),
      level: 'A2',
      nativeLang: 'en',
      targetLang: 'de',
      kind: 'writing',
      items: [writing],
      ...extra,
    });

  it('accepts the unchanged complete task after a false novel claim is explicitly dismissed', async () => {
    const original = structuredClone(writing);
    await expect(review()).resolves.toBeUndefined();
    expect(writing).toEqual(original);
    const proof = requests.find(
      (request) => request.schema === 'class_teaching_novel_finding_corroboration'
    )!;
    expect(proof.payload.items[0].content).toEqual(writing);
    expect(proof.payload.novelFindingProposals).toEqual([
      expect.objectContaining({ itemIndex: 0, findingIndex: 0 }),
    ]);
    expect(proof.payload).not.toHaveProperty('originalAdjudicator');
    expect(teachingNovelFindingReceipts(ai)).toEqual([
      expect.objectContaining({ status: 'completed' }),
    ]);
    expect(teachingNovelFindingReceipts({ ...ai })).toEqual([]);
  });

  it('accepts a candidate without novel findings and retains no corroboration proof', async () => {
    await expect(review({ targetIndex: 4 })).resolves.toBeUndefined();
    expect(teachingNovelFindingReceipts(ai)).toEqual([]);
    expect(
      requests.find((request) => request.schema === 'class_teaching_novel_finding_corroboration')
    ).toBeUndefined();
  });

  it('returns private proof snapshots without exposing mutable retained evidence', async () => {
    await review();
    const original = teachingNovelFindingReceipts(ai);
    const judge = requests.find((request) => request.schema === 'class_teaching_adjudicator')!;
    const critic = requests.find((request) => request.schema === 'class_teaching_critic')!;
    expect(original[0].originalCandidate).toEqual(judge.payload);
    expect(original[0].originalCritic).toEqual(JSON.parse(critic.response!));
    expect(original[0].originalAdjudicatorResponse).toBe(judge.response);
    expect(loadAndRender('class/review-teaching-content.md', original[0].originalContext)).toBe(
      judge.system
    );
    const exposed = teachingNovelFindingReceipts(ai) as unknown as Array<Record<string, unknown>>;
    exposed[0].status = 'failed';
    exposed[0].candidate = {};
    (exposed[0].originalCritic as { items: unknown[] }).items.length = 0;
    expect(teachingNovelFindingReceipts(ai)).toEqual(original);
  });

  it('fails closed when proof capacity is exhausted while preserving earlier receipts', async () => {
    for (let index = 0; index < 64; index++) await review();
    const retained = teachingNovelFindingReceipts(ai);
    await expect(review()).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(teachingNovelFindingReceipts(ai)).toEqual(retained);
  }, 60_000);

  it('rejects a genuinely changed source fact when the novel finding is corroborated', async () => {
    const error = await review(
      { decision: 'supported' },
      { items: [{ ...writing, guidance: 'Schreibe, dass Lea morgen in Köln war.' }] }
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(
      authenticTeachingFailure(error, 'writing', [
        { ...writing, guidance: 'Schreibe, dass Lea morgen in Köln war.' },
      ])
    ).toBeDefined();
    expect(error.issues).toContain('unsupported');
    const packet = JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0].reviewPackets[0];
    const proof = teachingNovelFindingReceipts(ai)[packet.novelFindingCorroboration.receiptIndex];
    expect(packet.novelFindingCorroboration.candidateSha256).toBe(proof.candidateSha256);
    expect(proof.originalAdjudicatorResponse).toBe(
      requests.find((request) => request.schema === 'class_teaching_adjudicator')!.response
    );
    expect(proof.decisions).toEqual([expect.objectContaining({ decision: 'supported' })]);
    expect(packet.adjudicator.items[0].findings).toEqual(
      proof.originalAdjudicator.items[0].findings
    );
  });

  it('preserves a supported original critic finding when a later novel allegation is dismissed', async () => {
    const error = await review(
      { criticFinding: true },
      { items: [{ ...writing, task: 'Schreibe, dass Lea in Köln war.' }] }
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    const packet = JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0].reviewPackets[0];
    expect(packet.adjudicator.items[0].findings).toEqual(packet.critic.items[0].findings);
    const proof = teachingNovelFindingReceipts(ai)[packet.novelFindingCorroboration.receiptIndex];
    expect(proof.originalAdjudicator.items[0].findings).toHaveLength(2);
    expect(proof.decisions).toEqual([
      expect.objectContaining({ findingIndex: 1, decision: 'dismissed' }),
    ]);
  });

  it.each(['reading', 'listening'] as const)(
    'preserves an independent %s evidence failure despite novel dismissal',
    async (negative) => {
      const item =
        negative === 'reading'
          ? {
              ...listening,
              passageText: 'Lea hat gestern Mia besucht.',
              explanation: 'Die Person hat Lea besucht.',
            }
          : listening;
      const error = await review(
        { negative, targetIndex: negative === 'listening' ? 1 : 0 },
        {
          kind: negative === 'reading' ? 'explanations' : 'listening',
          ...(negative === 'reading' ? { sectionSkill: 'READING' } : { listeningTurns: turns }),
          items: [item],
        }
      ).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(TeachingQualityRejectionError);
      if (!(error instanceof TeachingQualityRejectionError)) throw error;
      const packet = JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0].reviewPackets[0];
      expect(packet.adjudicator.items[0].acceptable).toBe(false);
      expect(packet.adjudicator.items[0].findings).toEqual([]);
      const proof = teachingNovelFindingReceipts(ai)[packet.novelFindingCorroboration.receiptIndex];
      expect(
        packet.adjudicator.items[0][negative === 'reading' ? 'answerSupport' : 'passageWitness']
      ).toEqual(
        proof.originalAdjudicator.items[0][
          negative === 'reading' ? 'answerSupport' : 'passageWitness'
        ]
      );
    }
  );

  it.each(['missing', 'duplicate', 'foreign'] as const)(
    'fails closed on %s corroboration coverage',
    async (failure) => {
      await expect(
        review({
          corroborate: (decisions) => ({
            decisions:
              failure === 'missing'
                ? []
                : failure === 'duplicate'
                  ? [decisions[0], decisions[0]]
                  : [
                      {
                        ...decisions[0],
                        itemIndex: 4,
                      },
                    ],
          }),
        })
      ).rejects.toBeInstanceOf(ReviewerProtocolError);
    }
  );

  it('fails closed on an uncertain finding without accepting a later dismissal', async () => {
    let unresolved = true;
    await expect(
      review({
        corroborate: (decisions) => {
          if (!unresolved) return { decisions };
          unresolved = false;
          return {
            decisions: decisions.map((decision) => ({ ...decision, decision: 'uncertain' })),
          };
        },
      })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(teachingNovelFindingReceipts(ai)).toEqual([
      expect.objectContaining({
        status: 'failed',
        decisions: [expect.objectContaining({ decision: 'uncertain' })],
      }),
    ]);
  });

  it('propagates corroborator provider failure without accepting the candidate', async () => {
    const failure = new Error('Provider unavailable');
    await expect(review({ providerError: failure })).rejects.toBe(failure);
    expect(teachingNovelFindingReceipts(ai)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ]);
  });

  it('uses the shared correction allowance and fails closed when a later corroboration is malformed', async () => {
    await expect(review({ malformedCritic: true, corroborate: () => '{' })).rejects.toBeInstanceOf(
      ReviewerProtocolError
    );
    const corrected = requests.find(
      (request) => request.schema === 'class_teaching_critic' && request.payload.priorProtocolOutput
    );
    expect(corrected?.payload.items[0].content).toEqual(writing);
    const proof = requests.find(
      (request) => request.schema === 'class_teaching_novel_finding_corroboration'
    );
    expect(proof?.payload).not.toHaveProperty('priorProtocolOutput');
  });

  it('keeps a supported imported concern unresolved when its referenced novel finding is dismissed', async () => {
    const feedback = assessSectionReview(
      JSON.stringify({
        passageFindings: [
          { sourcePartIndex: 0, issue: 'incorrect', reason: 'Alleged passage defect.' },
        ],
        issues: [],
        questions: [{ index: 0, acceptableOptionIndices: [0], issues: [] }],
      }),
      [listening],
      false,
      'listening'
    ).listeningPassageReview;
    await expect(
      review(
        { negative: 'listening', concern: true },
        {
          kind: 'listening',
          listeningTurns: turns,
          listeningPassageReview: feedback,
          items: [listening],
        }
      )
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
  });

  const completeListening = {
    ...listening,
    passageText: 'EXPERT: Ich habe gestern Lea in Bonn besucht.',
  };
  const passageReview = assessSectionReview(
    JSON.stringify({
      passageFindings: [
        {
          sourcePartIndex: 0,
          issue: 'unsupported',
          reason: 'The stated place and day are absent.',
        },
      ],
      issues: [],
      questions: [{ index: 0, acceptableOptionIndices: [0], issues: [] }],
    }),
    [completeListening],
    false,
    'listening'
  ).listeningPassageReview;
  const listeningReview = {
    kind: 'listening' as const,
    listeningTurns: listeningTurnsFixture(completeListening.passageText),
    listeningPassageReview: passageReview,
    items: [completeListening],
  };

  it('accepts an unchanged passage only after its finding and original blind allegation are independently dismissed', async () => {
    const original = structuredClone(completeListening);
    await expect(
      review({ concern: true, concernDecision: 'dismissed' }, listeningReview)
    ).resolves.toBeUndefined();
    expect(completeListening).toEqual(original);
    const request = requests.find(
      (entry) => entry.schema === 'class_teaching_novel_finding_corroboration'
    )!;
    expect(request.payload.items[0].content.passageText).toBe(completeListening.passageText);
    expect(request.payload.novelFindingProposals).toEqual([
      expect.objectContaining({
        itemIndex: 0,
        findingIndex: 0,
        passageConcerns: [{ concernIndex: 0, ...passageReview!.passageFeedback[0] }],
      }),
    ]);
    const proof = teachingNovelFindingReceipts(ai)[0];
    expect(proof.status).toBe('completed');
    expect(proof.originalAdjudicator.passageConcernDecisions).toEqual([
      expect.objectContaining({ concernIndex: 0, decision: 'supported', findingIndex: 0 }),
    ]);
    expect(JSON.parse(proof.originalAdjudicatorResponse).passageConcernDecisions).toEqual(
      proof.originalAdjudicator.passageConcernDecisions
    );
    expect(JSON.parse(proof.response!).passageConcernDecisions).toEqual(
      proof.passageConcernDecisions
    );
    expect(proof.adjudicator!.passageConcernDecisions).toEqual([
      expect.objectContaining({ concernIndex: 0, decision: 'dismissed' }),
    ]);
    expect(proof.adjudicator!.items[0].findings).toEqual([]);
  });

  it('keeps a retained supported finding blocking when its separate blind concern is dismissed', async () => {
    const error = await review(
      { concern: true, decision: 'supported', concernDecision: 'dismissed' },
      listeningReview
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    const proof = teachingNovelFindingReceipts(ai)[0];
    expect(proof.adjudicator!.items[0].findings).toEqual(
      proof.originalAdjudicator.items[0].findings
    );
    expect(proof.adjudicator!.passageConcernDecisions).toEqual([
      expect.objectContaining({ decision: 'dismissed' }),
    ]);
  });

  it('fails closed when the original broader concern survives dismissal of its narrower finding', async () => {
    await expect(
      review({ concern: true, concernDecision: 'supported' }, listeningReview)
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(teachingNovelFindingReceipts(ai)).toEqual([
      expect.objectContaining({
        status: 'failed',
        decisions: [expect.objectContaining({ decision: 'dismissed' })],
        passageConcernDecisions: [expect.objectContaining({ decision: 'supported' })],
        adjudicator: null,
      }),
    ]);
  });

  it('fails closed on an uncertain original concern without accepting a later dismissal', async () => {
    let unresolved = true;
    await expect(
      review(
        {
          concern: true,
          corroborate: (decisions) => {
            const decision = unresolved ? 'uncertain' : 'dismissed';
            unresolved = false;
            return {
              decisions,
              passageConcernDecisions: [
                {
                  concernIndex: 0,
                  decision,
                  reason: 'The original allegation has unresolved source evidence.',
                },
              ],
            };
          },
        },
        listeningReview
      )
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(teachingNovelFindingReceipts(ai)).toEqual([
      expect.objectContaining({
        status: 'failed',
        passageConcernDecisions: [expect.objectContaining({ decision: 'uncertain' })],
      }),
    ]);
  });

  it.each(['missing', 'duplicate', 'foreign'] as const)(
    'fails closed on %s original concern coverage',
    async (failure) => {
      const dismissal = {
        concernIndex: 0,
        decision: 'dismissed',
        reason: 'The allegation is absent.',
      };
      await expect(
        review(
          {
            concern: true,
            corroborate: (decisions) => ({
              decisions,
              passageConcernDecisions:
                failure === 'missing'
                  ? []
                  : failure === 'duplicate'
                    ? [dismissal, dismissal]
                    : [{ ...dismissal, concernIndex: 1 }],
            }),
          },
          listeningReview
        )
      ).rejects.toBeInstanceOf(ReviewerProtocolError);
    }
  );

  it('corroborates an intro finding against the same complete compiled context', async () => {
    await expect(review({}, { kind: 'intro', items: [intro] })).resolves.toBeUndefined();
    const proof = requests.find(
      (request) => request.schema === 'class_teaching_novel_finding_corroboration'
    )!;
    expect(proof.payload.introContext).toEqual(intro);
    expect(teachingNovelFindingReceipts(ai)).toEqual([
      expect.objectContaining({ status: 'completed' }),
    ]);
  });

  it.each([
    {
      name: 'accepts separately quoted forms after an invented compound claim is dismissed',
      tip: 'Beim Verb „gehen“ steht im Perfekt hier „bin“ mit „gegangen“.',
      issue: 'unnatural' as const,
      defect: 'The explanatory word “mit” could be joined to the quoted form as “mitgehen”.',
      decision: 'dismissed' as const,
      reason: 'The separately quoted forms and complete example describe gehen, not mitgehen.',
    },
    {
      name: 'rejects malformed surrounding prose despite correctly quoted forms',
      tip: 'Die Form „bin“ stehen hier mit „gegangen“.',
      issue: 'incorrect' as const,
      defect: 'The singular subject “Die Form” incorrectly takes the plural verb “stehen”.',
      decision: 'supported' as const,
      reason: 'Quotation does not repair the incorrect subject-verb agreement in the prose.',
    },
    {
      name: 'rejects a false auxiliary claim despite correctly quoted forms',
      tip: 'Beim Verb „gehen“ ist „bin“ hier die Form von „haben“.',
      issue: 'incorrect' as const,
      defect: 'The explanation incorrectly identifies “bin” as a form of “haben”.',
      decision: 'supported' as const,
      reason: 'The quoted form bin belongs to sein; the displayed auxiliary claim is false.',
    },
  ])('$name', async ({ tip, issue, defect, decision, reason }) => {
    const target = 'Ich bin gestern zu Fuß zum Bahnhof gegangen.';
    const compiledTip = `„${target}“: ${tip}`;
    const candidate = {
      purpose: 'Erzähle von gestern.',
      about: '„Ich habe gestern das Stadtmuseum besucht.“: Die Person hat das Stadtmuseum besucht.',
      focus: ['„Ich habe gestern das Stadtmuseum besucht.“: „Habe“ steht auf Position zwei.'],
      tips: [compiledTip],
      examples: [
        {
          target: 'Ich habe gestern das Stadtmuseum besucht.',
          meaning: 'Die Person hat gestern das Stadtmuseum besucht.',
          note: '„Besucht“ ist das Partizip von „besuchen“.',
        },
        {
          target,
          meaning: 'Die Person ist gestern zu Fuß zum Bahnhof gegangen.',
          note: '„Bin“ steht auf Position zwei; „gegangen“ steht am Satzende.',
        },
      ],
    };
    const result = review(
      {
        targetIndex: 3,
        introFinding: {
          issue,
          defect,
          correction: 'Beim Verb „gehen“ bildet man das Perfekt hier mit „sein“.',
        },
        corroborate: (decisions) => ({
          decisions: decisions.map((entry) => ({ ...entry, decision, reason })),
        }),
      },
      { kind: 'intro', items: [candidate] }
    );
    if (decision === 'dismissed') await expect(result).resolves.toBeUndefined();
    else {
      const error = await result.catch((value: unknown) => value);
      expect(error).toBeInstanceOf(TeachingQualityRejectionError);
      if (!(error instanceof TeachingQualityRejectionError)) throw error;
      expect(error.issues).toContain(issue);
    }
    for (const request of requests) {
      expect(request.system).toContain(classIntroGrammarRulePolicy());
      expect(request.payload.introContext).toEqual(candidate);
      const assigned = request.payload.items.find(
        ({ content }) => (content.address as { field: string }).field === 'tips'
      );
      if (assigned) {
        expect(assigned.content).toEqual({
          address: { field: 'tips', index: 0 },
          fields: { tips: compiledTip },
        });
        expect(assigned.sourceParts).toEqual([
          { index: 0, fieldPath: ['tips'], quote: compiledTip },
        ]);
      }
    }
    const proof = teachingNovelFindingReceipts(ai).find((receipt) =>
      receipt.originalAdjudicator.items.some((item) =>
        item.findings.some((finding) => finding.quote === compiledTip)
      )
    )!;
    expect(proof.originalAdjudicator.items.find((item) => item.index === 3)!.findings).toEqual([
      expect.objectContaining({ quote: compiledTip, issue, defect }),
    ]);
    expect(proof.decisions).toEqual([
      expect.objectContaining({
        itemIndex: 3,
        findingIndex: 0,
        decision,
        reason,
      }),
    ]);
    expect(proof.adjudicator!.items.find((item) => item.index === 3)!.findings).toEqual(
      decision === 'dismissed'
        ? []
        : proof.originalAdjudicator.items.find((item) => item.index === 3)!.findings
    );
    expect(candidate.tips).toEqual([compiledTip]);
  });

  it('remaps a surviving supported concern while preserving its original finding index privately', async () => {
    const feedback = assessSectionReview(
      JSON.stringify({
        passageFindings: [
          {
            sourcePartIndex: 0,
            issue: 'incorrect',
            reason: 'The completed visit changes the intended event.',
          },
        ],
        issues: [],
        questions: [{ index: 0, acceptableOptionIndices: [0], issues: [] }],
      }),
      [listening],
      false,
      'listening'
    ).listeningPassageReview;
    const error = await review(
      {
        negative: 'listening',
        concern: true,
        concernFindingIndex: 1,
        twoFindings: true,
        corroborate: (decisions) => ({
          decisions: decisions.map((decision) => ({
            ...decision,
            decision: decision.findingIndex === 0 ? 'dismissed' : 'supported',
          })),
          passageConcernDecisions: [
            {
              concernIndex: 0,
              decision: 'supported',
              reason: 'The original event defect remains.',
            },
          ],
        }),
      },
      {
        kind: 'listening',
        listeningTurns: turns,
        listeningPassageReview: feedback,
        items: [listening],
      }
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    const packet = JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0].reviewPackets[0];
    const proof = teachingNovelFindingReceipts(ai)[packet.novelFindingCorroboration.receiptIndex];
    expect(proof.originalAdjudicator.passageConcernDecisions![0]).toMatchObject({
      decision: 'supported',
      findingIndex: 1,
    });
    expect(packet.adjudicator.passageConcernDecisions[0]).toMatchObject({
      decision: 'supported',
      findingIndex: 0,
    });
    expect(packet.adjudicator.items[0].findings).toEqual([
      proof.originalAdjudicator.items[0].findings[1],
    ]);
  });
});
