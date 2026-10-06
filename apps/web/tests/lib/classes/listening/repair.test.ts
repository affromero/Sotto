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
  mockLogUsage,
  mockLoadAndRender,
  mockScriptCreate,
  mockVocabEntryCreateMany,
  mockLearnerVocabUpsert,
  mockCreateSegmentsAndQueueAudio,
  mockPersistGeneratedReferences,
  mockClassSectionCreate,
} from '../../../helpers/runtime/listening-generation';
import { generateClassListening } from '@/lib/class-listening-generator';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';
import { learningScriptHash } from '@/lib/learning/script-hash';

const approved = {
  passageAcceptable: true,
  passageFeedback: [],
  issues: [],
  questions: [0, 2, 0, 2].map((key, index) => ({
    index,
    acceptableOptionIndices: [key],
    issues: [],
  })),
};
const firstText = '„Bin“ ist hier endlich und passt zu „ich“.';
const finalText = '„Bin“ ist die konjugierte Form von „sein“ und passt zu „ich“.';
const rejected = {
  ...approved,
  passageAcceptable: false,
  issues: ['unnatural'],
  passageFeedback: [{ quote: firstText, reason: 'Endlich does not mean finite.' }],
};
const finalRejected = {
  ...rejected,
  passageFeedback: [
    { quote: finalText, reason: 'The replacement still fails the supplied review.' },
  ],
};
const causalCandidateQuestions = [
  {
    question: 'What did Ana find quickly?',
    options: ['The station', 'A restaurant', 'Her hotel', 'The museum'],
    correctIndex: 0,
    explanation: 'The transcript says Ana found the station quickly.',
  },
  ...JSON.parse(SAMPLE_QUESTIONS_JSON).slice(1),
];
const unsupportedCausalQuestions = [
  {
    question: 'Why did Ana find the station quickly?',
    options: [
      'The people were friendly',
      'It was raining',
      'She knew the driver',
      'The station was closed',
    ],
    correctIndex: 0,
    explanation: 'The people were friendly, so Ana found the station quickly.',
  },
  ...causalCandidateQuestions.slice(1),
];
const causalTranscript = [
  { speaker: 'HOST', text: 'Ana was new in town.' },
  { speaker: 'EXPERT', text: 'The people were friendly. Ana found the station quickly.' },
];
const causalBlindRejection = {
  ...approved,
  questions: approved.questions.map((item) =>
    item.index === 0 ? { ...item, acceptableOptionIndices: [1], issues: ['incorrect'] } : item
  ),
};

function teachingVerdict(items: Array<{ index: number }>, rejectedIndex?: number) {
  return {
    items: items.map(({ index }) =>
      index === rejectedIndex
        ? {
            index,
            acceptable: false,
            issues: ['unsupported'],
            feedback: [
              'The transcript does not say that friendliness caused Ana to find the station.',
            ],
          }
        : { index, acceptable: true, issues: [], feedback: [] }
    ),
  };
}

function scriptRequests() {
  return mockGenerateResponse.mock.calls.filter((call) => call[2].maxTokens === 12288);
}

