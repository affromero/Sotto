import { beforeEach, describe, expect, it, vi } from 'vitest';
import { params, intro } from './teaching/fixture';
import {
  novelFindingCorroborationFixture,
  shapeIntroProviderFixture,
} from './intro-provider-fixture';

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
        novelFindingCorroborationFixture(messages, options) ??
          (await boundary.generate(system, messages, options))
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
import {
  classIntroExampleMeaningPolicy,
  classIntroGrammarRulePolicy,
  classListeningTranscriptPolicy,
  classSpeakingMeaningPolicy,
} from '@/lib/classes/class-language-policy';
import { logger } from '@/lib/logger';
import { createAIProvider } from '@/lib/providers/ai';
import { parseTeachingAdjudicatorResponse } from '@/lib/classes/quality/teaching-review-protocol';
import {
  ReviewerProtocolError,
  TeachingQualityRejectionError,
  reviewTeachingContent,
} from '@/lib/classes/quality/teaching-quality';

const approved = { items: [{ index: 0, acceptable: true, issues: [], feedback: [] }] };
const nativeIntroParams = { ...params, level: 'A1' };
function quotedExample(example: (typeof intro.examples)[number]) {
  return { ...example, note: `„${example.target}“: ${example.note}` };
}
function queueResponses(responses: readonly unknown[]) {
  boundary.generate.mockReset();
  for (const response of responses) {
    const result = {
      content: typeof response === 'string' ? response : JSON.stringify(response),
      model: 'captured-model',
    };
    boundary.generate.mockResolvedValueOnce(result);
    if (response && typeof response === 'object' && 'items' in response)
      boundary.generate.mockResolvedValueOnce(result);
  }
}
async function reviewedIntro(callIndex: number) {
  const [system, messages, options] = boundary.generate.mock.calls[callIndex]!;
  const { introContext, items, criticisms } = JSON.parse(messages[0].content);
  const addresses = items.map(({ content }: { content: { address: unknown } }) => content.address);
  const response = await boundary.generate.mock.results[callIndex]!.value;
  const adjudicator = parseTeachingAdjudicatorResponse(
    shapeIntroProviderFixture(system, messages, options, response).content,
    items.map((item: { content: { fields: unknown } }) => item.content.fields),
    criticisms
  );
  return [
    { introContext, addresses, reviewPackets: [{ offset: 0, critic: criticisms, adjudicator }] },
  ];
}
const rejected = {
  items: [
    {
      index: 0,
      acceptable: false,
      issues: ['unnatural'],
      feedback: ['The example uses the wrong auxiliary for movement.'],
    },
  ],
};

beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockReset();
  boundary.resolve.mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    signal: new AbortController().signal,
    execution: params.execution,
  });
  boundary.generate
    .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
    .mockResolvedValue({ content: JSON.stringify(approved), model: 'captured-model' });
});

