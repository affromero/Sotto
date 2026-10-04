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
  mockLoadAndRender,
  mockScriptCreate,
  mockVocabEntryCreateMany,
  mockLearnerVocabUpsert,
  mockCreateSegmentsAndQueueAudio,
  mockPersistGeneratedReferences,
} from '../../../helpers/runtime/listening-generation';
import { generateClassListening } from '@/lib/class-listening-generator';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';

const approved = {
  passageAcceptable: true,
  issues: [],
  questions: [0, 2, 0, 2].map((key, index) => ({
    index,
    acceptableOptionIndices: [key],
    issues: [],
  })),
};
const rejected = { ...approved, passageAcceptable: false, issues: ['unnatural'] };
const firstText = '„Bin“ ist hier endlich und passt zu „ich“.';
const finalText = '„Bin“ ist die konjugierte Form von „sein“ und passt zu „ich“.';

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
    expect(correction![1][0].content).toContain(JSON.stringify(rejected));
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
    mockBlindResponse.mockResolvedValue({ content: JSON.stringify(rejected), model: 'm' });
    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(SectionQualityError);
    const failure = captureGenerationFailure(error);
    expect(failure.category).toBe('section_quality');
    const records = failure.teachingFailure!.reviews.map((review) => JSON.parse(review.candidate!));
    expect(records.map((record) => record.transcript)).toEqual([
      'HOST: ' + firstText,
      'HOST: ' + finalText,
    ]);
    expect(records.map((record) => record.blindVerdict)).toEqual([rejected, rejected]);
    expect(records.every((record) => record.questions[0].correctIndex === 0)).toBe(true);
    expect(scriptRequests()).toHaveLength(2);
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