function noLearningPublication() {
  expect(mockScriptCreate).not.toHaveBeenCalled();
  expect(mockVocabEntryCreateMany).not.toHaveBeenCalled();
  expect(mockLearnerVocabUpsert).not.toHaveBeenCalled();
  expect(mockPersistGeneratedReferences).not.toHaveBeenCalled();
  expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
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
          content: JSON.stringify({ ...SAMPLE_SCRIPT_RESULT, turns: [{ speaker: 'HOST', text }] }),
          model: 'm',
          inputTokens: 5,
          outputTokens: 10,
        };
      }
      return { content: SAMPLE_QUESTIONS_JSON, model: 'm' };
    });
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
      return { content: JSON.stringify(questions), model: 'm' };
    });
    mockTeachingResponse.mockImplementation(async (...args) => {
      const items = JSON.parse(args[1][0].content).items;
      const isFirstReview = teachingReviewIndex++ === 0;
      return {
        content: JSON.stringify(teachingVerdict(items, isFirstReview ? 0 : undefined)),
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
        feedback: ['The transcript does not say that friendliness caused Ana to find the station.'],
      },
    ]);
    expect(mockBlindResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(2);
    expect(
      scriptInputs.length +
        quizInputs.length +
        mockBlindResponse.mock.calls.length +
        mockTeachingResponse.mock.calls.length
    ).toBe(7);
    expect(JSON.parse(mockBlindResponse.mock.calls[0][1][0].content).questions[0].question).toBe(
      unsupportedCausalQuestions[0].question
    );
    expect(JSON.parse(mockBlindResponse.mock.calls[1][1][0].content).questions[0].question).toBe(
      causalCandidateQuestions[0].question
    );
    for (const call of mockTeachingResponse.mock.calls) {
      const items = JSON.parse(call[1][0].content).items;
      expect(
        items.every((item: { content: { passageText: string } }) =>
          item.content.passageText.includes(
            'The people were friendly. Ana found the station quickly.'
          )
        )
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
      return { content: JSON.stringify(unsupportedCausalQuestions), model: 'm' };
    });
    mockTeachingResponse.mockImplementation(async (...args) => ({
      content: JSON.stringify(teachingVerdict(JSON.parse(args[1][0].content).items, 0)),
      model: 'm',
    }));

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    const reviews = captureGenerationFailure(error).teachingFailure!.reviews;
    expect(reviews).toHaveLength(2);
    expect(reviews.map((review) => JSON.parse(review.candidate!)[0].question)).toEqual([
      unsupportedCausalQuestions[0].question,
      unsupportedCausalQuestions[0].question,
    ]);
    expect(reviews.map((review) => review.verdict.items[0].issues)).toEqual([
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
      return { content: JSON.stringify(unsupportedCausalQuestions), model: 'm' };
    });
    mockTeachingResponse.mockImplementation(async (...args) => ({
      content: JSON.stringify(teachingVerdict(JSON.parse(args[1][0].content).items, 0)),
      model: 'm',
    }));
    mockBlindResponse
      .mockResolvedValueOnce({ content: JSON.stringify(approved), model: 'm' })
      .mockResolvedValueOnce({ content: JSON.stringify(causalBlindRejection), model: 'm' });

    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(SectionQualityError);
    const reviews = captureGenerationFailure(error).teachingFailure!.reviews;
    expect(reviews).toHaveLength(2);
    expect(JSON.parse(reviews[0].candidate!)[0].question).toBe(
      unsupportedCausalQuestions[0].question
    );
    expect(JSON.parse(reviews[1].candidate!).reviewType).toBe('blind_section');
    expect(scriptRequests()).toHaveLength(1);
    expect(mockBlindResponse).toHaveBeenCalledTimes(2);
    expect(mockTeachingResponse).toHaveBeenCalledTimes(1);
    noLearningPublication();
  });

  it('does not retry a malformed teaching verdict or provider failure', async () => {
    mockTeachingResponse.mockResolvedValueOnce({ content: '{', model: 'm' });
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
      expect(
        items.every((item: { content: { passageText: string } }) =>
          item.content.passageText.includes(finalText)
        )
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
    expect(correctionContext.verdict).toEqual(rejected);
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
    expect(records.map((record) => record.blindVerdict)).toEqual([rejected, finalRejected]);
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
      return { content: JSON.stringify(questions), model: 'm' };
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
    ).toEqual(Array(4).fill(transcript));
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
      passageFeedback: [
        {
          quote: 'Welche Geschichte hast du gemacht?',
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
    expect(records.map((record) => record.blindVerdict)).toEqual([
      collocationRejection,
      collocationRejection,
    ]);
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
    expect(scriptRequests()[1][1][0].content).toContain(JSON.stringify(wrongKey));
  });

  it.each([
    '{',
    JSON.stringify({ ...approved, questions: [] }),
    JSON.stringify({ ...rejected, passageFeedback: [] }),
    JSON.stringify({
      ...rejected,
      passageFeedback: [{ quote: 'An invented excerpt.', reason: 'Incorrect.' }],
    }),
    JSON.stringify({ ...rejected, passageFeedback: [{ quote: firstText, reason: '  ' }] }),
    JSON.stringify({ ...rejected, questions: [] }),
    JSON.stringify({ ...approved, passageFeedback: rejected.passageFeedback }),
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
    expect(JSON.parse(reviews[1].candidate!)[0].passageText).toContain(finalText);
    expect(
      scriptRequests().length +
        mockGenerateResponse.mock.calls.filter((call) => call[2].maxTokens === 4096).length +
        mockBlindResponse.mock.calls.length +
        mockTeachingResponse.mock.calls.length
    ).toBe(7);
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
});
