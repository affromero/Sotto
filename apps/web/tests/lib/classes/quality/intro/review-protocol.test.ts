import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedProviderExecution } from '../../../../helpers/runtime/provider-execution';
import { shapeIntroProviderFixture } from '../intro-provider-fixture';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.unmock('@/lib/classes/class-intro');
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: unknown
    ) =>
      shapeIntroProviderFixture(
        system,
        messages,
        options,
        await boundary.generate(system, messages, options)
      ),
  }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: boundary.resolve,
  capturedLearningAiOptions: async (ai: { model: string; signal: AbortSignal }) => ({
    model: ai.model,
    signal: ai.signal,
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

import { generateClassIntro } from '@/lib/classes/class-intro';
import { createAIProvider } from '@/lib/providers/ai';
import {
  getIntroRepairPlan,
  ReviewerProtocolError,
  reviewTeachingContent,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';

const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  title: 'Gestern unterwegs',
  objective: 'Erzähle von vergangenen Erlebnissen.',
  grammarPoints: ['Perfekt mit haben und sein'],
  targetVocab: [],
};
const intro = {
  purpose: 'Erzähle von gestern.',
  about:
    '„Ich habe gestern meine Freundin besucht.“: Es besteht aus „haben“ oder „sein“ und einem Partizip am Satzende.',
  focus: [
    '„Ich habe gestern meine Freundin besucht.“: „Besuchen“ verwendet „haben“.',
    '„Wir sind zu Fuß zum Bahnhof gegangen.“: „Gehen“ verwendet „sein“.',
    '„Ich habe gestern meine Freundin besucht.“: In diesen Aussagesätzen steht das Hilfsverb an zweiter Stelle und das Partizip am Ende.',
  ],
  examples: [
    {
      target: 'Ich habe gestern meine Freundin besucht.',
      meaning: 'Die sprechende Person war am Tag vor heute bei ihrer Freundin.',
      note: '„Ich habe gestern meine Freundin besucht.“: „Besuchen“ verwendet „haben“.',
    },
    {
      target: 'Wir sind zu Fuß zum Bahnhof gegangen.',
      meaning: 'Die sprechende Gruppe ist gelaufen und am Bahnhof angekommen.',
      note: '„Wir sind zu Fuß zum Bahnhof gegangen.“: „Gehen“ verwendet „sein“.',
    },
  ],
  tips: [
    '„Ich habe gestern meine Freundin besucht.“: Lerne das Partizip mit dem Hilfsverb.',
    '„Ich habe gestern meine Freundin besucht.“: In Aussagesätzen mit Zeitangabe bleibt das Partizip am Ende: „Ich habe gestern viel gemacht.“',
  ],
};
type Finding = {
  issue: 'incorrect' | 'unsupported';
  fieldPath: string[];
  quote: string;
  rule: string;
  defect: string;
  correction: string | null;
  counterexample: string | null;
};
type AuditItem = {
  index: number;
  content: { address: { field: string; index?: number }; fields: Record<string, unknown> };
};
type Payload = {
  introContext: typeof intro;
  items: AuditItem[];
  criticisms?: { items: Array<{ index: number; findings: Finding[] }> };
};
const scopeCriticism: Finding = {
  issue: 'incorrect',
  fieldPath: ['tips'],
  quote:
    'In Aussagesätzen mit Zeitangabe bleibt das Partizip am Ende: „Ich habe gestern viel gemacht.“',
  rule: 'Word-order claims need explicit scope or a complete quoted example.',
  defect: 'Aussagesätzen is too general; name this sentence type explicitly.',
  correction: 'Name the sentence type Aussagesatz.',
  counterexample: null,
};
const arrivalFinding: Finding = {
  issue: 'unsupported',
  fieldPath: ['example', 'meaning'],
  quote: 'am Bahnhof angekommen',
  rule: 'Do not add an unstated result to an example meaning.',
  defect: 'The meaning adds arrival to the described journey.',
  correction: 'Die sprechende Gruppe ist zu Fuß zum Bahnhof gegangen.',
  counterexample: null,
};
const aboutFinding: Finding = {
  issue: 'incorrect',
  fieldPath: ['about'],
  quote: 'einem Partizip am Satzende',
  rule: 'A word-order claim needs applicable clause scope.',
  defect: 'This unrestricted rule does not hold in a verb-final subordinate clause.',
  correction: null,
  counterexample: '..., weil ich den Film gesehen habe.',
};
function critic(payload: Payload, findingsFor: (item: AuditItem) => Finding[] = () => []) {
  return {
    items: payload.items.map((item) => ({ index: item.index, findings: findingsFor(item) })),
  };
}
function judge(payload: Payload, findingsFor: (item: AuditItem) => Finding[] = () => []) {
  return {
    items: payload.items.map((item) => {
      const findings = findingsFor(item);
      const criticisms = payload.criticisms!.items.find(({ index }) => index === item.index)!;
      return {
        index: item.index,
        acceptable: findings.length === 0,
        issues: [...new Set(findings.map(({ issue }) => issue))],
        feedback: findings.map(({ defect }) => defect),
        findings,
        criticDecisions: criticisms.findings.map((_, findingIndex) => ({
          findingIndex,
          decision: 'dismissed',
          reason: 'The claim already names Aussagesätze and quotes a complete example.',
        })),
      };
    }),
  };
}
function response(value: unknown) {
  return { content: JSON.stringify(value), model: 'captured-model' };
}
function schemaNames() {
  return boundary.generate.mock.calls.map(
    ([, , options]) => options.jsonSchema?.name ?? 'generation'
  );
}
async function review() {
  return reviewTeachingContent({
    ...params,
    ai: await boundary.resolve(),
    provider: createAIProvider('fixture'),
    kind: 'intro',
    items: [intro],
  });
}
beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockReset().mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    signal: new AbortController().signal,
    execution: params.execution,
  });
});

