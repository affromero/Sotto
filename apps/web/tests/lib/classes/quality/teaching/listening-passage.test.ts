import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIOptions, AIProvider, ChatMessage } from '@/lib/providers/ai';
import { params } from './fixture';

vi.mock('@/lib/learning-ai', () => ({
  capturedLearningAiOptions: async () => ({ model: 'captured' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

import { assessSectionReview } from '@/lib/classes/section-quality';
import {
  reviewTeachingContent,
  TeachingQualityRejectionError,
  authenticListeningTeachingReview,
} from '@/lib/classes/quality/teaching-quality';
import { ReviewerProtocolError } from '@/lib/classes/quality/teaching-review-protocol';
import { listeningRepairPlan as boundListeningRepairPlan } from '@/lib/classes/quality/listening-repair';
import {
  listeningTurnsFixture,
  listeningExtractionFixture,
  listeningWitnessFixture,
  withListeningWitnessFixture,
} from '../../listening/witness-fixture';

const passage = 'HOST: Wohin ist Lea gefahren?\nEXPERT: Lea ist nach Bonn gefahren.';
const questions = () =>
  Array.from({ length: 4 }, (_, index) => ({
    question: `Wohin ist Lea gefahren? ${index + 1}`,
    options: ['Nach Bonn', 'Nach Köln', 'Nach Berlin', 'Nach Hamburg'],
    correctIndex: 0,
    explanation: 'Lea sagt Bonn.',
    passageText: passage,
  }));
function observation(items = questions(), hard?: 'question' | 'global' | 'key') {
  return assessSectionReview(
    JSON.stringify({
      passageFindings: [
        {
          sourcePartIndex: 0,
          issue: 'incorrect',
          reason: 'The finite verb must follow the first constituent.',
        },
      ],
      issues: hard === 'global' ? ['unsupported'] : [],
      questions: items.map((_, index) => ({
        index,
        acceptableOptionIndices: hard === 'key' && index === 0 ? [1] : [0],
        issues: hard === 'question' && index === 0 ? ['ambiguous'] : [],
      })),
    }),
    items,
    false,
    'listening'
  );
}
type Row = {
  index: number;
  content: Record<string, unknown>;
  sourceParts: Array<{ index: number; fieldPath: string[] }>;
};
const respond = vi.fn();
const seen: Array<Record<string, unknown>> = [];
let defect: 'none' | 'passage' | 'question';
let decision: 'dismissed' | 'supported';
let badReference = false;
beforeEach(() => {
  defect = 'none';
  decision = 'dismissed';
  badReference = false;
  seen.length = 0;
  respond.mockReset();
  respond.mockImplementation(
    async (_system: string, messages: ChatMessage[], options: AIOptions) => {
      const input = JSON.parse(messages[0].content as string);
      seen.push(input);
      const rows = input.items as Row[];
      if (options.jsonSchema?.name === 'class_teaching_critic')
        return {
          model: 'captured',
          content: JSON.stringify({
            items: rows.map((row) => ({ index: row.index, findings: [] })),
          }),
        };
      const target = defect === 'question' ? 4 : 0;
      const finding = (row: Row) => ({
        sourcePartIndex: row.sourceParts.find(
          (part) => part.fieldPath[0] === (defect === 'question' ? 'question' : 'passageText')
        )!.index,
        issue: 'incorrect',
        rule: 'Preserve the actual supplied fact.',
        defect: 'The candidate changes the supplied fact.',
        remedy: { kind: 'correction', text: 'Use the supplied fact.' },
      });
      return {
        model: 'captured',
        content: JSON.stringify({
          items: rows.map((row) => ({
            index: row.index,
            criticDecisions: [],
            newFindings: defect !== 'none' && row.index === target ? [finding(row)] : [],
          })),
          passageConcernDecisions: [
            {
              concernIndex: 0,
              decision,
              reason: 'Assessed against the complete passage.',
              ...(decision === 'supported'
                ? { itemIndex: badReference ? 4 : target, findingIndex: 0 }
                : {}),
            },
          ],
        }),
      };
    }
  );
});
function review(
  items = questions(),
  feedback = observation(items).listeningPassageReview,
  listeningSource?: string
) {
  return reviewTeachingContent({
    ...params,
    kind: 'listening',
    items,
    ai: { provider: 'fixture', model: 'captured', execution: params.execution },
    provider: {
      generateResponse: async (system: string, messages: ChatMessage[], options?: AIOptions) =>
        withListeningWitnessFixture(
          messages as Array<{ content: string }>,
          options,
          await respond(system, messages, options)
        ),
    } as AIProvider,
    listeningPassageReview: feedback,
    listeningSource,
    listeningTurns: listeningTurnsFixture(items[0].passageText),
  });
}

function listeningRepairPlan(
  error: TeachingQualityRejectionError,
  items: ReturnType<typeof questions>,
  source?: string
) {
  return boundListeningRepairPlan(
    error,
    items,
    source,
    listeningTurnsFixture(items[0].passageText)
  );
}

describe('listening passage concern adjudication', () => {
  it.each(['proposed', 'discovered'] as const)(
    'rejects and repairs a %s negative relation with no ordinary findings',
    async (origin) => {
      const items = questions().map((item) => ({
        ...item,
        passageText: 'HOST: Wenn ich Lea besuchen will, sage ich: „Ich habe Lea besucht.“',
      }));
      const turns = listeningTurnsFixture(items[0].passageText);
      const witness = {
        ...listeningWitnessFixture(),
        additionalPairs: [
          {
            premiseUnitIndex: 0,
            exampleUnitIndex: 0,
            premiseMeaning: 'The speaker wants to visit Lea.',
            exampleMeaning: 'The speaker has completed a visit to Lea.',
            relation: 'claimed_equivalence',
            checks: {
              actor: 'aligned',
              event: 'aligned',
              time: 'different',
              modality: 'different',
              negation: 'not_applicable',
            },
            status: 'contradicted',
            reason: 'The example reports a completed visit rather than an intended visit.',
            remedy: {
              kind: 'correction',
              text: 'For the intention, say: „Ich möchte Lea besuchen.“',
            },
          },
        ],
      };
      const original = respond.getMockImplementation()!;
      const comparison = witness.additionalPairs[0];
      const proposed = {
        premiseUnitIndex: 0,
        exampleUnitIndex: 0,
        premiseMeaning: 'The speaker reports visiting Lea.',
        exampleMeaning: 'The speaker has completed a visit to Lea.',
        relation: 'claimed_equivalence',
      };
      respond.mockImplementation(
        async (system: string, messages: ChatMessage[], options: AIOptions) => {
          const response = await original(system, messages, options);
          if (options.jsonSchema?.name === 'class_teaching_critic') {
            const parsed = JSON.parse(response.content);
            parsed.items[0].passageWitness = {
              ...listeningExtractionFixture(turns),
              pairs: origin === 'proposed' ? [proposed] : [],
            };
            return { ...response, content: JSON.stringify(parsed) };
          }
          const input = JSON.parse(messages[0].content as string);
          expect(input.criticisms.items[0]).not.toHaveProperty('passageWitness');
          expect(input.criticisms.items[0].passagePairs).toEqual(
            origin === 'proposed' ? [{ ...proposed, pairIndex: 0 }] : []
          );
          expect(JSON.stringify(input.criticisms)).not.toContain('unitAccounts');
          const parsed = JSON.parse(response.content);
          const { premiseUnitIndex, exampleUnitIndex, ...assessment } = comparison;
          expect([premiseUnitIndex, exampleUnitIndex]).toEqual([0, 0]);
          parsed.items[0].passageWitness =
            origin === 'proposed'
              ? {
                  pairDecisions: [{ pairIndex: 0, decision: 'compared', ...assessment }],
                  additionalPairs: [],
                }
              : witness;
          return { ...response, content: JSON.stringify(parsed) };
        }
      );
      const error = await review(items).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(TeachingQualityRejectionError);
      if (!(error instanceof TeachingQualityRejectionError)) throw error;
      const packet = JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0];
      expect(packet.reviewPackets[0].adjudicator.items[0]).toMatchObject({
        acceptable: false,
        findings: [],
      });
      const retained = packet.reviewPackets[0].adjudicator.items[0].passageWitness;
      expect(
        origin === 'proposed' ? retained.pairDecisions[0] : retained.additionalPairs[0]
      ).toMatchObject({
        ...comparison,
        comparisonIndex: 0,
        premiseTurnIndex: 1,
        exampleTurnIndex: 1,
        sourcePartIndices: [0],
      });
      expect(packet.reviewPackets[0].critic.items[0].passageWitness.unitAccounts).toEqual(
        listeningExtractionFixture(turns).unitAccounts
      );
      const repair = boundListeningRepairPlan(error, items, undefined, turns);
      expect(repair).toMatchObject({
        target: 'script',
        verdict: {
          findings: [
            {
              index: 0,
              findings: [
                {
                  fieldPath: ['passageText'],
                  defect: witness.additionalPairs[0].reason,
                  correction: witness.additionalPairs[0].remedy.text,
                },
              ],
            },
          ],
        },
      });
      expect(boundListeningRepairPlan(error, items)).toBeNull();
      expect(
        boundListeningRepairPlan(error, items, undefined, [{ ...turns[0], text: 'Changed.' }])
      ).toBeNull();
      expect(
        boundListeningRepairPlan(error, items, undefined, [{ ...turns[0], speaker: 'EXPERT' }])
      ).toBeNull();
    }
  );

  it('dismisses an unfounded passage allegation without exposing blind answer approvals to the pair', async () => {
    await expect(review()).resolves.toBeUndefined();
    expect(seen).toHaveLength(2);
    expect((seen[0].items as Row[]).map((row) => row.index)).toEqual([0]);
    expect((seen[1].items as Row[]).map((row) => row.index)).toEqual([0, 1, 2, 3, 4]);
    expect(seen[1].criticisms).toMatchObject({ items: [{ index: 0, findings: [] }] });
    expect(seen[0]).not.toHaveProperty('listeningPassageReview');
    for (const input of seen) {
      expect(input.criticAssignment).toEqual([0]);
      expect((input.items as Row[])[0].content).toEqual({ passageText: passage });
    }
    expect(seen[1].listeningPassageReview).toEqual({
      passageFeedback: [
        {
          concernIndex: 0,
          quote: passage,
          reason: 'The finite verb must follow the first constituent.',
        },
      ],
    });
    expect(JSON.stringify(seen[1].listeningPassageReview)).not.toContain('acceptableOptionIndices');
  });

  it.each(['supported', 'dismissed'] as const)(
    'routes an independently retained passage defect to script repair even when the original concern is %s',
    async (mode) => {
      defect = 'passage';
      decision = mode;
      const items = questions();
      const error = await review(items).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(TeachingQualityRejectionError);
      if (!(error instanceof TeachingQualityRejectionError)) throw error;
      const plan = listeningRepairPlan(error, items);
      expect(plan).toMatchObject({
        target: 'script',
        verdict: { findings: [{ index: 0, findings: [{ fieldPath: ['passageText'] }] }] },
      });
      const packet = JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0];
      expect(packet.items).toEqual(items);
      expect(packet.listeningPassageReview).toMatchObject({ questions: expect.any(Array) });
      expect(packet.reviewPackets[0].adjudicator.passageConcernDecisions[0].decision).toBe(mode);
    }
  );

  it('maps a question-only defect back to its original quiz index after dismissing the passage concern', async () => {
    defect = 'question';
    const items = questions();
    const error = await review(items).catch((failure: unknown) => failure);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(listeningRepairPlan(error, items)).toMatchObject({
      target: 'quiz',
      verdict: { findings: [{ index: 3, findings: [{ fieldPath: ['question'] }] }] },
    });
    const packet = JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0];
    expect(packet.reviewPackets[0].criticAssignment).toEqual([0]);
    expect(packet.reviewPackets[0].critic.items.map((row: { index: number }) => row.index)).toEqual(
      [0]
    );
    expect(packet.reviewPackets[0].adjudicator.items[4]).toMatchObject({
      acceptable: false,
      criticDecisions: [],
    });
    const changed = structuredClone(items);
    changed[3].question += ' Changed';
    expect(listeningRepairPlan(error, changed)).toBeNull();
    error.teachingFailure!.reviews[0].candidate += ' ';
    expect(listeningRepairPlan(error, items)).toBeNull();
  });

  it.each(['question', 'global', 'key'] as const)(
    'does not grant passage adjudication authority when a hard %s defect remains',
    (hard) => {
      const assessed = observation(questions(), hard);
      expect(assessed.questionIssues?.length).toBeGreaterThan(0);
      expect(assessed.listeningPassageReview).toBeUndefined();
      expect(seen).toEqual([]);
    }
  );

  it.each(['copied', 'mutated', 'candidate'] as const)(
    'rejects %s observation binding before provider work',
    async (change) => {
      const items = questions();
      const issued = observation(items).listeningPassageReview!;
      const feedback = change === 'copied' ? structuredClone(issued) : issued;
      if (change === 'mutated') feedback.passageFeedback[0].reason += ' changed';
      if (change === 'candidate') items[0].question += ' changed';
      await expect(review(items, feedback)).rejects.toBeInstanceOf(ReviewerProtocolError);
      expect(seen).toEqual([]);
    }
  );

  it('rejects a supported concern that points at a question finding instead of a passage finding', async () => {
    defect = 'question';
    decision = 'supported';
    badReference = true;
    await expect(review()).rejects.toBeInstanceOf(ReviewerProtocolError);
  });

  it('binds source-aware repair to the exact original context and retains it through protocol correction', async () => {
    defect = 'passage';
    const source = 'Source material:\nLea remained in Köln.';
    const original = respond.getMockImplementation()!;
    let malformed = true;
    respond.mockImplementation(
      async (system: string, messages: ChatMessage[], options: AIOptions) => {
        const input = JSON.parse(messages[0].content as string);
        expect(input.listeningSource).toBe(source);
        if (options.jsonSchema?.name === 'class_teaching_adjudicator' && malformed) {
          malformed = false;
          return { model: 'captured', content: '{' };
        }
        return original(system, messages, options);
      }
    );
    const items = questions();
    const error = await review(items, observation(items).listeningPassageReview, source).catch(
      (failure: unknown) => failure
    );
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(listeningRepairPlan(error, items, source)?.target).toBe('script');
    expect(listeningRepairPlan(error, items)).toBeNull();
    expect(listeningRepairPlan(error, items, source + ' changed')).toBeNull();
    const packet = JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0];
    expect(packet.listeningSource).toBe(source);
  });

  it('omits absent source context rather than treating fictional dialogue as sourced claims', async () => {
    await review();
    for (const input of seen) expect(input).not.toHaveProperty('listeningSource');
  });

  it('repairs an oversized rejected candidate while keeping persisted diagnostics capped and live authority isolated', async () => {
    defect = 'passage';
    const items = questions().map((item) => ({
      ...item,
      passageText: item.passageText + ' Lea erzählt von ihrer Reise.'.repeat(300),
    }));
    const source = 'Source material:\nLea remained in Köln.';
    const error = await review(items, observation(items).listeningPassageReview, source).catch(
      (failure: unknown) => failure
    );
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(error.teachingFailure!.reviews[0]).toMatchObject({
      candidate: null,
      omitted: 'size_limit',
    });
    expect(listeningRepairPlan(error, items, source)).toMatchObject({
      target: 'script',
      verdict: { findings: [{ index: 0, findings: [{ fieldPath: ['passageText'] }] }] },
    });
    const returned = authenticListeningTeachingReview(error, items)!;
    Object.assign(returned.candidate[0] as object, { listeningSource: 'Changed source' });
    expect(listeningRepairPlan(error, items, source)?.target).toBe('script');
    expect(listeningRepairPlan(error, items, source + ' changed')).toBeNull();
    const changed = structuredClone(items);
    changed[0].question += ' changed';
    expect(listeningRepairPlan(error, changed, source)).toBeNull();
    const copied = new TeachingQualityRejectionError(
      error.issues,
      error.feedback,
      error.teachingFailure
    );
    expect(listeningRepairPlan(copied, items, source)).toBeNull();
    error.teachingFailure!.reviews[0].verdict.items[0].feedback.push('Mutated verdict');
    expect(listeningRepairPlan(error, items, source)).toBeNull();
  });

  it('rejects listening source context on another teaching kind before dispatch', async () => {
    await expect(
      reviewTeachingContent({
        ...params,
        kind: 'writing',
        items: [{ task: 'Write a reply.' }],
        ai: { provider: 'fixture', model: 'captured', execution: params.execution },
        provider: { generateResponse: respond } as unknown as AIProvider,
        listeningSource: 'A supplied story.',
      })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(seen).toEqual([]);
  });

  it('requires the original turn table before a fresh listening review can call the provider', async () => {
    await expect(
      reviewTeachingContent({
        ...params,
        kind: 'listening',
        items: questions(),
        ai: { provider: 'fixture', model: 'captured', execution: params.execution },
        provider: { generateResponse: respond } as unknown as AIProvider,
      })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(seen).toEqual([]);
  });
});