describe('intro teaching gate', () => {
  it.each(['A1', 'A2'])(
    'preserves the speaking field contract and exact %s source',
    async (level) => {
      const content = {
        targetPhrase: 'Was hast du gestern gemacht?',
        translation:
          level === 'A1'
            ? 'What did you do yesterday?'
            : 'Die Frage ist, was du gestern gemacht hast.',
        ipa: null,
      };
      boundary.generate.mockReset();
      boundary.generate.mockResolvedValue({
        content: JSON.stringify(approved),
        model: 'captured-model',
      });
      await reviewTeachingContent({
        ...params,
        level,
        ai: await boundary.resolve(),
        provider: createAIProvider('fixture'),
        kind: 'speaking',
        items: [content],
      });
      for (const [system, messages] of boundary.generate.mock.calls) {
        expect(system).toContain(classSpeakingMeaningPolicy({ ...params, level }));
        expect(JSON.parse(messages[0].content).items[0].content).toEqual(content);
      }
    }
  );

  it.each(['A1', 'A2'])(
    'keeps the shared spoken policy and written quiz fields in both %s listening reviews',
    async (level) => {
      const turn = {
        turnIndex: 1,
        speaker: 'EXPERT',
        text: '[whispers] Einige Verben brauchen hier „sein“: Ich bin nach Hause gegangen. „Gegangen“ ist eine Verbform; die Grundform heißt „gehen“.',
      };
      const passageText = `${turn.speaker}: ${turn.text}`;
      const question = {
        question: 'Wohin ist die Expertin gegangen?',
        options: ['Nach Hause', 'In den Park'],
        correctIndex: 0,
        explanation: 'Die Expertin ist nach Hause gegangen.',
      };
      boundary.generate.mockReset();
      boundary.generate.mockImplementation(async (...args) => ({
        content: JSON.stringify({
          items: JSON.parse(args[1][0].content).items.map(({ index }: { index: number }) => ({
            index,
            acceptable: true,
            issues: [],
            feedback: [],
          })),
        }),
        model: 'captured-model',
      }));
      await reviewTeachingContent({
        ...params,
        level,
        ai: await boundary.resolve(),
        provider: createAIProvider('fixture'),
        kind: 'listening',
        listeningTurns: [turn],
        items: [{ ...question, passageText }],
      });
      const policy = classListeningTranscriptPolicy({ ...params, level });
      for (const name of ['class_teaching_critic', 'class_teaching_adjudicator']) {
        const [system, messages] = boundary.generate.mock.calls.find(
          (call) => call[2].jsonSchema.name === name
        )!;
        const input = JSON.parse(messages[0].content);
        expect(system).toContain(policy);
        expect(input.listeningTurns).toEqual([turn]);
        expect(input.items.map((item: { content: unknown }) => item.content)).toEqual(
          name === 'class_teaching_critic' ? [{ passageText }] : [{ passageText }, question]
        );
      }
    }
  );

  it('reviews a partial reply opening without inventing a completed travel event', async () => {
    const content = {
      taskType: 'guided_reply',
      task: 'Schreibe als Lea an Ben über deinen Aufenthalt in Berlin.',
      sourceText: 'Lea war gestern in Berlin.',
      guidance: 'Verwende das Perfekt und behalte Leas Fakten.',
      ideas: ['Hallo Ben, ich bin …'],
    };
    boundary.generate.mockReset();
    boundary.generate.mockResolvedValue({ content: JSON.stringify(approved) });
    await expect(
      reviewTeachingContent({
        ...params,
        ai: await boundary.resolve(),
        provider: createAIProvider('fixture'),
        kind: 'writing',
        items: [content],
      })
    ).resolves.toBeUndefined();
    const [system, messages] = boundary.generate.mock.calls[0];
    expect(system).toContain('Partial ideas are openings, not completed answers');
    expect(system).toContain('in Berlin gewesen');
    expect(system).not.toContain(
      'HOST and EXPERT at turn prefixes are nonspoken speaker identifiers'
    );
    expect(JSON.parse(messages[0].content).items[0].content).toEqual(content);
    for (const [roleSystem] of boundary.generate.mock.calls) {
      expect(roleSystem).toContain(
        'Evaluate wording in its full conversational context, including ordinary ellipsis and figurative usage'
      );
      expect(roleSystem).toContain(
        'A smoother alternative or a literal reading contradicted by the surrounding dialogue does not establish a defect'
      );
      expect(roleSystem).toContain(
        'Comprehensibility does not excuse genuine grammatical or collocational errors'
      );
      expect(roleSystem).toContain(
        'For a supported wording criticism, use reason to identify the violated constraint or unresolved reading'
      );
      expect(roleSystem).toContain(
        'compare their complete meanings, including event time and completion, modality, agency, negation and scope'
      );
      expect(roleSystem).toContain(
        'Distinguish an explicitly requested transformation from an explanation claiming that two meanings are the same'
      );
    }
  });

  it.each([true, false])(
    'preserves writing source boundaries and a valid=%s review outcome',
    async (acceptable) => {
      const content = acceptable
        ? {
            taskType: 'correction',
            task: 'Korrigiere das Perfekt.\n\nTom hat gestern zum Bahnhof gegangen.',
            sourceText: 'Tom hat gestern zum Bahnhof gegangen.',
            guidance: 'Verwende das richtige Hilfsverb.',
            ideas: ['Tom ist gestern …'],
          }
        : {
            taskType: 'guided_reply',
            task: 'Schreibe als Lea über ihren Aufenthalt in Berlin. Behalte alle Fakten.',
            sourceText: 'Lea war in Berlin.',
            guidance: 'Schreibe über Lea.',
            ideas: ['Nora hat Rom besucht.'],
          };
      const verdict = {
        items: [
          {
            index: 0,
            acceptable,
            issues: acceptable ? [] : ['unsupported'],
            feedback: acceptable ? [] : ['The idea changes both the actor and the supplied place.'],
          },
        ],
      };
      boundary.generate.mockReset();
      boundary.generate.mockResolvedValue({ content: JSON.stringify(verdict) });
      const review = reviewTeachingContent({
        ...params,
        ai: await boundary.resolve(),
        provider: createAIProvider('fixture'),
        kind: 'writing',
        items: [content],
      });
      if (acceptable) await expect(review).resolves.toBeUndefined();
      else await expect(review).rejects.toBeInstanceOf(TeachingQualityRejectionError);
      const [system, messages] = boundary.generate.mock.calls[0];
      expect(system).toContain('the separate sourceText is the supplied input');
      expect(system).toContain('idiomatic completion that preserves the assigned actor');
      expect(JSON.parse(messages[0].content).items[0].content).toEqual(content);
    }
  );

  it.each([true, false])(
    'reviews the exact grammar perspective and preserves an acceptable=%s verdict',
    async (acceptable) => {
      const content = {
        question: acceptable
          ? 'Lea erzählt: „Wir _____ zusammen gekocht.“ Ergänze das Perfekt.'
          : 'Forme ins Perfekt um, ohne die Person zu ändern: Lea kocht.',
        options: acceptable
          ? ['haben', 'sind', 'hat', 'seid']
          : ['Ich habe gekocht.', 'Ich bin gekocht.', 'Ich habe kocht.', 'Ich koche gekocht.'],
        correctIndex: 0,
        explanation: '„Kochen“ bildet das Perfekt mit „haben“.',
        passageRef: '',
      };
      const verdict = {
        items: [
          {
            index: 0,
            acceptable,
            issues: acceptable ? [] : ['incorrect'],
            feedback: acceptable ? [] : ['The unquoted answer changes the stated actor.'],
          },
        ],
      };
      boundary.generate.mockReset();
      boundary.generate.mockResolvedValue({ content: JSON.stringify(verdict) });
      const review = reviewTeachingContent({
        ...params,
        ai: await boundary.resolve(),
        provider: createAIProvider('fixture'),
        kind: 'explanations',
        sectionSkill: 'GRAMMAR',
        items: [content],
      });
      if (acceptable) await expect(review).resolves.toBeUndefined();
      else {
        const error = await review.catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(TeachingQualityRejectionError);
        if (!(error instanceof TeachingQualityRejectionError)) throw error;
        expect(error.teachingFailure?.reviews[0].verdict).toEqual({
          items: verdict.items.map((item) => ({
            ...item,
            feedback: item.feedback.map(
              (text) => `${text.slice(0, 120)} Correction: Use accurate supported teaching.`
            ),
          })),
        });
        expect(JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0].items).toEqual([
          content,
        ]);
      }
      const [system, messages] = boundary.generate.mock.calls[0]!;
      expect(system).toContain('using every option before consulting the proposed key');
      expect(system).toContain('a conventional verb-second sentence type');
      expect(system).toContain(
        'Reject claims that extend verb-second order to verb-final subordinate clauses'
      );
      expect(system).toContain(
        'the proposed key and explanation cannot supply a missing public constraint'
      );
      expect(system).toContain('For explanation items involving grammar tasks');
      expect(system).toContain('Do not require a quoted subject to match');
      expect(system).toContain('Reject unquoted transformations that change the stated actor');
      expect(system).toContain('does not supply missing attribution or unsupported facts');
      expect(JSON.parse(messages[0].content)).toMatchObject({
        items: [{ index: 0, content, sourceParts: expect.any(Array) }],
      });
    }
  );
  it('reviews vocabulary against the private key and allows faithful gloss synonyms without incidental attribution', async () => {
    const content = {
      lemma: 'zurückkommen',
      sourceForm: 'zurückgekommen',
      gloss: 'to return',
      pos: 'verb',
      passageText: 'Nora ist vor einer Woche zurückgekommen.',
      assessedQuestions: [
        {
          question: 'Wann ist Nora zurückgekommen?',
          options: ['Vor einer Woche', 'Gestern', 'Heute', 'Morgen'],
          correctIndex: 0,
        },
      ],
    };
    boundary.generate.mockReset();
    boundary.generate.mockResolvedValue({
      content: JSON.stringify(approved),
      model: 'captured-model',
    });
    await reviewTeachingContent({
      ...params,
      ai: await boundary.resolve(),
      provider: createAIProvider('anthropic'),
      kind: 'vocabulary',
      items: [content],
    });
    const [system, messages] = boundary.generate.mock.calls[0]!;
    expect(system).toContain('gloss is a dictionary meaning in the native language (en)');
    expect(system).toContain('never to vocabulary metadata');
    expect(system).toContain('Immediate immersion for A2');
    expect(system).toContain('Accept faithful contextual synonyms');
    expect(system).toContain(
      'interpret the question or distinguish the supplied private correctIndex answer'
    );
    expect(system).toContain(
      'Incidental locations, objects or events are unsupported associations'
    );
    expect(boundary.generate.mock.calls[0]![2]).toMatchObject({
      maxTokens: 4096,
      temperature: 0,
      jsonSchema: { name: 'class_teaching_critic' },
    });
    expect(JSON.parse(messages[0].content)).toMatchObject({
      items: [{ index: 0, content, sourceParts: expect.any(Array) }],
    });
  });
  it.each([
    'initial',
    'structural repair',
    'semantic replacement',
    'structural then semantic repair',
  ])(
    'reviews the exact native-language explanation after %s without requiring a different meaning',
    async (path) => {
      const usageIntro = {
        purpose: 'Erzähle von gestern.',
        about: 'Mit dem Perfekt erzählst du von Vergangenem.',
        focus: ['Perfekt mit haben'],
        examples: [
          {
            target: 'Sie hat das Museum besucht.',
            meaning: 'She visited the museum.',
            note: 'Das Verb „besuchen“ bildet das Perfekt mit „haben“.',
          },
        ],
        tips: ['Achte auf das Hilfsverb.'],
      };
      const drifted = {
        ...usageIntro,
        examples: [{ ...usageIntro.examples[0], meaning: 'She looked at the museum.' }],
      };
      const driftVerdict = {
        items: [
          {
            index: 0,
            acceptable: false,
            issues: ['incorrect'],
            feedback: ['examples[0].meaning changes a museum visit into looking at the museum.'],
          },
        ],
      };
      const responses =
        path === 'initial'
          ? [usageIntro, approved]
          : path === 'structural repair'
            ? ['invalid fixture JSON', usageIntro, approved]
            : [
                ...(path === 'structural then semantic repair' ? ['invalid fixture JSON'] : []),
                drifted,
                driftVerdict,
                { examples: { 0: usageIntro.examples[0] } },
                approved,
              ];
      queueResponses(responses);

      const result = await generateClassIntro(nativeIntroParams);
      expect(result.examples).toEqual(usageIntro.examples.map(quotedExample));
      expect(result.visuals).toBeUndefined();
      const generationRequests = boundary.generate.mock.calls.filter(([system]) =>
        system.startsWith('You are a language teacher')
      );
      for (const [system, messages] of generationRequests) {
        expect(system).toContain(classIntroExampleMeaningPolicy(nativeIntroParams));
        expect(system).toContain(classIntroGrammarRulePolicy());
        if (system.includes('repairing or replacing')) {
          expect(messages[0].content).toContain(classIntroExampleMeaningPolicy(nativeIntroParams));
        }
      }
      const reviewRequests = boundary.generate.mock.calls.filter(([system]) =>
        system.startsWith('Independently review')
      );
      const [reviewSystem, messages] = reviewRequests.at(-1)!;
      expect(reviewSystem).toContain(classIntroExampleMeaningPolicy(nativeIntroParams));
      expect(reviewSystem).toContain(classIntroGrammarRulePolicy());
      expect(
        JSON.parse(messages[0].content).items.find(
          ({ content }: { content: { address: { field: string } } }) =>
            content.address.field === 'examples'
        ).content.fields.example
      ).toEqual(quotedExample(usageIntro.examples[0]!));
    }
  );

  it('keeps rejecting a native-language explanation with an unsupported result after bounded replacement', async () => {
    const unsupported = {
      ...intro,
      examples: [
        {
          target: 'Sie hat das Museum besucht.',
          meaning: 'She saw all the pictures there.',
          note: 'Das Verb „besuchen“ bildet das Perfekt mit „haben“.',
        },
      ],
    };
    const verdict = {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['unsupported'],
          feedback: ['examples[0].meaning claims she saw every picture, absent from the example.'],
        },
      ],
    };
    queueResponses([unsupported, verdict, { examples: { 0: unsupported.examples[0] } }, verdict]);
    await expect(generateClassIntro(nativeIntroParams)).rejects.toBeInstanceOf(
      TeachingQualityRejectionError
    );
    for (const [system, messages] of boundary.generate.mock.calls.filter(([system]) =>
      system.startsWith('Independently review')
    )) {
      expect(system).toContain(
        'Do not infer participants, events, results, intentions or grammar claims'
      );
      expect(
        JSON.parse(messages[0].content).items.find(
          ({ content }: { content: { address: { field: string } } }) =>
            content.address.field === 'examples'
        ).content.fields.example
      ).toEqual(quotedExample(unsupported.examples[0]!));
    }
  });

  it('preserves accurate native-language meaning instructions for A1 initial and repaired intros', async () => {
    queueResponses([intro, rejected, { examples: { 0: intro.examples[0] } }, approved]);
    const result = await generateClassIntro({ ...params, level: 'A1' });
    expect(result.examples).toEqual(intro.examples.map(quotedExample));
    for (const [system, messages] of boundary.generate.mock.calls.filter(([system]) =>
      system.startsWith('You are a language teacher')
    )) {
      expect(system).toContain('preserve the exact meaning of the target sentence');
      expect(system).toContain('Concise en support is allowed under the A1 language policy');
      expect(system).not.toContain('write its meaning as a short, grammatical de usage note');
      expect(messages[0].content).not.toContain('distinct meanings');
    }
  });

  it('keeps rejected native-language meanings and misleading visual combinations out of published teaching', async () => {
    const candidate = {
      ...intro,
      examples: [
        {
          target: 'Ich habe gestern einen Film gesehen.',
          meaning: 'The film was the object of my seeing yesterday.',
          note: 'Das Partizip steht im Hauptsatz am Ende.',
        },
        {
          target: 'Wir sind zu Fuß nach Hause gegangen.',
          meaning: 'We moved home in a walking way.',
          note: 'Hier steht gehen mit sein.',
        },
      ],
      visuals: {
        contrast: {
          title: 'Ich habe gestern einen Film gesehen.',
          leftLabel: 'Ich habe gestern einen Film gesehen.',
          leftItems: ['We moved home in a walking way.'],
          rightLabel: 'Wir sind zu Fuß nach Hause gegangen.',
          rightItems: ['The film was the object of my seeing yesterday.'],
        },
        callouts: [
          {
            label: 'Ich habe gestern einen Film gesehen.',
            text: 'We moved home in a walking way.',
            tone: 'blue',
          },
        ],
      },
    };
    const firstBatch = {
      items: [0, 1, 2, 3, 4].map((index) =>
        index === 4
          ? {
              index,
              acceptable: false,
              issues: ['unnatural'],
              feedback: ['examples[0].meaning is unnatural.'],
            }
          : { index, acceptable: true, issues: [], feedback: [] }
      ),
    };
    const replacement = {
      ...intro,
      examples: candidate.examples.map((example, index) => ({
        ...example,
        meaning: ['I watched a film yesterday.', 'We walked home.'][index]!,
      })),
    };
    const finalBatch = {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['unnatural'],
          feedback: ['examples[1].meaning is unnatural.'],
        },
        {
          index: 1,
          acceptable: false,
          issues: ['incorrect'],
          feedback: ['visuals incorrectly pair each meaning with the other example.'],
        },
      ],
    };
    queueResponses([
      candidate,
      firstBatch,
      finalBatch,
      { examples: { 0: replacement.examples[0], 1: replacement.examples[1] } },
      approved,
      approved,
    ]);

    const result = await generateClassIntro(nativeIntroParams);

    expect(result.examples).toEqual(replacement.examples.map(quotedExample));
    expect(result.visuals).toBeUndefined();
    expect(boundary.generate.mock.calls[5][1][0].content).toContain(
      'examples[0].meaning is unnatural.'
    );
  });
  it('retains both rejected candidates privately without changing the bounded replacement', async () => {
    const replacement = {
      ...intro,
      examples: [{ ...intro.examples[0], note: 'Private replacement explanation.' }],
    };
    const replacementVerdict = {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['incorrect'],
          feedback: ['Private replacement feedback about the grammar rule.'],
        },
      ],
    };
    queueResponses([
      intro,
      rejected,
      { examples: { 0: replacement.examples[0] } },
      replacementVerdict,
    ]);
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const error = await generateClassIntro(params).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(TeachingQualityRejectionError);
      if (!(error instanceof TeachingQualityRejectionError)) throw error;
      const reviewCalls = boundary.generate.mock.calls.filter(
        ([, , options]) => options.jsonSchema?.name === 'class_intro_adjudicator'
      );
      const reviewInputs = await Promise.all(
        reviewCalls.map((call) => reviewedIntro(boundary.generate.mock.calls.indexOf(call)))
      );
      expect(error.teachingFailure?.reviews.map((review) => JSON.parse(review.candidate!))).toEqual(
        reviewInputs
      );
      expect(
        error.teachingFailure?.reviews.map((review) =>
          review.verdict.items.map((item) => [item.index, item.acceptable])
        )
      ).toEqual([
        [
          [0, true],
          [1, true],
          [2, true],
          [3, true],
          [4, false],
        ],
        [
          [0, true],
          [1, false],
          [2, true],
          [3, true],
          [4, true],
        ],
      ]);
      expect(error.feedback[0].feedback).toEqual([
        'about: about: Private replacement feedback about the grammar rule. Correction: Use accurate supported teaching.',
      ]);
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(replacement.examples[0].note);
      expect(serialized).not.toContain(replacementVerdict.items[0].feedback[0]);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(replacement.examples[0].note);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        replacementVerdict.items[0].feedback[0]
      );
    } finally {
      warning.mockRestore();
    }
  });
  it('repairs invalid optional visuals while preserving provider-authored example meaning', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ...intro,
          visuals: {
            callouts: [{ label: 'Past tense', text: 'Use sein with movement.', tone: 'green' }],
          },
        }),
        model: 'captured-model',
      })
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content: JSON.stringify(approved), model: 'captured-model' });

    const result = await generateClassIntro(nativeIntroParams);

    expect(result.purpose).toBe(intro.purpose);
    expect(result.examples).toEqual(intro.examples.map(quotedExample));
    expect(result.visuals).toBeUndefined();
    const repair = boundary.generate.mock.calls[1];
    expect(repair[2].jsonSchema.name).toBe('class_intro_repair');
    expect(repair[1][0].content).toContain('"reason":"visual_scope"');
    const review = boundary.generate.mock.calls[2];
    expect(JSON.parse(review[1][0].content).introContext).toEqual(result);
  });

  it('repairs malformed generated teaching before reviewing the exact result', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content: JSON.stringify(approved), model: 'captured-model' });
    const result = await generateClassIntro(params);
    expect(boundary.generate.mock.calls[1][2]).toMatchObject({
      model: 'captured-model',
      signal: expect.any(AbortSignal),
      temperature: 0,
      jsonSchema: expect.objectContaining({ name: 'class_intro_repair' }),
    });
    expect(boundary.generate.mock.calls[1][0]).toContain('Level: A2');
    expect(boundary.generate.mock.calls[1][0]).toContain('target language is "de"');
    expect(boundary.generate.mock.calls[1][1][0].content).toContain('"required"');
    expect(boundary.generate.mock.calls[1][1][0].content).toContain('"purpose"');
    const review = boundary.generate.mock.calls[2];
    expect(JSON.parse(review[1][0].content).introContext).toEqual(result);
  });

  it('repairs generated teaching whose examples normalize to empty', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          ...intro,
          examples: [{ target: 'Reise', meaning: 'Reise', note: 'Reise' }],
        }),
        model: 'captured-model',
      })
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content: JSON.stringify(approved), model: 'captured-model' });

    const result = await generateClassIntro(params);

    expect(result.examples).toEqual(
      intro.examples.map((example) => ({ ...quotedExample(example), meaning: example.target }))
    );
  });

  it('replaces a rejected explanation and preserves feedback identifying its field', async () => {
    const candidate = {
      ...intro,
      examples: [
        {
          target: 'Ich habe einen Kuchen gebacken.',
          meaning: 'Ein Kuchen wurde von mir gebacken.',
          note: 'Bei einen Kuchen backen steht das Perfekt mit haben.',
        },
      ],
    };
    const teachingVerdict = {
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['incorrect'],
          feedback: [
            'examples[0].note uses an unquoted infinitive phrase after a preposition. Quote the expression or rewrite the surrounding explanation grammatically.',
          ],
        },
      ],
    };
    const replacement = {
      ...candidate,
      examples: [
        { ...candidate.examples[0], note: 'Das Verb „backen“ bildet das Perfekt mit haben.' },
      ],
    };
    queueResponses([
      candidate,
      teachingVerdict,
      { examples: { 0: replacement.examples[0] } },
      approved,
    ]);

    await expect(generateClassIntro(params)).resolves.toMatchObject({
      ...replacement,
      about: 'Ich habe einen Kuchen gebacken.',
      focus: ['„Ich habe einen Kuchen gebacken.“: Describe transport'],
      tips: ['„Ich habe einen Kuchen gebacken.“: Name the transport.'],
      examples: replacement.examples.map((example) => ({
        ...quotedExample(example),
        meaning: example.target,
      })),
    });
    expect(boundary.generate.mock.calls[3][2].jsonSchema.name).toBe('class_intro_repair');
    expect(boundary.generate.mock.calls[3][1][0].content).toContain(
      'failed an independent teaching-quality review'
    );
    expect(boundary.generate.mock.calls[3][1][0].content).toContain(
      'Review issue codes: ["incorrect"]'
    );
    expect(boundary.generate.mock.calls[3][1][0].content).toContain(
      teachingVerdict.items[0].feedback[0].slice(0, 120)
    );
    expect(boundary.generate.mock.calls[3][0]).toContain('Do not return visuals');
    expect(boundary.generate.mock.calls[3][0]).not.toContain('visual aids');
    for (const system of [boundary.generate.mock.calls[0][0], boundary.generate.mock.calls[3][0]]) {
      expect(system).toContain(params.title);
      expect(system).toContain(params.objective);
    }
    expect(
      boundary.generate.mock.calls[3][2].jsonSchema.schema.properties.examples.required
    ).toEqual(['0']);
  });

  it('fails closed when the bounded quality replacement is also rejected', async () => {
    queueResponses([intro, rejected, { examples: { 0: intro.examples[0] } }, rejected]);

    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate).toHaveBeenCalledTimes(6);
  });

  it('keeps review feedback and malformed output out of diagnostic logs', async () => {
    const privateFeedback = 'Private learner content must never appear in diagnostic logs.';
    const warning = vi.spyOn(logger, 'warn');
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            { index: 0, acceptable: false, issues: ['incorrect'], feedback: [privateFeedback] },
          ],
        }),
        model: 'captured-model',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            { index: 0, acceptable: false, issues: ['incorrect'], feedback: [privateFeedback] },
          ],
        }),
        model: 'captured-model',
      })
      .mockResolvedValueOnce({ content: `${privateFeedback}{`, model: 'captured-model' });
    try {
      await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
      expect(JSON.stringify(warning.mock.calls)).not.toContain(privateFeedback);
      expect(warning).toHaveBeenCalledWith('Class intro protocol rejected content', {
        stage: 'replacement',
        reason: 'invalid_json',
      });
    } finally {
      warning.mockRestore();
    }
  });

  it('retains both rejections when semantic repair after structural repair still fails', async () => {
    queueResponses(['{', intro, rejected, { examples: { 0: intro.examples[0] } }, rejected]);

    const error = await generateClassIntro(params).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(error instanceof TeachingQualityRejectionError)) throw error;
    expect(JSON.parse(error.teachingFailure!.reviews[0]!.candidate!)).toEqual(
      await reviewedIntro(3)
    );
    expect(
      error.teachingFailure?.reviews[0]?.verdict.items.map(({ index, acceptable }) => [
        index,
        acceptable,
      ])
    ).toEqual([
      [0, true],
      [1, true],
      [2, true],
      [3, true],
      [4, false],
    ]);
    expect(error.teachingFailure?.reviews).toHaveLength(2);
    expect(error.teachingFailure?.reviews[1]?.verdict.items.some((item) => !item.acceptable)).toBe(
      true
    );
  });

  it('propagates quality replacement provider failure without another call', async () => {
    const error = new Error('authorization denied');
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' })
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'captured-model' })
      .mockRejectedValueOnce(error);

    await expect(generateClassIntro(params)).rejects.toBe(error);
    expect(boundary.generate).toHaveBeenCalledTimes(4);
  });

  it('fails closed when repaired teaching remains unusable', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockResolvedValue({
        content: JSON.stringify({ ...intro, examples: [] }),
        model: 'captured-model',
      });
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate.mock.calls).toHaveLength(2);
  });

  it('propagates authority capture failure without dispatch or fallback', async () => {
    boundary.resolve.mockRejectedValue(new Error('Authority revoked'));
    await expect(generateClassIntro(params)).rejects.toThrow('Authority revoked');
    expect(boundary.generate).not.toHaveBeenCalled();
  });

  it.each([
    'not-json',
    JSON.stringify({ items: [] }),
    JSON.stringify({ items: [{ index: 1, acceptable: true, issues: [], feedback: [] }] }),
    JSON.stringify({
      items: [{ index: 0, acceptable: false, issues: ['incorrect'], feedback: [] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: false, issues: ['incorrect'], feedback: ['x'.repeat(301)] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: false, issues: ['incorrect'], feedback: ['   '] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: true, issues: [], feedback: ['Unneeded instruction.'] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: true, issues: ['uncertain'], feedback: [] }],
    }),
    JSON.stringify({
      items: [{ index: 0, acceptable: false, issues: [], feedback: ['Correct the auxiliary.'] }],
    }),
  ])(
    'fails closed after one protocol correction without content replacement %s',
    async (content) => {
      boundary.generate
        .mockReset()
        .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
        .mockResolvedValue({ content, model: 'captured-model' });
      await expect(generateClassIntro(params)).rejects.toBeInstanceOf(ReviewerProtocolError);
      expect(boundary.generate.mock.calls).toHaveLength(3);
    }
  );

  it.each([
    JSON.stringify({
      items: [
        {
          index: 0,
          acceptable: false,
          issues: ['incorrect'],
          feedback: ['The example uses the wrong auxiliary.'],
        },
      ],
    }),
  ])('uses one bounded replacement for semantic rejection %s', async (content) => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockResolvedValue({ content, model: 'captured-model' });
    await expect(generateClassIntro(params)).rejects.toThrow('educational quality');
    expect(boundary.generate.mock.calls).toHaveLength(4);
  });

  it.each(['provider unavailable', 'authorization denied', 'cancelled', 'budget exhausted'])(
    'propagates %s from generation without repair',
    async (message) => {
      boundary.generate.mockReset().mockRejectedValue(new Error(message));
      await expect(generateClassIntro(params)).rejects.toThrow(message);
      expect(boundary.generate.mock.calls).toHaveLength(1);
    }
  );

  it('propagates repair provider failure without returning metadata fallback', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: '{', model: 'captured-model' })
      .mockRejectedValueOnce(new Error('repair unavailable'));
    await expect(generateClassIntro(params)).rejects.toThrow('repair unavailable');
    expect(boundary.generate.mock.calls).toHaveLength(2);
  });

  it('propagates reviewer failure without returning the generated or fallback intro', async () => {
    boundary.generate
      .mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(intro), model: 'captured-model' })
      .mockRejectedValue(new Error('review unavailable'));
    await expect(generateClassIntro(params)).rejects.toThrow('review unavailable');
  });
});
