import { describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { z } from 'zod';
import type { AIOptions, AIProvider, ChatMessage } from '@/lib/providers/ai';
import { blockedProviderExecution } from '../../../../helpers/runtime/provider-execution';
import {
  parseListeningNarrativeExtractionResponse,
  parseListeningNarrativeWitnessResponse,
  parseListeningNarrativeWitness,
  listeningNarrativeExtractionResponseSchema,
  listeningNarrativeWitnessResponseSchema,
  listeningNarrativeFailure,
  listeningNarrativeRepairFindings,
  listeningNarrativeRepairTurnIndices,
} from '@/lib/classes/quality/listening-audit/narrative-witness';
import { buildListeningSourceUnits } from '@/lib/classes/quality/listening-audit/passage-witness';
import {
  buildTeachingCriticJsonSchema,
  buildTeachingAdjudicatorJsonSchema,
} from '@/lib/classes/quality/teaching-source/protocol';
import { parseTeachingCriticResponse } from '@/lib/classes/quality/teaching-review-protocol';
import {
  listeningExtractionFixture,
  normalizedListeningExtractionFixture,
  listeningWitnessFixture,
  listeningNarrativeExtractionFixture,
  listeningNarrativeWitnessFixture,
} from '../witness-fixture';
import { normalizeListeningTurns } from '@/lib/classes/quality/listening-audit/projection';
import {
  reviewTeachingContent,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import { listeningRepairPlan } from '@/lib/classes/quality/listening-repair';
import {
  applyTeachingScriptRepair,
  teachingScriptRepairContract,
} from '@/lib/learning/script/teaching-repair';

vi.mock('@/lib/learning-ai', () => ({
  capturedLearningAiOptions: async () => ({ model: 'captured' }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

type Status =
  | 'consistent'
  | 'explicit_change'
  | 'different_group'
  | 'not_a_reference'
  | 'contradicted'
  | 'uncertain';

function fixture(
  earlier = 'Wir hatten keinen Schirm dabei.',
  current = 'Ich hatte einen Schirm.',
  status: Status = 'contradicted',
  proposed = true
) {
  const turns = normalizeListeningTurns([
    { speaker: 'HOST', text: earlier },
    { speaker: 'EXPERT', text: 'Es hat auf unserem Ausflug geregnet.' },
    { speaker: 'HOST', text: current },
    { speaker: 'EXPERT', text: 'Danach sind wir zum Bahnhof gegangen.' },
  ]);
  const fields = { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') };
  const passage = normalizedListeningExtractionFixture(turns);
  const table = buildListeningSourceUnits(fields, turns, 'de');
  const link = {
    earlierUnitIndex: table.units.find((unit) => unit.turnIndex === 1)!.unitIndex,
    currentUnitIndex: table.units.find((unit) => unit.turnIndex === 3)!.unitIndex,
  };
  const extractionWire = listeningNarrativeExtractionFixture(turns);
  const criticWire = extractionWire;
  criticWire.turns['3'].links = proposed ? [link] : [];
  const extraction = parseListeningNarrativeExtractionResponse(criticWire, fields, turns, passage);
  const negative = status === 'contradicted' || status === 'uncertain';
  const assessment = {
    status,
    reason: negative
      ? 'The same trip has incompatible or unresolved participant facts.'
      : 'The explicit source context distinguishes the participants or state.',
    remedy: negative
      ? { kind: 'correction' as const, text: 'Clarify who had the umbrella and when.' }
      : null,
  };
  const judgeWire = listeningNarrativeWitnessFixture(turns);
  judgeWire.turns['3'] = {
    reason: assessment.reason,
    linkDecisions: proposed ? { '0': assessment } : {},
    additionalLinks: proposed ? [] : [{ ...link, ...assessment }],
  };
  const parse = (wire: unknown = judgeWire) =>
    parseListeningNarrativeWitnessResponse(wire, fields, turns, extraction);
  return { turns, fields, passage, table, link, criticWire, extraction, judgeWire, parse };
}

function nativeValidators(source: ReturnType<typeof fixture>) {
  const ajv = new Ajv();
  return {
    critic: ajv.compile(
      z.toJSONSchema(
        listeningNarrativeExtractionResponseSchema(source.fields, source.turns, source.passage),
        { target: 'draft-7' }
      )
    ),
    judge: ajv.compile(
      z.toJSONSchema(
        listeningNarrativeWitnessResponseSchema(source.fields, source.turns, source.extraction),
        { target: 'draft-7' }
      )
    ),
  };
}

function expectStrictProviderObjects(schema: unknown) {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    schema.forEach(expectStrictProviderObjects);
    return;
  }
  const node = schema as Record<string, unknown>;
  if (node.type === 'object') {
    expect(node.additionalProperties).toBe(false);
    expect(node.required).toEqual(Object.keys((node.properties ?? {}) as object));
  }
  Object.values(node).forEach(expectStrictProviderObjects);
}

describe('source-bound narrative continuity evidence', () => {
  it.each([true, false])(
    'supplies the strict provider object contract with proposed links %s',
    (proposed) => {
      const source = fixture(undefined, undefined, 'contradicted', proposed);
      const schemas = [
        listeningNarrativeExtractionResponseSchema(source.fields, source.turns, source.passage),
        listeningNarrativeWitnessResponseSchema(source.fields, source.turns, source.extraction),
      ];
      for (const schema of schemas)
        expectStrictProviderObjects(z.toJSONSchema(schema, { target: 'draft-7' }));
    }
  );

  it.each([
    ['consistent', 'consistent'],
    ['explicit_change', 'consistent'],
    ['different_group', 'consistent'],
    ['not_a_reference', 'independent'],
    ['contradicted', 'contradicted'],
    ['uncertain', 'uncertain'],
  ] as const)('derives retained continuity from the %s assessment', (status, continuity) => {
    const source = fixture(undefined, undefined, status);
    const validate = nativeValidators(source);
    expect(validate.judge(source.judgeWire)).toBe(true);
    expect(source.parse().turns[0].continuity).toBe('independent');
    expect(source.parse().turns[2].continuity).toBe(continuity);
    const authored = structuredClone(source.judgeWire);
    Object.assign(authored.turns['3'], { continuity });
    expect(validate.judge(authored)).toBe(false);
    expect(() => source.parse(authored)).toThrow();
  });

  it.each([
    ['consistent', 'uncertain', 'uncertain'],
    ['uncertain', 'contradicted', 'contradicted'],
    ['contradicted', 'consistent', 'contradicted'],
  ] as const)(
    'preserves negative continuity when %s and %s links share a turn',
    (originalStatus, additionalStatus, continuity) => {
      const source = fixture(undefined, undefined, originalStatus);
      source.judgeWire.turns['3'].additionalLinks = [
        {
          earlierUnitIndex: 1,
          currentUnitIndex: source.link.currentUnitIndex,
          status: additionalStatus,
          reason: 'Synthetic independent assessment of the other bound source unit.',
          remedy:
            additionalStatus === 'consistent'
              ? null
              : { kind: 'correction', text: 'Clarify the shared event.' },
        },
      ];
      const witness = source.parse();
      expect(witness.turns[2].continuity).toBe(continuity);
      expect(listeningNarrativeFailure(witness)?.issue).toBe(
        continuity === 'contradicted' ? 'incorrect' : 'uncertain'
      );
    }
  );

  it('keeps complete reviewer schemas within the provider limit for a large passage', () => {
    const turns = normalizeListeningTurns(
      Array.from(Array(27).keys(), (index) => ({
        speaker: index % 2 ? 'EXPERT' : 'HOST',
        text:
          'Ich habe gekocht. Es war kalt. Lena war dabei. Wir waren im Park.' +
          (index === 0 ? ' Es hat geregnet. Wir hatten Hunger. Der Bus kam spät.' : ''),
      }))
    );
    const fields = [
      { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') },
    ];
    expect(buildListeningSourceUnits(fields[0], turns, 'de').units).toHaveLength(111);
    const critic = parseTeachingCriticResponse(
      JSON.stringify({
        items: [
          {
            index: 0,
            findings: [],
            passageWitness: listeningExtractionFixture(turns),
            narrativeWitness: listeningNarrativeExtractionFixture(turns),
          },
        ],
      }),
      fields,
      false,
      turns,
      undefined,
      'de'
    );
    const schemas = [
      buildTeachingCriticJsonSchema(fields, false, false, turns, undefined, 'de'),
      buildTeachingAdjudicatorJsonSchema(fields, critic, false, 0, false, turns, undefined, 'de'),
    ];
    for (const schema of schemas) {
      expectStrictProviderObjects(schema.schema);
      expect(Buffer.byteLength(JSON.stringify(schema.schema))).toBeLessThan(1024 * 1024);
      expect(() => new Ajv().compile(schema.schema)).not.toThrow();
    }
  });

  it.each(['self', 'backward', 'wrong turn', 'foreign'] as const)(
    'rejects %s operands in emitted critic and judge JSON schemas',
    (change) => {
      const source = fixture();
      const validate = nativeValidators(source);
      expect(validate.critic(source.criticWire)).toBe(true);
      expect(validate.judge(source.judgeWire)).toBe(true);
      const invalid =
        change === 'self'
          ? { earlierUnitIndex: 2, currentUnitIndex: 2 }
          : change === 'backward'
            ? { earlierUnitIndex: 3, currentUnitIndex: 2 }
            : change === 'wrong turn'
              ? { earlierUnitIndex: 0, currentUnitIndex: 1 }
              : { earlierUnitIndex: 0, currentUnitIndex: 999 };
      const critic = structuredClone(source.criticWire);
      critic.turns['3'].links = [invalid];
      const judge = structuredClone(source.judgeWire);
      judge.turns['3'].additionalLinks = [
        { ...invalid, status: 'consistent', reason: 'Synthetic assessment.', remedy: null },
      ];
      expect(validate.critic(critic)).toBe(false);
      expect(validate.judge(judge)).toBe(false);
    }
  );

  it('requires exact turn and local decision keys in emitted JSON schemas', () => {
    const source = fixture();
    const validate = nativeValidators(source);
    const critic = structuredClone(source.criticWire);
    delete critic.turns['1'];
    expect(validate.critic(critic)).toBe(false);
    critic.turns['1'] = { links: [] };
    critic.turns['99'] = { links: [] };
    expect(validate.critic(critic)).toBe(false);
    const judge = structuredClone(source.judgeWire);
    delete judge.turns['1'];
    expect(validate.judge(judge)).toBe(false);
    judge.turns['1'] = structuredClone(source.judgeWire.turns['1']);
    delete judge.turns['3'].linkDecisions['0'];
    expect(validate.judge(judge)).toBe(false);
    judge.turns['3'].linkDecisions = { '1': source.judgeWire.turns['3'].linkDecisions['0'] };
    expect(validate.judge(judge)).toBe(false);
  });

  it('limits additional judge links to the remaining per-turn capacity in the native schema', () => {
    const source = fixture();
    const validate = nativeValidators(source);
    const judge = structuredClone(source.judgeWire);
    judge.turns['3'].additionalLinks = Array.from({ length: 6 }, () => ({
      ...source.link,
      status: 'consistent',
      reason: 'Synthetic assessment.',
      remedy: null,
    }));
    expect(validate.judge(judge)).toBe(false);
  });

  it('compiles reordered wire keys into canonical turn and decision addresses', () => {
    const source = fixture();
    const extraction = parseListeningNarrativeExtractionResponse(
      { turns: Object.fromEntries(Object.entries(source.criticWire.turns).reverse()) },
      source.fields,
      source.turns,
      source.passage
    );
    const witness = parseListeningNarrativeWitnessResponse(
      { turns: Object.fromEntries(Object.entries(source.judgeWire.turns).reverse()) },
      source.fields,
      source.turns,
      extraction
    );
    expect(witness.turns.map((row) => row.turnIndex)).toEqual([1, 2, 3, 4]);
    expect(witness.turns[2].linkDecisions[0]).toMatchObject({
      linkIndex: 0,
      earlierUnitIndex: source.link.earlierUnitIndex,
      currentUnitIndex: source.link.currentUnitIndex,
    });
  });

  it('requires coverage for an empty normalized turn without inventing a source unit', () => {
    const turns = normalizeListeningTurns([
      { speaker: 'HOST', text: 'Wir waren im Museum.' },
      { speaker: 'EXPERT', text: '' },
      { speaker: 'HOST', text: 'Danach sind wir nach Hause gegangen.' },
    ]);
    const fields = { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') };
    const passage = normalizedListeningExtractionFixture(turns);
    const extraction = parseListeningNarrativeExtractionResponse(
      listeningNarrativeExtractionFixture(turns),
      fields,
      turns,
      passage
    );
    const wire = listeningNarrativeWitnessFixture(turns);
    const witness = parseListeningNarrativeWitnessResponse(wire, fields, turns, extraction);
    expect(witness.turns.map((turn) => turn.turnIndex)).toEqual([1, 2, 3]);
    expect(witness.units.some((unit) => unit.turnIndex === 2)).toBe(false);
    expect(listeningNarrativeFailure(witness)).toBeUndefined();
    expect(() =>
      parseListeningNarrativeWitnessResponse(
        { turns: { '1': wire.turns['1'], '3': wire.turns['3'] } },
        fields,
        turns,
        extraction
      )
    ).toThrow();
  });

  it.each([true, false])(
    'retains an independently declared umbrella contradiction with proposed links %s',
    (proposed) => {
      const source = fixture(undefined, undefined, 'contradicted', proposed);
      const witness = source.parse();
      expect(listeningNarrativeFailure(witness)).toMatchObject({ issue: 'incorrect' });
      expect(listeningNarrativeRepairTurnIndices(witness, source.fields, source.turns)).toEqual([
        1, 3,
      ]);
      const findings = listeningNarrativeRepairFindings(witness, source.fields, source.turns);
      expect(findings).toEqual([
        expect.objectContaining({
          issue: 'incorrect',
          fieldPath: ['passageText'],
          correction: 'Clarify who had the umbrella and when.',
        }),
      ]);
      expect(findings[0].quote).toContain(source.turns[2].text);
    }
  );

  it('retains a declared unresolved group reference rather than inventing a cast identity', () => {
    const source = fixture(
      'Lena und ich waren zusammen im Museum.',
      'Ich war auch mit Lena dort. Wir waren zu zweit.',
      'uncertain'
    );
    const witness = source.parse();
    expect(listeningNarrativeFailure(witness)).toMatchObject({ issue: 'uncertain' });
    expect(listeningNarrativeRepairTurnIndices(witness, source.fields, source.turns)).toEqual([
      1, 3,
    ]);
  });

  it('retains a declared conflict between an unrealized intention and a completed event', () => {
    const source = fixture(
      'Ich wollte Lena besuchen, habe es aber nicht geschafft.',
      'Mein Besuch bei Lena war schön.',
      'contradicted'
    );
    expect(listeningNarrativeFailure(source.parse())).toMatchObject({ issue: 'incorrect' });
  });

  it.each([
    [
      'different time',
      'Gestern hatte ich keinen Schirm.',
      'Heute hatte ich einen Schirm.',
      'explicit_change',
    ],
    [
      'different group',
      'Lena und Max hatten keinen Schirm.',
      'Ich hatte einen Schirm.',
      'different_group',
    ],
    [
      'acquired object',
      'Ich hatte keinen Schirm.',
      'Danach habe ich einen Schirm gekauft.',
      'explicit_change',
    ],
    [
      'self correction',
      'Ich hatte keinen Schirm.',
      'Das war falsch: Ich hatte einen Schirm.',
      'explicit_change',
    ],
    [
      'unchanged fact',
      'Ich hatte einen Schirm.',
      'Mein Schirm war in meiner Tasche.',
      'consistent',
    ],
  ] as const)('retains the declared valid %s distinction', (_name, earlier, current, status) => {
    const source = fixture(earlier, current, status);
    expect(listeningNarrativeFailure(source.parse())).toBeUndefined();
    expect(
      listeningNarrativeRepairTurnIndices(source.parse(), source.fields, source.turns)
    ).toEqual([]);
  });

  it.each(['missing', 'foreign', 'legacy array', 'authored turn index'] as const)(
    'rejects %s critic and judge turn coverage',
    (change) => {
      const source = fixture();
      const mutate = <T>(turns: Record<string, T>) => {
        const copy = structuredClone(turns);
        if (change === 'missing') delete copy['1'];
        if (change === 'foreign') copy['99'] = copy['1'];
        if (change === 'legacy array') return Object.values(copy);
        if (change === 'authored turn index') copy['1'] = { ...copy['1'], turnIndex: 99 };
        return copy;
      };
      expect(() =>
        parseListeningNarrativeExtractionResponse(
          { turns: mutate(source.criticWire.turns) },
          source.fields,
          source.turns,
          source.passage
        )
      ).toThrow();
      expect(() => source.parse({ turns: mutate(source.judgeWire.turns) })).toThrow();
    }
  );

  it.each([
    { earlierUnitIndex: 999, currentUnitIndex: 2 },
    { earlierUnitIndex: 2, currentUnitIndex: 0 },
    { earlierUnitIndex: 0, currentUnitIndex: 1 },
  ])('rejects unbound or wrongly scoped source links %j', (link) => {
    const source = fixture();
    const wire = structuredClone(source.criticWire);
    wire.turns['3'].links = [link];
    expect(() =>
      parseListeningNarrativeExtractionResponse(wire, source.fields, source.turns, source.passage)
    ).toThrow();
  });

  it.each(['missing', 'foreign', 'authored link index', 'remedy', 'continuity'] as const)(
    'rejects incomplete or contradictory judge evidence (%s)',
    (change) => {
      const source = fixture();
      const wire = structuredClone(source.judgeWire);
      const row = wire.turns['3'];
      if (change === 'missing') row.linkDecisions = {};
      if (change === 'foreign') row.linkDecisions['99'] = row.linkDecisions['0'];
      if (change === 'authored link index')
        Object.assign(row.linkDecisions['0'], { linkIndex: 99 });
      if (change === 'remedy') row.linkDecisions['0'].remedy = null;
      if (change === 'continuity') Object.assign(row, { continuity: 'consistent' });
      expect(() => source.parse(wire)).toThrow();
    }
  );

  it('rejects retained evidence rebound to changed source text', () => {
    const source = fixture();
    const witness = source.parse();
    const turns = source.turns.map((turn) =>
      turn.turnIndex === 3 ? { ...turn, text: 'Ich habe danach einen Schirm gekauft.' } : turn
    );
    const fields = { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') };
    expect(() => parseListeningNarrativeWitness(witness, fields, turns)).toThrow();
  });

  it.each(['earlierTurnIndex', 'currentUnitIndex', 'sourcePartIndices', 'continuity'] as const)(
    'rejects tampered compiled narrative addresses (%s)',
    (field) => {
      const source = fixture();
      const witness = structuredClone(source.parse());
      const link = witness.turns[2].linkDecisions[0];
      if (field === 'earlierTurnIndex') link.earlierTurnIndex = 2;
      if (field === 'currentUnitIndex') link.currentUnitIndex = 3;
      if (field === 'sourcePartIndices') link.sourcePartIndices = [999];
      if (field === 'continuity') witness.turns[2].continuity = 'independent';
      expect(() => parseListeningNarrativeWitness(witness, source.fields, source.turns)).toThrow();
    }
  );

  it('blocks publication and grants repair only to both bound operands through the canonical gate', async () => {
    const source = fixture();
    source.criticWire.turns['2'].links = [
      {
        earlierUnitIndex: source.link.earlierUnitIndex,
        currentUnitIndex: source.table.units.find((unit) => unit.turnIndex === 2)!.unitIndex,
      },
    ];
    source.judgeWire.turns['2'] = {
      ...source.judgeWire.turns['2'],
      linkDecisions: {
        '0': {
          status: 'consistent',
          reason: 'The rain belongs to the same outing.',
          remedy: null,
        },
      },
    };
    const requests: Array<{ schema: string; payload: Record<string, unknown> }> = [];
    const provider = {
      async generateResponse(_system: string, messages: ChatMessage[], options: AIOptions) {
        const schema = options.jsonSchema!.name;
        const payload = JSON.parse(messages[0].content as string);
        requests.push({ schema, payload });
        const critic = schema === 'class_teaching_critic';
        expect(['class_teaching_critic', 'class_teaching_adjudicator']).toContain(schema);
        return {
          model: 'captured',
          content: JSON.stringify({
            items: [
              {
                index: 0,
                ...(critic ? { findings: [] } : { criticDecisions: [], newFindings: [] }),
                passageWitness: critic
                  ? listeningExtractionFixture(source.turns)
                  : listeningWitnessFixture(),
                narrativeWitness: critic ? source.criticWire : source.judgeWire,
              },
              ...(!critic ? [{ index: 1, criticDecisions: [], newFindings: [] }] : []),
            ],
          }),
        };
      },
    } as AIProvider;
    const items = [
      {
        passageText: source.fields.passageText,
        question: 'Wohin sind sie danach gegangen?',
        options: ['Zum Bahnhof.', 'Ins Museum.'],
        correctIndex: 0,
        explanation: 'Sie sind danach zum Bahnhof gegangen.',
      },
    ];
    const execution = blockedProviderExecution('narrative-fixture');
    const error = await reviewTeachingContent({
      userId: 'fixture',
      level: 'A2',
      nativeLang: 'en',
      targetLang: 'de',
      kind: 'listening',
      ai: { provider: 'fixture', model: 'captured', execution },
      provider,
      items,
      listeningTurns: source.turns,
    }).catch((failure: unknown) => failure);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    expect(error.issues).toContain('incorrect');
    const plan = listeningRepairPlan(error, items, undefined, source.turns);
    expect(plan?.turnRepair?.turnIndices).toEqual([1, 3]);
    if (!plan?.turnRepair) throw new Error('Missing authenticated narrative repair scope.');
    const candidate = {
      turns: source.turns.map(({ speaker, text }) => ({ speaker, text, direction: 'calm' })),
      references: [{ url: 'https://example.com/trip', title: 'Preserved reference' }],
    };
    const contract = teachingScriptRepairContract(candidate, plan.turnRepair);
    const repaired = applyTeachingScriptRepair(
      JSON.stringify({
        turnTexts: {
          '1': candidate.turns[0].text,
          '3': 'Danach habe ich einen Schirm gekauft.',
        },
      }),
      contract.schema,
      candidate
    );
    expect(repaired.references).toEqual(candidate.references);
    expect(repaired.turns[1]).toEqual(candidate.turns[1]);
    expect(repaired.turns[3]).toEqual(candidate.turns[3]);
    expect(repaired.turns[2]).toEqual({
      speaker: 'HOST',
      text: 'Danach habe ich einen Schirm gekauft.',
      direction: 'calm',
    });
    expect(() =>
      applyTeachingScriptRepair(
        JSON.stringify({
          turnTexts: {
            '1': candidate.turns[0].text,
            '2': 'Unauthorized change.',
            '3': candidate.turns[2].text,
          },
        }),
        contract.schema,
        candidate
      )
    ).toThrow();
    expect(
      requests.find((request) => request.schema === 'class_teaching_adjudicator')?.payload
    ).toMatchObject({
      criticisms: {
        items: [
          {
            narrativeTurns: [
              { turnIndex: 1, links: [] },
              {
                turnIndex: 2,
                links: [{ linkIndex: 0, earlierUnitIndex: 0, currentUnitIndex: 1 }],
              },
              { turnIndex: 3, links: [{ linkIndex: 0, ...source.link }] },
              { turnIndex: 4, links: [] },
            ],
          },
        ],
      },
    });
    expect(source.criticWire.turns['2'].links[0]).not.toHaveProperty('linkIndex');
    expect(source.criticWire.turns['3'].links[0]).not.toHaveProperty('linkIndex');
  });
});
