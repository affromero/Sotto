import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PARAMS,
  SAMPLE_QUESTIONS_JSON,
  SAMPLE_SCRIPT_RESULT,
  setupHappyPath,
  mockGenerateScript,
  mockGenerateResponse,
  mockBlindResponse,
  mockTeachingResponse,
  mockTeachingCriticResponse,
  mockLogUsage,
  mockLoadAndRender,
  mockScriptCreate,
  mockVocabEntryCreateMany,
  mockLearnerVocabUpsert,
  mockCreateSegmentsAndQueueAudio,
  mockPersistGeneratedReferences,
  mockClassSectionCreate,
  mockLessonQuestionCreateMany,
} from '../../../helpers/runtime/listening-generation';
import { generateClassListening } from '@/lib/class-listening-generator';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';
import { learningScriptHash } from '@/lib/learning/script-hash';
import { listeningRepairPlan } from '@/lib/classes/quality/listening-repair';
import {
  configureSpokenTeachingRejection,
  singleTurnScriptResponseFixture,
} from './teaching-repair-fixture';
import { approved, firstText, finalText, rejected, finalRejected } from './blind-review-fixture';
import { causalBlindRejection } from './blind-review-fixture';
import {
  causalCandidateQuestions,
  unsupportedCausalQuestions,
  causalTranscript,
  teachingVerdict,
  listeningQuizJson,
  useQuizResponseSequence,
  malformedQuizResponses,
} from './repair/fixtures';

function scriptRequests() {
  return mockGenerateResponse.mock.calls.filter((call) => call[2].maxTokens === 12288);
}

function noLearningPublication() {
  expect(mockScriptCreate).not.toHaveBeenCalled();
  expect(mockVocabEntryCreateMany).not.toHaveBeenCalled();
  expect(mockLearnerVocabUpsert).not.toHaveBeenCalled();
  expect(mockPersistGeneratedReferences).not.toHaveBeenCalled();
  expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
  expect(mockClassSectionCreate).not.toHaveBeenCalled();
  expect(mockLessonQuestionCreateMany).not.toHaveBeenCalled();
}

function quizRequests() {
  return mockGenerateResponse.mock.calls.filter((call) => call[2].maxTokens === 4096);
}
function expectListeningQuizSchemaOnEveryRequest() {
  const schemas = quizRequests().map((call) => call[2].jsonSchema);
  expect(schemas).toHaveLength(2);
  expect(schemas[0]).toMatchObject({
    name: 'class_listening_quiz',
    schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
          },
        },
      },
      required: ['questions'],
      additionalProperties: false,
    },
  });
  expect(schemas[1]).toEqual(schemas[0]);
}

