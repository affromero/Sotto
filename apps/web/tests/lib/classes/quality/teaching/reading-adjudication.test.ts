import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIOptions, AIProvider, ChatMessage } from '@/lib/providers/ai';
import type { GeneratedQuestion } from '@/lib/class-generation';
import { blockedProviderExecution } from '../../../../helpers/runtime/provider-execution';
import { novelFindingCorroborationFixture } from '../intro-provider-fixture';

const boundary = vi.hoisted(() => ({ respond: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: fixtureGenerateResponse }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({
    provider: 'fixture',
    model: 'captured',
    execution: {},
  }),
  capturedLearningAiOptions: async () => ({ model: 'captured' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

import { generateSectionQuestions } from '@/lib/class-generation';
import { assessSectionReview, SectionQualityError } from '@/lib/classes/section-quality';
import {
  reviewTeachingContent,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import {
  parseTeachingAdjudicatorResponse,
  parseTeachingAdjudicator,
  parseTeachingCriticResponse,
  ReviewerProtocolError,
} from '@/lib/classes/quality/teaching-review-protocol';
import { buildTeachingSourceParts } from '@/lib/classes/quality/teaching-source/protocol';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';
import { captureTeachingFailure } from '@/lib/classes/quality/teaching-failure';

async function fixtureGenerateResponse(...args: Parameters<AIProvider['generateResponse']>) {
  const [, messages, options] = args;
  return (
    novelFindingCorroborationFixture(messages as Array<{ content: string }>, options) ??
    boundary.respond(...args)
  );
}

const passage =
  'Am Samstag hat Lea ihre Freundin besucht. Gestern sind die beiden nach Bonn gefahren.';
const questions = (count = 5): GeneratedQuestion[] =>
  Array.from({ length: count }, (_, index) => ({
    question: `Wohin sind die beiden gefahren? ${index + 1}`,
    options: ['Nach Bonn', 'Nach Berlin', 'Nach Hamburg', 'Nach Köln'],
    correctIndex: 0,
    explanation: 'Im Text steht Bonn.',
    passageText: passage,
  }));
const blind = (items: GeneratedQuestion[], hard = false) =>
  JSON.stringify({
    passageFindings: [
      { sourcePartIndex: 0, issue: 'incorrect', reason: 'Samstag und gestern widersprechen sich.' },
    ],
    issues: [],
    questions: items.map((_, index) => ({
      index,
      acceptableOptionIndices: hard && index === 0 ? [0, 1] : [0],
      issues: [],
    })),
  });
const response = (value: unknown) => ({
  content: JSON.stringify(value),
  model: 'captured',
  inputTokens: 1,
  outputTokens: 1,
});
const base = {
  userId: 'reader',
  execution: blockedProviderExecution('reader'),
  skill: 'READING' as const,
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  objective: 'Describe past events.',
  grammarPoints: ['Perfekt'],
  targetVocab: [],
  seed: 'reading-fixture',
};

type AuditInput = {
  items: Array<{
    index: number;
    content: Record<string, unknown>;
    sourceParts: Array<{ index: number; fieldPath: string[]; quote: string }>;
  }>;
  readingPassageReview?: { passageFeedback: unknown[] };
};
function supportFixture(item: AuditInput['items'][number]) {
  const part = (field: string) =>
    item.sourceParts.find(({ fieldPath }) => fieldPath[0] === field)!.index;
  return {
    options: [0, 1, 2, 3].map((optionIndex) => ({
      optionIndex,
      status: optionIndex === item.content.correctIndex ? 'supported' : 'unstated',
      passagePartIndices: optionIndex === item.content.correctIndex ? [part('passageText')] : [],
    })),
    constraints: ['actor', 'action', 'time_order', 'negation', 'quantity', 'scope'].map((kind) => ({
      kind,
      status: kind === 'action' ? 'satisfied' : 'not_applicable',
      questionPartIndex: kind === 'action' ? part('question') : null,
      passagePartIndices: kind === 'action' ? [part('passageText')] : [],
      reason:
        kind === 'action' ? 'The destination is Bonn.' : 'No separate constraint of this kind.',
    })),
    explanation: {
      status: 'supported',
      explanationPartIndex: part('explanation'),
      passagePartIndices: [part('passageText')],
      reason: 'The explanation identifies Bonn from the passage.',
    },
  };
}
const observed: AuditInput[] = [];
let rejectQuestion = false;
let rejectPassage = false;
let generated = 0;

beforeEach(() => {
  observed.length = 0;
  rejectQuestion = false;
  rejectPassage = false;
  generated = 0;
  boundary.respond.mockReset();
  boundary.respond.mockImplementation(
    async (system: string, messages: ChatMessage[], options: AIOptions) => {
      const schema = options.jsonSchema?.name;
      if (schema === 'class_section_questions') {
        generated += 1;
        if (generated > 2) throw new Error('Unexpected extra semantic generation');
        return response({
          passage,
          questions: questions().map((item) => ({
            question: item.question,
            options: item.options,
            correctIndex: item.correctIndex,
            explanation: item.explanation,
          })),
        });
      }
      if (schema === 'class_section_quality')
        return { ...response({}), content: blind(questions()) };
      expect(system).toContain(
        'Retain a wording criticism only when you can identify a specific grammatical or conventional collocational constraint it violates'
      );
      expect(system).toContain(
        'A smoother alternative or a literal reading contradicted by the surrounding dialogue does not establish a defect'
      );
      expect(system).toContain(
        'Comprehensibility does not excuse genuine grammatical or collocational errors'
      );
      expect(system).toContain(
        'For a supported wording criticism, use reason to identify the violated constraint or unresolved reading'
      );
      if (typeof messages[0].content !== 'string') throw new Error('Expected textual audit input');
      const input = JSON.parse(messages[0].content) as AuditInput;
      observed.push(input);
      if (schema === 'class_teaching_critic')
        return response({
          items: input.items.map((item) => ({
            index: item.index,
            answerSupport: supportFixture(item),
            findings: [],
          })),
        });
      const shouldReject = rejectPassage || rejectQuestion;
      const first = input.items[0];
      const part = first.sourceParts.find(
        (part) => part.fieldPath[0] === (rejectPassage ? 'passageText' : 'question')
      )!;
      return response({
        ...(input.readingPassageReview
          ? {
              passageConcernDecisions: [
                {
                  concernIndex: 0,
                  ...(rejectPassage
                    ? {
                        decision: 'supported',
                        itemIndex: 0,
                        findingIndex: 0,
                        reason: 'The actual passage has a defect.',
                      }
                    : {
                        decision: 'dismissed',
                        reason: 'No narration date is given; both time expressions can be true.',
                      }),
                },
              ],
            }
          : {}),
        items: input.items.map((item) => ({
          index: item.index,
          answerSupport: supportFixture(item),
          criticDecisions: [],
          newFindings:
            shouldReject && item.index === 0
              ? [
                  {
                    sourcePartIndex: part.index,
                    issue: 'incorrect',
                    rule: 'The answer must follow from the precise event sequence.',
                    defect:
                      'The question says during the wait but the passage says after the wait.',
                    remedy: { kind: 'correction', text: 'Ask what happened after the wait.' },
                  },
                ]
              : [],
        })),
      });
    }
  );
});

describe('reading passage adjudication', () => {
  it.each([undefined, 'LISTENING', 'READING '])(
    'rejects unsupported explanation skill %s before provider dispatch',
    async (sectionSkill) => {
      await expect(
        reviewTeachingContent({
          ai: { provider: 'fixture', model: 'captured', execution: base.execution },
          provider: { generateResponse: fixtureGenerateResponse } as unknown as AIProvider,
          userId: 'reader',
          level: 'A2',
          nativeLang: 'en',
          targetLang: 'de',
          kind: 'explanations',
          sectionSkill: sectionSkill as 'READING',
          items: questions(),
        })
      ).rejects.toBeInstanceOf(ReviewerProtocolError);
      expect(observed).toEqual([]);
    }
  );

  it('retains all six ordinary findings plus the independent negative answer-support summary', () => {
    const fields = [questions()[0]];
    const sourceParts = buildTeachingSourceParts(fields[0]);
    const support = supportFixture({ index: 0, content: { ...fields[0] }, sourceParts });
    const finding = {
      sourcePartIndex: sourceParts.find(({ fieldPath }) => fieldPath[0] === 'question')!.index,
      issue: 'incorrect',
      rule: 'Answer the actual question.',
      defect: 'The question changes the requested action.',
      remedy: { kind: 'correction', text: 'Use the passage-supported action.' },
    };
    const critic = parseTeachingCriticResponse(
      JSON.stringify({
        items: [{ index: 0, answerSupport: support, findings: [finding, finding, finding] }],
      }),
      fields,
      true
    );
    support.explanation.status = 'contradicted';
    const judge = parseTeachingAdjudicatorResponse(
      JSON.stringify({
        items: [
          {
            index: 0,
            answerSupport: support,
            criticDecisions: [0, 1, 2].map((findingIndex) => ({
              findingIndex,
              decision: 'supported',
              reason: 'The defect remains.',
            })),
            newFindings: [finding, finding, finding],
          },
        ],
      }),
      fields,
      critic,
      0,
      true
    );
    expect(judge.items[0].acceptable).toBe(false);
    expect(judge.items[0].findings).toHaveLength(6);
    expect(judge.items[0].feedback).toHaveLength(7);
    expect(judge.items[0].answerSupport).toEqual(support);
    const fiveItems = Array.from({ length: 5 }, () => ({
      ...fields[0],
      passageText: passage.repeat(40),
    }));
    const fiveCritic = { items: fiveItems.map((_, index) => ({ ...critic.items[0], index })) };
    const fiveJudge = { items: fiveItems.map((_, index) => ({ ...judge.items[0], index })) };
    expect(parseTeachingAdjudicator(JSON.stringify(fiveJudge), fiveItems, fiveCritic)).toEqual(
      fiveJudge
    );
    const packet = [
      {
        items: fiveItems,
        reviewPackets: [{ offset: 0, critic: fiveCritic, adjudicator: fiveJudge }],
      },
    ];
    expect(Buffer.byteLength(JSON.stringify(packet))).toBeGreaterThan(32 * 1024);
    const captured = captureTeachingFailure('explanations', packet, {
      items: fiveJudge.items.map(({ index, acceptable, issues, feedback }) => ({
        index,
        acceptable,
        issues,
        feedback,
      })),
    });
    expect(captured.reviews[0]).toMatchObject({ candidate: null, omitted: 'size_limit' });
    expect(captured.reviews[0].verdict.items.map((item) => item.feedback)).toEqual(
      fiveJudge.items.map((item) => item.feedback)
    );
  });

  it.each(['option', 'constraint', 'explanation'])(
    'rejects a negative adjudicator %s witness with empty findings and no prior passage concern',
    async (negative) => {
      const fallback = boundary.respond.getMockImplementation()!;
      boundary.respond.mockImplementation(
        async (system: string, messages: ChatMessage[], options: AIOptions) => {
          const result = await fallback(system, messages, options);
          if (options.jsonSchema?.name !== 'class_teaching_adjudicator') return result;
          const input = JSON.parse(messages[0].content as string);
          expect(input.criticisms.items).toEqual(
            questions().map((_, index) => ({ index, findings: [] }))
          );
          const output = JSON.parse(result.content);
          const witness = output.items[0].answerSupport;
          if (negative === 'option')
            witness.options[0] = { optionIndex: 0, status: 'unstated', passagePartIndices: [] };
          if (negative === 'constraint')
            witness.constraints.find((row: { kind: string }) => row.kind === 'action').status =
              'violated';
          if (negative === 'explanation') witness.explanation.status = 'contradicted';
          return response(output);
        }
      );
      const failure = await reviewTeachingContent({
        ai: { provider: 'fixture', model: 'captured', execution: base.execution },
        provider: { generateResponse: fixtureGenerateResponse } as unknown as AIProvider,
        userId: 'reader',
        level: 'A2',
        nativeLang: 'en',
        targetLang: 'de',
        kind: 'explanations',
        sectionSkill: 'READING',
        items: questions(),
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
      if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
      expect(failure.feedback[0].index).toBe(0);
      const retained = JSON.parse(failure.teachingFailure!.reviews[0].candidate!)[0];
      expect(retained.reviewPackets[0].adjudicator.items[0]).toMatchObject({
        acceptable: false,
        findings: [],
        issues: ['unsupported'],
      });
      expect(retained.reviewPackets[0].adjudicator.items[0].answerSupport).toBeDefined();
      expect(
        parseTeachingAdjudicator(
          JSON.stringify(retained.reviewPackets[0].adjudicator),
          questions(),
          retained.reviewPackets[0].critic
        )
      ).toEqual(retained.reviewPackets[0].adjudicator);
      expect(retained.reviewPackets[0].critic.items[0].answerSupport.options[0].status).toBe(
        'supported'
      );
      expect(observed.every((input) => !input.readingPassageReview)).toBe(true);
    }
  );

  it.each(['class_teaching_critic', 'class_teaching_adjudicator'])(
    'withholds prior blind answers from both reviewers and a corrected %s response',
    async (malformedRole) => {
      const items = questions();
      const assessment = assessSectionReview(blind(items), items, false, 'reading');
      const feedback = assessment.readingPassageReview!;
      const expected = {
        passageFeedback: feedback.passageFeedback.map(({ quote, reason }, concernIndex) => ({
          concernIndex,
          quote,
          reason,
        })),
      };
      const fallback = boundary.respond.getMockImplementation()!;
      const roles = new Set<string>();
      let corrected = false;
      let invalidReturned = false;
      rejectQuestion = true;
      boundary.respond.mockImplementation(
        (system: string, messages: ChatMessage[], options: AIOptions) => {
          const input = JSON.parse(messages[0].content as string);
          expect(input.readingPassageReview).toEqual(expected);
          expect(JSON.stringify(input)).not.toContain('acceptableOptionIndices');
          expect(JSON.stringify(input)).not.toContain('passageAcceptable');
          if (options.jsonSchema?.name === 'class_teaching_adjudicator')
            expect(input.criticisms.items).toEqual(
              items.map((_, index) => ({ index, findings: [] }))
            );
          roles.add(options.jsonSchema!.name);
          if (input.priorProtocolOutput) {
            corrected = true;
            const prior = JSON.parse(input.priorProtocolOutput.payload.json);
            expect(prior.candidate.readingPassageReview).toEqual(expected);
            if (prior.candidate.criticisms)
              expect(prior.candidate.criticisms.items).toEqual(
                items.map((_, index) => ({ index, findings: [] }))
              );
          }
          if (options.jsonSchema?.name === malformedRole && !invalidReturned) {
            invalidReturned = true;
            return Promise.resolve(response({ items: [] }));
          }
          return fallback(system, messages, options);
        }
      );
      const failure = await reviewTeachingContent({
        ai: { provider: 'fixture', model: 'captured', execution: base.execution },
        provider: { generateResponse: fixtureGenerateResponse } as unknown as AIProvider,
        userId: 'reader',
        level: 'A2',
        nativeLang: 'en',
        targetLang: 'de',
        kind: 'explanations',
        sectionSkill: 'READING',
        items,
        readingPassageReview: feedback,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
      expect(roles).toEqual(new Set(['class_teaching_critic', 'class_teaching_adjudicator']));
      expect(corrected).toBe(true);
      const retained = captureGenerationFailure(failure).teachingFailure!;
      const candidate = JSON.parse(retained.reviews[0].candidate!);
      expect(candidate[0].readingPassageReview).toEqual(feedback);
      expect(candidate[0].readingPassageReview.questions).toEqual(feedback.questions);
      expect(candidate[0].reviewPackets[0].critic.items[0].answerSupport).toBeDefined();
    }
  );

  it('publishes the unchanged passage after the paired review dismisses an unsupported chronology claim', async () => {
    const result = await generateSectionQuestions(base);
    expect(result).toHaveLength(5);
    expect(result.every((question) => question.passageText === passage)).toBe(true);
    expect(observed[0].readingPassageReview?.passageFeedback).toHaveLength(1);
    expect(observed[0].items.map((item) => item.content.question)).toEqual(
      questions().map((item) => item.question)
    );
  });

  it.each(['question', 'passage'])(
    'repairs only final adjudicated %s defects without reintroducing the earlier blind verdict',
    async (rejectedKind) => {
      rejectQuestion = rejectedKind === 'question';
      rejectPassage = rejectedKind === 'passage';
      const fallback = boundary.respond.getMockImplementation()!;
      let replacementContext: string | undefined;
      boundary.respond.mockImplementation(
        (system: string, messages: ChatMessage[], options: AIOptions) => {
          if (options.jsonSchema?.name === 'class_section_questions' && generated === 1)
            replacementContext = messages[0].content as string;
          return fallback(system, messages, options);
        }
      );
      const failure = await generateSectionQuestions(base).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
      expect(replacementContext).toContain(
        'The question says during the wait but the passage says after the wait.'
      );
      expect(replacementContext).not.toContain('Samstag und gestern widersprechen sich.');
      expect(replacementContext).not.toContain('acceptableOptionIndices');
      expect(replacementContext).not.toContain('Blind review feedback:');
      const evidence = captureGenerationFailure(failure);
      expect(JSON.stringify(evidence)).toContain('during the wait');
      expect(JSON.stringify(evidence)).toContain('passageConcernDecisions');
      expect(JSON.stringify(evidence)).toContain('readingPassageReview');
      expect(JSON.stringify(evidence)).toContain('Samstag und gestern widersprechen sich.');
    }
  );

  it('keeps ambiguous blind answers as a hard failure without accepting a passage dismissal', async () => {
    const fallback = boundary.respond.getMockImplementation()!;
    let replacementContext: string | undefined;
    boundary.respond.mockImplementation(
      (system: string, messages: ChatMessage[], options: AIOptions) => {
        if (options.jsonSchema?.name === 'class_section_questions' && generated === 1)
          replacementContext = messages[0].content as string;
        return options.jsonSchema?.name === 'class_section_quality'
          ? { ...response({}), content: blind(questions(), true) }
          : fallback(system, messages, options);
      }
    );
    const failure = await generateSectionQuestions(base).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SectionQualityError);
    expect(captureGenerationFailure(failure).teachingFailure?.reviews).toHaveLength(2);
    expect(replacementContext).toContain('Blind review feedback:');
    expect(replacementContext).toContain('acceptableOptionIndices');
    expect(observed).toEqual([]);
  });

  it('never replaces an immutable source passage when its defect is supported', async () => {
    rejectPassage = true;
    const failure = await generateSectionQuestions({ ...base, sourceContent: passage }).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    expect(generated).toBe(1);
    expect(
      observed.every((input) => input.items.every((item) => item.content.passageText === passage))
    ).toBe(true);
    expect(JSON.stringify(captureGenerationFailure(failure))).toContain('supported');
  });

  it('binds passage observations to the complete candidate and rejects a copied or changed observation', async () => {
    const items = questions();
    const assessment = assessSectionReview(blind(items), items, false, 'reading');
    const options = {
      ai: { provider: 'fixture', model: 'captured', execution: base.execution },
      provider: { generateResponse: fixtureGenerateResponse } as unknown as AIProvider,
      userId: 'reader',
      level: 'A2',
      nativeLang: 'en',
      targetLang: 'de',
      kind: 'explanations' as const,
      sectionSkill: 'READING' as const,
      items,
    };
    await expect(
      reviewTeachingContent({
        ...options,
        readingPassageReview: structuredClone(assessment.readingPassageReview),
      })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    items[0].passageText = 'Changed passage.';
    await expect(
      reviewTeachingContent({ ...options, readingPassageReview: assessment.readingPassageReview })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(observed).toEqual([]);
  });

  it('rejects an oversized blind candidate instead of distributing unbound passage concerns across batches', () => {
    const items = questions(6);
    expect(() => assessSectionReview(blind(items), items, false, 'reading')).toThrow(
      SectionQualityError
    );
    expect(observed).toEqual([]);
  });
});

describe('passage concern evidence references', () => {
  const fields = [{ passageText: passage, question: 'Wohin?' }];
  const critic = { items: [{ index: 0, findings: [] }] };
  const finding = {
    sourcePartIndex: 0,
    issue: 'incorrect',
    rule: 'Events must agree.',
    defect: 'These two claims conflict.',
    remedy: { kind: 'correction', text: 'Correct the conflicting event.' },
  };
  const supported = {
    concernIndex: 0,
    decision: 'supported',
    reason: 'The stated defect is real.',
    itemIndex: 0,
    findingIndex: 0,
  };
  const packet = (decisions: unknown[], newFindings: unknown[] = [finding]) =>
    JSON.stringify({
      passageConcernDecisions: decisions,
      items: [{ index: 0, criticDecisions: [], newFindings }],
    });

  it('requires a supported concern to identify retained passage evidence', () => {
    expect(
      parseTeachingAdjudicatorResponse(packet([supported]), fields, critic, 1).items[0].acceptable
    ).toBe(false);
    expect(() =>
      parseTeachingAdjudicatorResponse(packet([supported], []), fields, critic, 1)
    ).toThrow(ReviewerProtocolError);
    const questionPart = buildTeachingSourceParts(fields[0]).find(
      (part) => part.fieldPath[0] === 'question'
    )!;
    expect(() =>
      parseTeachingAdjudicatorResponse(
        packet([supported], [{ ...finding, sourcePartIndex: questionPart.index }]),
        fields,
        critic,
        1
      )
    ).toThrow(ReviewerProtocolError);
  });

  it('cannot support a concern by pointing at a dismissed critic finding', () => {
    const boundCritic = parseTeachingCriticResponse(
      JSON.stringify({ items: [{ index: 0, findings: [finding] }] }),
      fields
    );
    const dismissed = JSON.stringify({
      passageConcernDecisions: [supported],
      items: [
        {
          index: 0,
          criticDecisions: [
            { findingIndex: 0, decision: 'dismissed', reason: 'No actual defect.' },
          ],
          newFindings: [],
        },
      ],
    });
    expect(() => parseTeachingAdjudicatorResponse(dismissed, fields, boundCritic, 1)).toThrow(
      ReviewerProtocolError
    );
    const retained = JSON.stringify({
      passageConcernDecisions: [supported],
      items: [
        {
          index: 0,
          criticDecisions: [
            { findingIndex: 0, decision: 'supported', reason: 'Concrete contradiction.' },
          ],
          newFindings: [],
        },
      ],
    });
    expect(
      parseTeachingAdjudicatorResponse(retained, fields, boundCritic, 1).items[0].findings
    ).toEqual(boundCritic.items[0].findings);
  });

  it.each(
    [
      [],
      [supported, supported],
      [{ ...supported, concernIndex: 1 }],
      [{ ...supported, itemIndex: 1 }],
      [{ ...supported, findingIndex: 1 }],
      [{ concernIndex: 0, decision: 'dismissed', reason: ' ' }],
      [{ concernIndex: 0, decision: 'dismissed', reason: 'No defect.', itemIndex: 0 }],
    ].map((decisions) => ({ decisions }))
  )(
    'rejects missing, duplicated, unknown or malformed concern decisions $decisions',
    ({ decisions }) => {
      expect(() => parseTeachingAdjudicatorResponse(packet(decisions), fields, critic, 1)).toThrow(
        ReviewerProtocolError
      );
    }
  );
});