describe('evidence-bound intro review', () => {
  it('dismisses the actual missing-scope criticism when the claim already supplies scope', async () => {
    boundary.generate.mockImplementation(async (_system, messages, options) => {
      const payload: Payload = JSON.parse(messages[0].content);
      return response(
        options.jsonSchema.name === 'class_intro_critic'
          ? critic(payload, (item) =>
              item.content.address.field === 'tips' && item.content.address.index === 1
                ? [scopeCriticism]
                : []
            )
          : judge(payload)
      );
    });
    await expect(review()).resolves.toBeUndefined();
    const adjudication = boundary.generate.mock.calls.find(
      ([, messages, options]) =>
        options.jsonSchema.name === 'class_intro_adjudicator' &&
        JSON.parse(messages[0].content).criticisms.items.some(
          (item: { findings: Finding[] }) => item.findings.length
        )
    );
    expect(JSON.parse(adjudication![1][0].content).criticisms.items[1].findings).toEqual([
      scopeCriticism,
    ]);
    expect(schemaNames()).toEqual([
      'class_intro_critic',
      'class_intro_adjudicator',
      'class_intro_critic',
      'class_intro_adjudicator',
    ]);
  });

  it('finds the arrival assertion even when the critic reports no defects and preserves exact repair evidence', async () => {
    boundary.generate.mockImplementation(async (_system, messages, options) => {
      const payload: Payload = JSON.parse(messages[0].content);
      return response(
        options.jsonSchema.name === 'class_intro_critic'
          ? critic(payload)
          : judge(payload, (item) =>
              item.content.address.field === 'examples' && item.content.address.index === 1
                ? [arrivalFinding]
                : []
            )
      );
    });
    const failure = await review().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
    expect(
      failure.teachingFailure!.reviews[0]!.verdict.items.filter(({ acceptable }) => !acceptable)
    ).toEqual([
      { index: 8, acceptable: false, issues: ['unsupported'], feedback: [arrivalFinding.defect] },
    ]);
    const plan = getIntroRepairPlan(failure);
    expect(plan.rejectionEvidence).toEqual([
      { address: { field: 'examples', index: 1 }, findings: [arrivalFinding] },
    ]);
    plan.rejectionEvidence[0]!.findings[0]!.quote = 'tampered returned evidence';
    expect(getIntroRepairPlan(failure).rejectionEvidence[0]!.findings[0]!.quote).toBe(
      arrivalFinding.quote
    );
    const evidence = JSON.parse(failure.teachingFailure!.reviews[0]!.candidate!)[0];
    expect(evidence.addresses).toHaveLength(9);
    expect(
      evidence.reviewPackets[1].critic.items.every(
        (item: { findings: Finding[] }) => item.findings.length === 0
      )
    ).toBe(true);
    expect(evidence.reviewPackets[1].adjudicator.items[3].findings).toEqual([arrivalFinding]);
    expect(JSON.stringify(failure)).not.toContain(arrivalFinding.quote);
    evidence.reviewPackets[1].adjudicator.items[3].findings[0].quote = 'tampered stored packet';
    failure.teachingFailure!.reviews[0]!.candidate = JSON.stringify([evidence]);
    expect(() => getIntroRepairPlan(failure)).toThrow(ReviewerProtocolError);
  });

  it.each([
    'quote absent from the field',
    'duplicate address',
    'missing address',
    'missing correction',
  ])('rejects %s before adjudication or repair', async (kind) => {
    boundary.generate.mockImplementation(async (_system, messages, options) => {
      if (options.jsonSchema?.name !== 'class_intro_critic') return response(intro);
      const payload: Payload = JSON.parse(messages[0].content);
      const packet = critic(payload);
      if (kind === 'duplicate address') packet.items[1]!.index = 0;
      else if (kind === 'missing address') packet.items.pop();
      else
        packet.items[0]!.findings.push({
          ...aboutFinding,
          fieldPath: ['purpose'],
          quote: kind === 'missing correction' ? intro.purpose : 'invented quote',
          correction: null,
          counterexample: kind === 'missing correction' ? null : aboutFinding.counterexample,
        });
      return response(packet);
    });
    await expect(generateClassIntro(params)).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(schemaNames()).toEqual([
      'class_intro_generation',
      'class_intro_critic',
      'class_intro_critic',
    ]);
  });

  it('rejects adjudicator evidence quoted from a sibling field', async () => {
    boundary.generate.mockImplementation(async (_system, messages, options) => {
      const payload: Payload = JSON.parse(messages[0].content);
      return response(
        options.jsonSchema.name === 'class_intro_critic'
          ? critic(payload)
          : judge(payload, (item) =>
              item.content.address.field === 'purpose'
                ? [{ ...aboutFinding, fieldPath: ['purpose'] }]
                : []
            )
      );
    });
    await expect(review()).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(schemaNames()).toEqual([
      'class_intro_critic',
      'class_intro_adjudicator',
      'class_intro_adjudicator',
    ]);
  });

  it.each(['missing decision', 'accepted supported criticism', 'different supported quote'])(
    'rejects an adjudicator packet with %s',
    async (kind) => {
      boundary.generate.mockImplementation(async (_system, messages, options) => {
        const payload: Payload = JSON.parse(messages[0].content);
        if (options.jsonSchema.name === 'class_intro_critic')
          return response(
            critic(payload, (item) =>
              item.content.address.field === 'about' ? [aboutFinding] : []
            )
          );
        const packet = judge(payload);
        const row = packet.items[1]!;
        if (kind === 'missing decision') row.criticDecisions = [];
        else {
          row.criticDecisions[0]!.decision = 'supported';
          if (kind === 'different supported quote') {
            row.acceptable = false;
            row.issues = ['incorrect'];
            row.feedback = [aboutFinding.defect];
            row.findings = [{ ...aboutFinding, quote: 'das Perfekt' }];
          }
        }
        return response(packet);
      });
      await expect(review()).rejects.toBeInstanceOf(ReviewerProtocolError);
      expect(schemaNames()).toEqual([
        'class_intro_critic',
        'class_intro_adjudicator',
        'class_intro_adjudicator',
      ]);
    }
  );

  it('audits every final address and catches a defect in an unchanged previously approved field', async () => {
    const candidate = {
      ...intro,
      examples: [
        {
          ...intro.examples[0]!,
          note: '„Ich habe gestern meine Freundin besucht.“: „Habe“ steht an dritter Stelle, „besucht“ am Satzende.',
        },
        intro.examples[1]!,
      ],
    };
    const noteFinding: Finding = {
      issue: 'incorrect',
      fieldPath: ['example', 'note'],
      quote: 'an dritter Stelle',
      rule: 'Count grammatical constituents in the exact example.',
      defect: 'Ich is the first constituent and habe is second, not third.',
      correction: '„Habe“ steht an zweiter Stelle, „besucht“ am Satzende.',
      counterexample: null,
    };
    const repaired = { ...intro.examples[1]!, meaning: arrivalFinding.correction! };
    let repairedPhase = false;
    boundary.generate.mockImplementation(async (_system, messages, options) => {
      const schema = options.jsonSchema?.name;
      if (schema === 'class_intro_generation') return response(candidate);
      if (schema === 'class_intro_repair') {
        expect(messages[0].content).toContain(arrivalFinding.quote);
        repairedPhase = true;
        return response({ examples: { 1: repaired } });
      }
      const payload: Payload = JSON.parse(messages[0].content);
      return response(
        schema === 'class_intro_critic'
          ? critic(payload)
          : judge(payload, (item) => {
              if (repairedPhase)
                return item.content.address.field === 'examples' && item.content.address.index === 0
                  ? [noteFinding]
                  : [];
              return item.content.address.field === 'examples' && item.content.address.index === 1
                ? [arrivalFinding]
                : [];
            })
      );
    });
    const failure = await generateClassIntro(params).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
    const candidates = failure.teachingFailure!.reviews.map(
      ({ candidate }) => JSON.parse(candidate!)[0]
    );
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) expect(candidate.addresses).toHaveLength(9);
    expect(candidates[1].introContext.about).toBe(
      `„${intro.examples[0]!.target}“: ${intro.examples[0]!.meaning}`
    );
    expect(candidates[1].introContext.examples[0]).toEqual(candidate.examples[0]);
    expect(candidates[1].introContext.examples[1]).toEqual(repaired);
    expect(
      failure.teachingFailure!.reviews[1]!.verdict.items.filter(({ acceptable }) => !acceptable)
    ).toEqual([
      { index: 7, acceptable: false, issues: ['incorrect'], feedback: [noteFinding.defect] },
    ]);
    expect(schemaNames()).toEqual([
      'class_intro_generation',
      'class_intro_critic',
      'class_intro_adjudicator',
      'class_intro_critic',
      'class_intro_adjudicator',
      'class_intro_repair',
      'class_intro_critic',
      'class_intro_adjudicator',
      'class_intro_critic',
      'class_intro_adjudicator',
    ]);
  });

  it('corrects final reviewer output without replaying consumed intro authority or skipping accepted fields', async () => {
    let finalPhase = false;
    let malformed = false;
    const finalAddresses: Array<{ field: string; index?: number }> = [];
    const repaired = {
      ...intro,
      examples: intro.examples.map((example, index) =>
        index === 1 ? { ...example, meaning: arrivalFinding.correction! } : example
      ),
    };
    boundary.generate.mockImplementation(async (_system, messages, options) => {
      const payload: Payload = JSON.parse(messages[0].content);
      if (finalPhase && options.jsonSchema.name === 'class_intro_critic' && !malformed) {
        malformed = true;
        return { content: '{', model: 'captured-model' };
      }
      if (options.jsonSchema.name === 'class_intro_critic') return response(critic(payload));
      if (finalPhase) finalAddresses.push(...payload.items.map(({ content }) => content.address));
      return response(
        judge(payload, (item) =>
          !finalPhase &&
          item.content.address.field === 'examples' &&
          item.content.address.index === 1
            ? [arrivalFinding]
            : []
        )
      );
    });
    const ai = await boundary.resolve();
    const provider = createAIProvider('fixture');
    const options = { ...params, ai, provider, kind: 'intro' as const };
    const first = await reviewTeachingContent({ ...options, items: [intro] }).catch(
      (error: unknown) => error
    );
    if (!(first instanceof TeachingQualityRejectionError)) throw first;
    expect(getIntroRepairPlan(first).rejectedAddresses).toEqual([{ field: 'examples', index: 1 }]);
    finalPhase = true;
    await expect(
      reviewTeachingContent({ ...options, items: [repaired], previousIntroRejection: first })
    ).resolves.toBeUndefined();
    expect(finalAddresses).toHaveLength(9);
    const finalCalls = boundary.generate.mock.calls.slice(4);
    expect(finalCalls.map(([, , options]) => options.jsonSchema.name)).toEqual([
      'class_intro_critic',
      'class_intro_critic',
      'class_intro_adjudicator',
      'class_intro_critic',
      'class_intro_adjudicator',
    ]);
    expect(JSON.parse(finalCalls[0][1][0].content).introContext.about).toBe(intro.about);
    expect(JSON.parse(finalCalls[1][1][0].content).items).toEqual(
      JSON.parse(finalCalls[0][1][0].content).items
    );
    const callsBeforeReplay = boundary.generate.mock.calls.length;
    await expect(
      reviewTeachingContent({ ...options, items: [repaired], previousIntroRejection: first })
    ).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(boundary.generate.mock.calls).toHaveLength(callsBeforeReplay);
  });
});