describe('bounded canonical listening correction', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    setupHappyPath();
    const canonical =
      await vi.importActual<typeof import('@/lib/script-generator')>('@/lib/script-generator');
    const templates =
      await vi.importActual<typeof import('@/lib/prompt-loader')>('@/lib/prompt-loader');
    mockGenerateScript.mockImplementation(canonical.generateScript);
    mockLoadAndRender.mockImplementation(templates.loadAndRender);
    let scriptIndex = 0;
    mockGenerateResponse.mockImplementation(async (...args) => {
      const options = args[2];
      noLearningPublication();
      if (options.maxTokens === 12288) {
        const text = scriptIndex++ === 0 ? firstText : finalText;
        return {
          content: singleTurnScriptResponseFixture(text, options.jsonSchema?.name),
          model: 'm',
          inputTokens: 5,
          outputTokens: 10,
        };
      }
      return { content: SAMPLE_QUESTIONS_JSON, model: 'm' };
    });
  });

  function rejectSpokenDefect(mixed = false) {
    configureSpokenTeachingRejection(approved, firstText, finalText, mixed);
  }

  it.each([false, true])(
    'retains approved questions for passage-only repairs and regenerates mixed defects (mixed=%s)',
    async (mixed) => {
      rejectSpokenDefect(mixed);
      const originalQuestions = JSON.parse(SAMPLE_QUESTIONS_JSON).questions;
      const replacementQuestions = originalQuestions.map((question: Record<string, unknown>) => ({
        ...question,
        question: `After correction: ${question.question}`,
      }));
      useQuizResponseSequence([
        listeningQuizJson(originalQuestions),
        listeningQuizJson(replacementQuestions),
      ]);
      await generateClassListening(PARAMS);
      const expectedQuestions = mixed ? replacementQuestions : originalQuestions;
      expect(mockLessonQuestionCreateMany.mock.calls[0][0].data).toEqual(
        expectedQuestions.map((question: Record<string, unknown>, index: number) => ({
          ...question,
          sectionId: 'section-1',
          skill: 'LISTENING',
          order: index + 1,
        }))
      );
      expect(mockScriptCreate.mock.calls[0][0].data.turns).toEqual([
        { speaker: 'HOST', text: finalText },
      ]);
      const requests = scriptRequests();
      const correction = JSON.parse(requests[1][1][0].content.split('\n').at(-1)!);
      expect(correction.verdict.kind).toBe('teaching');
      expect(correction.verdict.findings[0].findings[0]).toMatchObject({
        fieldPath: ['passageText'],
        quote: `HOST: ${firstText}`,
      });
      expect(
        mockBlindResponse.mock.calls.map((call) => JSON.parse(call[1][0].content).passage)
      ).toEqual([`HOST: ${firstText}`, `HOST: ${finalText}`]);
      const finalReview = JSON.parse(mockTeachingResponse.mock.calls.at(-1)![1][0].content);
      expect(finalReview.items[0].content.passageText).toBe(`HOST: ${finalText}`);
      expect(finalReview.items.slice(1).map((item: { content: unknown }) => item.content)).toEqual(
        expectedQuestions
      );
      expect(mockCreateSegmentsAndQueueAudio.mock.calls[0][1]).toEqual([
        { speaker: 'HOST', text: finalText },
      ]);
    }
  );

  it('rejects retained questions when a localized repair changes their supporting fact', async () => {
    const original = `${firstText} Ana ist nach Bonn gegangen.`;
    const corrected = `${finalText} Ana ist nach Berlin gegangen.`;
    configureSpokenTeachingRejection(approved, original, corrected);
    const questions = [
      {
        question: 'Wohin ist Ana gegangen?',
        options: ['Nach Bonn.', 'Nach Berlin.', 'Nach Hamburg.', 'Nach Köln.'],
        correctIndex: 0,
        explanation: 'Ana ist nach Bonn gegangen.',
      },
      ...JSON.parse(SAMPLE_QUESTIONS_JSON).questions.slice(1),
    ];
    mockGenerateResponse.mockImplementation(async (...args) => ({
      model: 'm',
      content:
        args[2].maxTokens === 12288
          ? singleTurnScriptResponseFixture(
              args[2].jsonSchema?.name === 'learning_script_turn_repair' ? corrected : original,
              args[2].jsonSchema?.name
            )
          : listeningQuizJson(questions),
    }));
    mockBlindResponse
      .mockResolvedValueOnce({ content: JSON.stringify(approved), model: 'm' })
      .mockResolvedValueOnce({
        content: JSON.stringify(causalBlindRejection),
        model: 'm',
      });
    await expect(generateClassListening(PARAMS)).rejects.toBeInstanceOf(SectionQualityError);
    const finalBlind = JSON.parse(mockBlindResponse.mock.calls.at(-1)![1][0].content);
    expect(finalBlind.passage).toBe(`HOST: ${corrected}`);
    expect(finalBlind.questions[0].question).toBe('Wohin ist Ana gegangen?');
    expect(finalBlind.questions[0].options).toEqual(questions[0].options);
    noLearningPublication();
  });

  it('keeps the original rejection when script repair returns identical spoken content', async () => {
    rejectSpokenDefect();
    mockGenerateResponse.mockImplementation(async (...args) => ({
      content:
        args[2].maxTokens === 12288
          ? singleTurnScriptResponseFixture(firstText, args[2].jsonSchema?.name)
          : SAMPLE_QUESTIONS_JSON,
      model: 'm',
    }));
    await expect(generateClassListening(PARAMS)).rejects.toBeInstanceOf(
      TeachingQualityRejectionError
    );
    noLearningPublication();
  });

  it('fails closed when admission denies the source repair without publishing a cached script', async () => {
    rejectSpokenDefect();
    let script = 0;
    mockGenerateResponse.mockImplementation(async (...args) => {
      if (args[2].maxTokens === 12288 && script++ > 0)
        throw new Error('Captured request budget exhausted');
      return {
        model: 'm',
        content:
          args[2].maxTokens === 12288
            ? JSON.stringify({
                ...SAMPLE_SCRIPT_RESULT,
                turns: [{ speaker: 'HOST', text: firstText }],
              })
            : SAMPLE_QUESTIONS_JSON,
      };
    });
    await expect(generateClassListening(PARAMS)).rejects.toThrow(
      'Captured request budget exhausted'
    );
    noLearningPublication();
  });

  it('does not authorize repair from a caller-constructed teaching rejection', () => {
    expect(
      listeningRepairPlan(
        new TeachingQualityRejectionError(
          ['unnatural'],
          [{ index: 0, feedback: ['Change this.'] }]
        ),
        []
      )
    ).toBeNull();
  });

  it('repairs an omitted diagnostic candidate but still rejects an unchanged replacement', async () => {
    rejectSpokenDefect();
    mockGenerateResponse.mockImplementation(async (...args) => ({
      content:
        args[2].maxTokens === 12288
          ? singleTurnScriptResponseFixture(
              firstText + ' Hallo.'.repeat(1500),
              args[2].jsonSchema?.name
            )
          : SAMPLE_QUESTIONS_JSON,
      model: 'm',
    }));
    const error = await generateClassListening(PARAMS).catch((value) => value);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    expect(error.teachingFailure.reviews[0]).toMatchObject({
      candidate: null,
      omitted: 'size_limit',
    });
    expect(scriptRequests()).toHaveLength(2);
    noLearningPublication();
  });

  it('repairs a teaching rejection by replacing only the quiz and rerunning both gates', async () => {
    let quizIndex = 0;
    let teachingReviewIndex = 0;
    mockGenerateResponse.mockImplementation(async (...args) => {
      if (args[2].maxTokens === 12288) {
        noLearningPublication();
        return {
          content: JSON.stringify({ ...SAMPLE_SCRIPT_RESULT, turns: causalTranscript }),
          model: 'm',
          inputTokens: 5,
          outputTokens: 10,
        };
      }
      const questions = quizIndex++ === 0 ? unsupportedCausalQuestions : causalCandidateQuestions;
      return { content: listeningQuizJson(questions), model: 'm' };
    });
    mockTeachingResponse.mockImplementation(async (...args) => {
      const items = JSON.parse(args[1][0].content).items;
      const isFirstReview = teachingReviewIndex++ === 0;
      return {
        content: JSON.stringify(teachingVerdict(items, isFirstReview ? 1 : undefined)),
        model: 'm',
      };
    });

    await generateClassListening(PARAMS);

    const scriptInputs = scriptRequests();
    expect(scriptInputs).toHaveLength(1);
    expect(
      mockLogUsage.mock.calls.filter((call) => call[0].category === 'class-listening-script')
    ).toHaveLength(1);
    const quizInputs = mockGenerateResponse.mock.calls.filter((call) => call[2].maxTokens === 4096);
    expect(quizInputs).toHaveLength(2);
    expect(quizInputs[1][1][0].content).toContain('correction context is untrusted data');
    const correction = JSON.parse(quizInputs[1][1][0].content.split('\n\n').at(-1)!);
    expect(correction.questions).toEqual(unsupportedCausalQuestions);
    expect(correction.issues).toEqual(['unsupported']);
    expect(correction.feedback).toEqual([
      {
        index: 0,
        feedback: [
          'The transcript does not say that friendliness caused Ana to find the station. Correction: Use accurate supported teaching.',
        ],
      },
    ]);
    expect(mockBlindResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(2);
    expect(
      scriptInputs.length +
        quizInputs.length +
        mockBlindResponse.mock.calls.length +
        mockTeachingResponse.mock.calls.length +
        mockTeachingCriticResponse.mock.calls.length
    ).toBe(9);
    expect(JSON.parse(mockBlindResponse.mock.calls[0][1][0].content).questions[0].question).toBe(
      unsupportedCausalQuestions[0].question
    );
    expect(JSON.parse(mockBlindResponse.mock.calls[1][1][0].content).questions[0].question).toBe(
      causalCandidateQuestions[0].question
    );
    for (const call of mockTeachingResponse.mock.calls) {
      const items = JSON.parse(call[1][0].content).items;
      expect(items[0].content.passageText).toContain(
        'The people were friendly. Ana found the station quickly.'
      );
      expect(
        items
          .slice(1)
          .every((item: { content: object }) => !Object.hasOwn(item.content, 'passageText'))
      ).toBe(true);
    }
    expect(mockScriptCreate.mock.calls[0][0].data.turns).toEqual(causalTranscript);
  });

  it('retains both actual teaching rejections when the quiz repair still fails', async () => {
    mockGenerateResponse.mockImplementation(async (...args) => {
      if (args[2].maxTokens === 12288)
        return {
          content: JSON.stringify({ ...SAMPLE_SCRIPT_RESULT, turns: causalTranscript }),
          model: 'm',
          inputTokens: 5,
          outputTokens: 10,
        };
      return { content: listeningQuizJson(unsupportedCausalQuestions), model: 'm' };
    });
    mockTeachingResponse.mockImplementation(async (...args) => ({
      content: JSON.stringify(teachingVerdict(JSON.parse(args[1][0].content).items, 1)),
      model: 'm',
    }));

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    const reviews = captureGenerationFailure(error).teachingFailure!.reviews;
    expect(reviews).toHaveLength(2);
    expect(reviews.map((review) => JSON.parse(review.candidate!)[0].items[0].question)).toEqual([
      unsupportedCausalQuestions[0].question,
      unsupportedCausalQuestions[0].question,
    ]);
    expect(reviews.map((review) => review.verdict.items[1].issues)).toEqual([
      ['unsupported'],
      ['unsupported'],
    ]);
    expect(scriptRequests()).toHaveLength(1);
    expect(mockBlindResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(2);
    noLearningPublication();
  });

  it('retains teaching evidence if the replacement quiz fails the blind review', async () => {
    mockGenerateResponse.mockImplementation(async (...args) => {
      if (args[2].maxTokens === 12288)
        return {
          content: JSON.stringify({ ...SAMPLE_SCRIPT_RESULT, turns: causalTranscript }),
          model: 'm',
          inputTokens: 5,
          outputTokens: 10,
        };
      return { content: listeningQuizJson(unsupportedCausalQuestions), model: 'm' };
    });
    mockTeachingResponse.mockImplementation(async (...args) => ({
      content: JSON.stringify(teachingVerdict(JSON.parse(args[1][0].content).items, 1)),
      model: 'm',
    }));
    mockBlindResponse
      .mockResolvedValueOnce({ content: JSON.stringify(approved), model: 'm' })
      .mockResolvedValueOnce({ content: JSON.stringify(causalBlindRejection), model: 'm' });

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(SectionQualityError);
    const reviews = captureGenerationFailure(error).teachingFailure!.reviews;
    expect(reviews).toHaveLength(2);
    expect(JSON.parse(reviews[0].candidate!)[0].items[0].question).toBe(
      unsupportedCausalQuestions[0].question
    );
    expect(JSON.parse(reviews[1].candidate!).reviewType).toBe('blind_section');
    expect(scriptRequests()).toHaveLength(1);
    expect(mockBlindResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(1);
    noLearningPublication();
  });

  it('fails a repeated malformed teaching verdict without content replacement or provider replay', async () => {
    mockTeachingResponse.mockResolvedValue({ content: '{', model: 'm' });
    const protocolError = await generateClassListening(PARAMS).catch((failure: unknown) => failure);
    expect(captureGenerationFailure(protocolError).category).toBe('review_protocol');
    expect(scriptRequests()).toHaveLength(1);
    expect(mockBlindResponse).toHaveBeenCalledTimes(1);
    noLearningPublication();

    vi.resetAllMocks();
    setupHappyPath();
    const canonical =
      await vi.importActual<typeof import('@/lib/script-generator')>('@/lib/script-generator');
    const templates =
      await vi.importActual<typeof import('@/lib/prompt-loader')>('@/lib/prompt-loader');
    mockGenerateScript.mockImplementation(canonical.generateScript);
    mockLoadAndRender.mockImplementation(templates.loadAndRender);
    mockGenerateResponse.mockImplementation(async (...args) => {
      if (args[2].maxTokens === 12288)
        return { content: JSON.stringify(SAMPLE_SCRIPT_RESULT), model: 'm' };
      return { content: SAMPLE_QUESTIONS_JSON, model: 'm' };
    });
    const providerError = new Error('Review provider unavailable');
    mockTeachingResponse.mockRejectedValue(providerError);
    await expect(generateClassListening(PARAMS)).rejects.toBe(providerError);
    expect(scriptRequests()).toHaveLength(1);
    expect(mockBlindResponse).toHaveBeenCalledTimes(1);
    noLearningPublication();
  });

  it('publishes only the complete corrected canonical script after both independent gates approve it', async () => {
    mockBlindResponse.mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'm' });
    mockTeachingResponse.mockImplementation(async (...args) => {
      const messages = args[1];
      noLearningPublication();
      const items = JSON.parse(messages[0].content).items;
      expect(items[0].content.passageText).toContain(finalText);
      expect(
        items
          .slice(1)
          .every((item: { content: object }) => !Object.hasOwn(item.content, 'passageText'))
      ).toBe(true);
      return {
        content: JSON.stringify({
          items: items.map((item: { index: number }) => ({
            index: item.index,
            acceptable: true,
            issues: [],
            feedback: [],
          })),
        }),
        model: 'm',
      };
    });
    await generateClassListening({ ...PARAMS, targetLang: 'de', level: 'A2' });
    expect(mockScriptCreate.mock.calls[0][0].data.turns).toEqual([
      { speaker: 'HOST', text: finalText },
    ]);
    const correction = mockGenerateResponse.mock.calls.find((call) =>
      call[1][0].content.includes('untrusted correction data')
    );
    expect(correction).toBeDefined();
    expect(correction![1][0].content).toContain(firstText);
    const correctionContext = JSON.parse(correction![1][0].content.split('\n').at(-1)!);
    expect(correctionContext.verdict).toEqual({
      passageAcceptable: false,
      passageFeedback: [{ quote: 'HOST: ' + firstText, reason: 'Endlich does not mean finite.' }],
      issues: ['unnatural'],
      questions: rejected.questions,
    });
    expect(correctionContext.candidate.turns).toEqual([{ speaker: 'HOST', text: firstText }]);
    expect(correction![1][0].content).toContain(PARAMS.objective);
    expect(correction![2]).toMatchObject({ model: 'm', apiKeyOverride: 'k' });
    expect(correction![0]).toContain('Full Immersion Mode');
    expect(scriptRequests().map((call) => [call[2].model, call[2].apiKeyOverride])).toEqual([
      ['m', 'k'],
      ['m', 'k'],
    ]);
    expect(
      mockBlindResponse.mock.calls.every((call) => !call[1][0].content.includes('correctIndex'))
    ).toBe(true);
  });

  it('retains both exact rejected candidates and strict verdicts without publishing learner material', async () => {
    mockBlindResponse
      .mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'm' })
      .mockResolvedValueOnce({ content: JSON.stringify(finalRejected), model: 'm' });
    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(SectionQualityError);
    const failure = captureGenerationFailure(error);
    expect(failure.category).toBe('section_quality');
    const records = failure.teachingFailure!.reviews.map((review) => JSON.parse(review.candidate!));
    expect(records.map((record) => record.transcript)).toEqual([
      'HOST: ' + firstText,
      'HOST: ' + finalText,
    ]);
    expect(records.map((record) => record.blindVerdict)).toEqual([
      {
        passageAcceptable: false,
        passageFeedback: [{ quote: 'HOST: ' + firstText, reason: 'Endlich does not mean finite.' }],
        issues: ['unnatural'],
        questions: approved.questions,
      },
      {
        passageAcceptable: false,
        passageFeedback: [
          {
            quote: 'HOST: ' + finalText,
            reason: 'The replacement still fails the supplied review.',
          },
        ],
        issues: ['unnatural'],
        questions: approved.questions,
      },
    ]);
    expect(records.every((record) => record.questions[0].correctIndex === 0)).toBe(true);
    expect(scriptRequests()).toHaveLength(2);
    noLearningPublication();
  });

  it('uses the same audible transcript at all provider review boundaries without rewriting the saved script', async () => {
    const turns = [
      {
        speaker: 'HOST',
        text: '[chuckles] Ich habe Tante Anna [V1:besucht]. [1] [SFX: gentle music]',
      },
      { speaker: 'EXPERT', text: '[laughs] Sie hat uns Tee gegeben.' },
    ];
    const transcript =
      'HOST: [chuckles] Ich habe Tante Anna besucht.\nEXPERT: [laughs] Sie hat uns Tee gegeben.';
    const questions = [
      {
        question: 'Wen hat der erste Sprecher besucht?',
        options: ['Tante Anna', 'Ben', 'Mia', 'Tom'],
        correctIndex: 0,
        explanation: 'Der erste Sprecher sagt: Tante Anna.',
      },
      {
        question: 'Was hat Tante Anna gegeben?',
        options: ['Kaffee', 'Wasser', 'Tee', 'Saft'],
        correctIndex: 2,
        explanation: 'Der zweite Sprecher nennt Tee.',
      },
      {
        question: 'Wer erzählt vom Besuch?',
        options: ['Der erste Sprecher', 'Der zweite Sprecher', 'Tante Anna', 'Tom'],
        correctIndex: 0,
        explanation: 'Der erste Sprecher erzählt in der ersten Person.',
      },
      {
        question: 'Welche Handlung nennt der zweite Sprecher?',
        options: ['Etwas kaufen', 'Nach Hause gehen', 'Tee geben', 'Einen Film sehen'],
        correctIndex: 2,
        explanation: 'Der zweite Sprecher sagt: Sie hat uns Tee gegeben.',
      },
    ];
    mockGenerateResponse.mockImplementation(async (system: string, messages, options) => {
      noLearningPublication();
      if (options.maxTokens === 12288) {
        expect(system).toContain('Voice Realism for Language Learning');
        expect(messages[0].content).toContain(PARAMS.objective);
        return {
          content: JSON.stringify({
            ...SAMPLE_SCRIPT_RESULT,
            turns,
            vocabulary: [{ number: 1, word: 'besucht', translation: 'visited' }],
          }),
          model: 'm',
        };
      }
      expect(system).toContain(transcript);
      expect(system).not.toContain('[V1:');
      expect(system).not.toContain('[SFX:');
      return { content: listeningQuizJson(questions), model: 'm' };
    });

    await generateClassListening({ ...PARAMS, targetLang: 'de', level: 'A2' });

    const blind = JSON.parse(mockBlindResponse.mock.calls[0][1][0].content);
    expect(blind.passage).toBe(transcript);
    expect(blind.questions).toEqual(
      questions.map(({ question, options }, index) => ({ index, question, options }))
    );
    const teaching = JSON.parse(mockTeachingResponse.mock.calls[0][1][0].content);
    expect(mockTeachingResponse.mock.calls[0][0]).toContain(
      'HOST and EXPERT at turn prefixes are nonspoken speaker identifiers'
    );
    expect(mockTeachingResponse.mock.calls[0][0]).toContain('never to arbitrary bracketed English');
    expect(
      teaching.items.map((item: { content: { passageText: string } }) => item.content.passageText)
    ).toEqual([transcript, undefined, undefined, undefined, undefined]);
    expect(mockScriptCreate.mock.calls[0][0].data.turns).toEqual(turns);
    expect(mockClassSectionCreate.mock.calls[0][0].data.spec.scriptHash).toBe(
      learningScriptHash(turns)
    );
    expect(mockCreateSegmentsAndQueueAudio.mock.calls[0][1]).toEqual(turns);
  });

  it('keeps incorrect highlighted words audible and retains both rejections without publication', async () => {
    const texts = [
      'Welche Geschichte hast du [V1:gemacht]? Äh, so sagt man das nicht.',
      'Welche Geschichte hast du [V1:gemacht]? Nein, was hast du erlebt?',
    ];
    let nextScript = 0;
    mockGenerateResponse.mockImplementation(async (system: string, messages, options) => {
      noLearningPublication();
      if (options.maxTokens === 12288) {
        expect(system).toContain('Highlight vocabulary only in correct, positive examples');
        if (nextScript > 0) expect(messages[0].content).toContain(texts[0]);
        return {
          content: JSON.stringify({
            ...SAMPLE_SCRIPT_RESULT,
            turns: [{ speaker: 'HOST', text: texts[nextScript++] }],
            vocabulary: [{ number: 1, word: 'gemacht', translation: 'made' }],
          }),
          model: 'm',
        };
      }
      expect(system).toContain('Welche Geschichte hast du gemacht?');
      expect(system).not.toContain('[V1:');
      return { content: SAMPLE_QUESTIONS_JSON, model: 'm' };
    });
    const collocationRejection = {
      ...rejected,
      passageFindings: [
        {
          sourcePartIndex: 0,
          issue: 'unnatural',
          reason: 'The verb does not fit the intended story question.',
        },
      ],
    };
    mockBlindResponse.mockResolvedValue({
      content: JSON.stringify(collocationRejection),
      model: 'm',
    });

    const error = await generateClassListening({ ...PARAMS, targetLang: 'de', level: 'A2' }).catch(
      (failure: unknown) => failure
    );

    expect(error).toBeInstanceOf(SectionQualityError);
    const records = captureGenerationFailure(error).teachingFailure!.reviews.map((review) =>
      JSON.parse(review.candidate!)
    );
    expect(records.map((record) => record.transcript)).toEqual(
      texts.map((text) => 'HOST: ' + text.replace('[V1:gemacht]', 'gemacht'))
    );
    expect(records.map((record) => record.blindVerdict)).toEqual(
      texts.map((text) => ({
        passageAcceptable: false,
        passageFeedback: [
          {
            quote: 'HOST: ' + text.replace('[V1:gemacht]', 'gemacht'),
            reason: 'The verb does not fit the intended story question.',
          },
        ],
        issues: ['unnatural'],
        questions: approved.questions,
      }))
    );
    expect(mockTeachingResponse).not.toHaveBeenCalled();
    noLearningPublication();
  });

  it('repairs a valid question/key rejection through the same canonical script path', async () => {
    const wrongKey = {
      ...approved,
      questions: approved.questions.map((item) => ({ ...item, acceptableOptionIndices: [1] })),
    };
    mockBlindResponse.mockResolvedValueOnce({ content: JSON.stringify(wrongKey), model: 'm' });
    await generateClassListening(PARAMS);
    expect(mockScriptCreate.mock.calls[0][0].data.turns[0].text).toBe(finalText);
    expect(scriptRequests()[1][1][0].content).toContain(JSON.stringify(wrongKey.questions));
  });

  it.each([
    '{',
    JSON.stringify({ ...approved, questions: [] }),
    JSON.stringify({ ...rejected, passageFeedback: [] }),
    JSON.stringify({
      ...rejected,
      passageFindings: [{ sourcePartIndex: 99, issue: 'incorrect', reason: 'Incorrect.' }],
    }),
    JSON.stringify({
      ...rejected,
      passageFindings: [{ sourcePartIndex: 0, issue: 'incorrect', reason: '  ' }],
    }),
    JSON.stringify({ ...rejected, questions: [] }),
    JSON.stringify({ ...approved, passageAcceptable: true }),
    JSON.stringify({
      ...approved,
      questions: approved.questions.map((item) => ({ ...item, acceptableOptionIndices: [0, 0] })),
    }),
  ])('never regenerates from a malformed blind verdict', async (content) => {
    mockBlindResponse.mockResolvedValue({ content, model: 'm' });
    await expect(generateClassListening(PARAMS)).rejects.toBeInstanceOf(SectionQualityError);
    expect(scriptRequests()).toHaveLength(1);
    noLearningPublication();
  });

  it('preserves first blind evidence and a replacement teaching rejection as separate actual records', async () => {
    mockBlindResponse.mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'm' });
    mockTeachingResponse.mockImplementation(async (...args) => ({
      content: JSON.stringify({
        items: JSON.parse(args[1][0].content).items.map((item: { index: number }) => ({
          index: item.index,
          acceptable: false,
          issues: ['incorrect'],
          feedback: ['The final explanation is wrong.'],
        })),
      }),
      model: 'm',
    }));
    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    const failure = captureGenerationFailure(error);
    expect(failure.category).toBe('teaching_rejected');
    const reviews = failure.teachingFailure!.reviews;
    expect(reviews).toHaveLength(2);
    expect(JSON.parse(reviews[0].candidate!).reviewType).toBe('blind_section');
    expect(JSON.parse(reviews[1].candidate!)[0].items[0].passageText).toContain(finalText);
    expect(
      scriptRequests().length +
        mockGenerateResponse.mock.calls.filter((call) => call[2].maxTokens === 4096).length +
        mockBlindResponse.mock.calls.length +
        mockTeachingResponse.mock.calls.length +
        mockTeachingCriticResponse.mock.calls.length
    ).toBe(8);
    noLearningPublication();
  });

  it.each([new Error('Provider unavailable'), new DOMException('Cancelled', 'AbortError')])(
    'preserves provider or cancellation failures without regeneration',
    async (failure) => {
      mockBlindResponse.mockRejectedValue(failure);
      await expect(generateClassListening(PARAMS)).rejects.toBe(failure);
      expect(scriptRequests()).toHaveLength(1);
      noLearningPublication();
    }
  );

  it('propagates a replacement provider failure without turning it into a quality failure', async () => {
    mockBlindResponse.mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'm' });
    const failure = new Error('Replacement provider unavailable');
    const respond = mockGenerateResponse.getMockImplementation()!;
    let scripts = 0;
    mockGenerateResponse.mockImplementation(async (...args) => {
      if (args[2].maxTokens === 12288 && ++scripts === 2) throw failure;
      return respond(...args);
    });
    await expect(generateClassListening(PARAMS)).rejects.toBe(failure);
    expect(scriptRequests()).toHaveLength(2);
    noLearningPublication();
  });

  it('propagates malformed final teaching verdict without another semantic replacement', async () => {
    mockBlindResponse.mockResolvedValueOnce({ content: JSON.stringify(rejected), model: 'm' });
    mockTeachingResponse.mockResolvedValue({ content: '{"items":[]}', model: 'm' });
    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);
    expect(captureGenerationFailure(error).category).toBe('review_protocol');
    expect(scriptRequests()).toHaveLength(2);
    noLearningPublication();
  });

  it.each(malformedQuizResponses)(
    'repairs %s quiz structure against the exact cached script before publishing',
    async (_shape, malformed) => {
      useQuizResponseSequence([malformed, SAMPLE_QUESTIONS_JSON]);

      await generateClassListening(PARAMS);

      expect(quizRequests()).toHaveLength(2);
      expectListeningQuizSchemaOnEveryRequest();
      expect(mockGenerateScript).toHaveBeenCalledTimes(1);
      expect(scriptRequests()).toHaveLength(1);
      expect(mockBlindResponse).toHaveBeenCalledTimes(1);
      expect(mockTeachingResponse).toHaveBeenCalledTimes(1);
      expect(mockScriptCreate.mock.calls[0][0].data.turns).toEqual([
        { speaker: 'HOST', text: firstText },
      ]);
      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledTimes(1);
      const correction = quizRequests()[1];
      expect(correction[1][0].content).toContain('untrusted correction data');
      expect(JSON.parse(correction[1][0].content.split('\n\n').at(-1)!)).toMatchObject([
        { attempt: 1, type: 'structure', kind: 'listening', candidate: malformed },
      ]);
      expect(correction[0]).toBe(quizRequests()[0][0]);
    }
  );

  it('retains both shape failures and publishes nothing after the one replacement is malformed', async () => {
    const secondMalformed = listeningQuizJson(
      JSON.parse(SAMPLE_QUESTIONS_JSON).questions.slice(0, 2)
    );
    useQuizResponseSequence(['{', secondMalformed]);

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(captureGenerationFailure(error)).toMatchObject({
      category: 'generation_failed',
      attemptFailures: [
        { attempt: 1, type: 'structure', kind: 'listening', candidate: '{' },
        { attempt: 2, type: 'structure', kind: 'listening', candidate: secondMalformed },
      ],
    });
    expect(quizRequests()).toHaveLength(2);
    expectListeningQuizSchemaOnEveryRequest();
    expect(mockGenerateScript).toHaveBeenCalledTimes(1);
    expect(mockBlindResponse).not.toHaveBeenCalled();
    expect(mockTeachingResponse).not.toHaveBeenCalled();
    noLearningPublication();
  });

  it('fails closed when a corrected script is followed by a quiz replacement with a trailing quote', async () => {
    const trailingQuote = `${SAMPLE_QUESTIONS_JSON}"`;
    useQuizResponseSequence([SAMPLE_QUESTIONS_JSON, trailingQuote]);
    mockBlindResponse.mockResolvedValueOnce({
      content: JSON.stringify({
        ...approved,
        issues: ['unsupported'],
        passageFindings: [
          {
            sourcePartIndex: 0,
            issue: 'unsupported',
            reason: 'The episode passage is not suitable for the stated task.',
          },
        ],
      }),
      model: 'm',
    });

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(captureGenerationFailure(error)).toMatchObject({
      category: 'generation_failed',
      attemptFailures: [
        { attempt: 1, type: 'teaching' },
        {
          attempt: 2,
          type: 'structure',
          kind: 'listening',
          candidate: trailingQuote,
          issues: [{ code: 'invalid_json' }],
        },
      ],
    });
    expect(quizRequests()).toHaveLength(2);
    expectListeningQuizSchemaOnEveryRequest();
    expect(mockGenerateScript).toHaveBeenCalledTimes(2);
    expect(scriptRequests()).toHaveLength(2);
    expect(mockBlindResponse).toHaveBeenCalledTimes(1);
    expect(mockTeachingResponse).not.toHaveBeenCalled();
    noLearningPublication();
  });

  it('keeps the first shape failure when the corrected quiz fails the blind gate', async () => {
    useQuizResponseSequence(['{', SAMPLE_QUESTIONS_JSON]);
    mockBlindResponse.mockResolvedValueOnce({
      content: JSON.stringify(causalBlindRejection),
      model: 'm',
    });

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(SectionQualityError);
    expect(captureGenerationFailure(error).attemptFailures).toMatchObject([
      { attempt: 1, type: 'structure', kind: 'listening', candidate: '{' },
      { attempt: 2, type: 'teaching' },
    ]);
    expect(mockTeachingResponse).not.toHaveBeenCalled();
    expect(mockBlindResponse).toHaveBeenCalledTimes(1);
    noLearningPublication();
  });

  it('keeps the first shape failure when the corrected quiz fails the teaching gate', async () => {
    useQuizResponseSequence(['{', SAMPLE_QUESTIONS_JSON]);
    mockTeachingResponse.mockImplementationOnce(async (...args) => ({
      content: JSON.stringify({
        items: JSON.parse(args[1][0].content).items.map((item: { index: number }) => ({
          index: item.index,
          acceptable: false,
          issues: ['unnatural'],
          feedback: ['The explanation is not supported.'],
        })),
      }),
      model: 'm',
    }));

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    expect(captureGenerationFailure(error).attemptFailures).toMatchObject([
      { attempt: 1, type: 'structure', kind: 'listening', candidate: '{' },
      { attempt: 2, type: 'teaching' },
    ]);
    expect(mockBlindResponse).toHaveBeenCalledTimes(1);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(1);
    noLearningPublication();
  });

  it('retains a semantic rejection before the malformed replacement in actual attempt order', async () => {
    useQuizResponseSequence([SAMPLE_QUESTIONS_JSON, '{']);
    mockTeachingResponse.mockImplementationOnce(async (...args) => ({
      content: JSON.stringify(teachingVerdict(JSON.parse(args[1][0].content).items, 1)),
      model: 'm',
    }));

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(captureGenerationFailure(error).attemptFailures).toMatchObject([
      { attempt: 1, type: 'teaching', failure: expect.any(Object) },
      { attempt: 2, type: 'structure', kind: 'listening', candidate: '{' },
    ]);
    expect(mockGenerateScript).toHaveBeenCalledTimes(1);
    expect(scriptRequests()).toHaveLength(1);
    expect(quizRequests()).toHaveLength(2);
    expect(mockBlindResponse).toHaveBeenCalledTimes(1);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(1);
    noLearningPublication();
  });

  it('propagates a review-provider error after quiz repair with the prior shape evidence intact', async () => {
    useQuizResponseSequence(['{', SAMPLE_QUESTIONS_JSON]);
    const failure = new Error('review provider unavailable');
    mockBlindResponse.mockRejectedValueOnce(failure);

    await expect(generateClassListening(PARAMS)).rejects.toBe(failure);

    expect(captureGenerationFailure(failure).attemptFailures).toMatchObject([
      { attempt: 1, type: 'structure', kind: 'listening', candidate: '{' },
    ]);
    expect(quizRequests()).toHaveLength(2);
    expect(mockTeachingResponse).not.toHaveBeenCalled();
    noLearningPublication();
  });

  it('propagates malformed reviewer output after quiz repair with prior shape evidence', async () => {
    useQuizResponseSequence(['{', SAMPLE_QUESTIONS_JSON]);
    mockBlindResponse.mockResolvedValueOnce({ content: '{', model: 'm' });

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(SectionQualityError);
    expect(captureGenerationFailure(error).category).toBe('section_quality');
    expect(captureGenerationFailure(error).attemptFailures).toMatchObject([
      { attempt: 1, type: 'structure', kind: 'listening', candidate: '{' },
    ]);
    expect(quizRequests()).toHaveLength(2);
    expect(mockTeachingResponse).not.toHaveBeenCalled();
    noLearningPublication();
  });

  it('propagates cancellation after quiz repair without losing the first structural failure', async () => {
    const controller = new AbortController();
    const cancellation = new DOMException('Cancelled', 'AbortError');
    useQuizResponseSequence(['{', SAMPLE_QUESTIONS_JSON]);
    const response = mockGenerateResponse.getMockImplementation()!;
    let quizIndex = 0;
    mockGenerateResponse.mockImplementation(async (...args) => {
      if (args[2].maxTokens === 4096 && ++quizIndex === 2) controller.abort(cancellation);
      return response(...args);
    });

    await expect(
      generateClassListening({
        ...PARAMS,
        execution: { ...PARAMS.execution, signal: controller.signal },
      })
    ).rejects.toBe(cancellation);

    expect(captureGenerationFailure(cancellation).attemptFailures).toMatchObject([
      { attempt: 1, type: 'structure', kind: 'listening', candidate: '{' },
    ]);
    expect(quizRequests()).toHaveLength(2);
    expect(mockBlindResponse).not.toHaveBeenCalled();
    expect(mockTeachingResponse).not.toHaveBeenCalled();
    noLearningPublication();
  });
});
