import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PARAMS,
  SAMPLE_SCRIPT_RESULT,
  SAMPLE_QUESTIONS_JSON,
  setupHappyPath,
  mockGenerateScript,
  mockGenerateResponse,
  mockLoadAndRender,
  mockBlindResponse,
  mockTeachingCriticResponse,
  mockTeachingResponse,
  mockScriptCreate,
  mockVocabEntryCreateMany,
  mockLearnerVocabUpsert,
  mockPersistGeneratedReferences,
  mockClassSectionCreate,
  mockLessonQuestionCreateMany,
  mockCreateSegmentsAndQueueAudio,
} from '../../../helpers/runtime/listening-generation';
import { generateClassListening } from '@/lib/class-listening-generator';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';
import { SectionQualityError } from '@/lib/classes/section-quality';
import {
  ScriptOutputProtocolError,
  scriptOutputProtocolFailure,
} from '@/lib/learning/script/output-protocol';
import { approved, rejected } from './blind-review-fixture';

const valid = JSON.stringify(SAMPLE_SCRIPT_RESULT);
const vocabulary = [
  { number: 1, word: 'besucht', translation: 'visited' },
  { number: 2, word: 'gegangen', translation: 'gone' },
  { number: 3, word: 'gegangen', translation: 'walked' },
];
function candidate(text: string, entries = vocabulary) {
  return JSON.stringify({
    ...SAMPLE_SCRIPT_RESULT,
    turns: [{ speaker: 'HOST', text }],
    vocabulary: entries,
  });
}
const ambiguous = candidate('Ich bin [V1:gegangen].');
const missing = candidate('Ich habe [V99:gelesen].');
const duplicate = candidate('Ich habe [V1:besucht].', [
  ...vocabulary,
  { number: 1, word: 'gelesen', translation: 'read' },
]);

function scriptRequests() {
  return mockGenerateResponse.mock.calls.filter((call) => call[2].maxTokens === 12288);
}
function expectUnpublished() {
  for (const boundary of [
    mockScriptCreate,
    mockVocabEntryCreateMany,
    mockLearnerVocabUpsert,
    mockPersistGeneratedReferences,
    mockClassSectionCreate,
    mockLessonQuestionCreateMany,
    mockCreateSegmentsAndQueueAudio,
  ])
    expect(boundary).not.toHaveBeenCalled();
}
function useScripts(outputs: Array<string | Error>) {
  let index = 0;
  mockGenerateResponse.mockImplementation(async (...args) => {
    expectUnpublished();
    if (args[2].maxTokens === 12288) {
      const next = outputs[index++];
      if (next === undefined) throw new Error('Unexpected extra script request.');
      if (typeof next !== 'string') throw next;
      return { content: next, model: 'm', inputTokens: 3, outputTokens: 4 };
    }
    return { content: SAMPLE_QUESTIONS_JSON, model: 'm' };
  });
}
async function failure() {
  try {
    await generateClassListening(PARAMS);
  } catch (error) {
    return error;
  }
  throw new Error('Expected generation to fail.');
}

describe('bounded listening marker correction', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    setupHappyPath();
    const actual =
      await vi.importActual<typeof import('@/lib/script-generator')>('@/lib/script-generator');
    const prompts =
      await vi.importActual<typeof import('@/lib/prompt-loader')>('@/lib/prompt-loader');
    mockGenerateScript.mockImplementation(actual.generateScript);
    mockLoadAndRender.mockImplementation(prompts.loadAndRender);
    useScripts([ambiguous, valid]);
  });

  it.each([
    [ambiguous, 'script_vocabulary_ambiguous_identity'],
    [missing, 'script_vocabulary_missing_identity'],
    [duplicate, 'script_vocabulary_duplicate_number'],
  ])('fully reviews a replacement after canonical identity rejection (%s)', async (raw, code) => {
    useScripts([raw, valid]);
    await generateClassListening(PARAMS);
    const requests = scriptRequests();
    expect(requests).toHaveLength(2);
    const correction = JSON.parse(requests[1][1][0].content.split('\n').at(-1)!);
    expect(correction).toEqual({ kind: 'script_protocol', candidate: raw, issues: [{ code }] });
    expect(requests[1][2]).toMatchObject({ model: requests[0][2].model, maxTokens: 12288 });
    expect(mockBlindResponse).toHaveBeenCalledTimes(1);
    expect(mockTeachingCriticResponse).toHaveBeenCalled();
    expect(mockTeachingResponse).toHaveBeenCalled();
    expect(mockScriptCreate.mock.calls[0][0].data.turns).toEqual(SAMPLE_SCRIPT_RESULT.turns);
    expect(mockLessonQuestionCreateMany.mock.calls[0][0].data).toHaveLength(4);
    expect(mockCreateSegmentsAndQueueAudio.mock.calls[0][1]).toEqual(SAMPLE_SCRIPT_RESULT.turns);
  });

  it('retains both exact rejected candidates and stops after a second marker failure', async () => {
    useScripts([ambiguous, missing]);
    const error = await failure();
    expect(error).toBeInstanceOf(ScriptOutputProtocolError);
    expect(captureGenerationFailure(error)).toMatchObject({
      category: 'generation_failed',
      attemptFailures: [
        {
          attempt: 1,
          type: 'structure',
          candidate: ambiguous,
          issues: [{ code: 'script_vocabulary_ambiguous_identity' }],
        },
        {
          attempt: 2,
          type: 'structure',
          candidate: missing,
          issues: [{ code: 'script_vocabulary_missing_identity' }],
        },
      ],
    });
    expect(scriptRequests()).toHaveLength(2);
    expect(mockBlindResponse).not.toHaveBeenCalled();
    expectUnpublished();
    expect(JSON.stringify(error)).not.toContain('gegangen');
  });

  it('keeps semantic and subsequent marker failures in order without a third script', async () => {
    useScripts([valid, ambiguous]);
    mockBlindResponse.mockResolvedValue({ content: JSON.stringify(rejected), model: 'm' });
    const error = await failure();
    expect(error).toBeInstanceOf(ScriptOutputProtocolError);
    expect(captureGenerationFailure(error).attemptFailures).toMatchObject([
      { attempt: 1, type: 'teaching' },
      { attempt: 2, type: 'structure', candidate: ambiguous },
    ]);
    expect(scriptRequests()).toHaveLength(2);
    expectUnpublished();
  });

  it('does not grant a semantic replacement after the marker replacement is rejected', async () => {
    mockBlindResponse.mockResolvedValue({ content: JSON.stringify(rejected), model: 'm' });
    const error = await failure();
    expect(error).toBeInstanceOf(SectionQualityError);
    expect(captureGenerationFailure(error).attemptFailures).toMatchObject([
      { attempt: 1, type: 'structure', candidate: ambiguous },
      { attempt: 2, type: 'teaching' },
    ]);
    expect(scriptRequests()).toHaveLength(2);
    expectUnpublished();
  });

  it('does not grant another quiz replacement after marker correction', async () => {
    let scripts = 0;
    mockGenerateResponse.mockImplementation(async (...args) => ({
      content: args[2].maxTokens === 12288 ? [ambiguous, valid][scripts++] : '{',
      model: 'm',
    }));
    const error = await failure();
    expect(captureGenerationFailure(error).attemptFailures).toMatchObject([
      { attempt: 1, type: 'structure', candidate: ambiguous },
      { attempt: 2, type: 'structure', candidate: '{', issues: [{ code: 'invalid_json' }] },
    ]);
    expect(scriptRequests()).toHaveLength(2);
    expectUnpublished();
  });

  it('omits oversized raw output and fails without truncation or replacement', async () => {
    useScripts([candidate('私'.repeat(12000) + '[V1:gegangen]')]);
    const error = await failure();
    expect(captureGenerationFailure(error).attemptFailures).toEqual([
      {
        attempt: 1,
        type: 'structure',
        kind: 'listening',
        candidate: null,
        omitted: 'size_limit',
        issues: [{ code: 'script_vocabulary_ambiguous_identity' }],
      },
    ]);
    expect(scriptRequests()).toHaveLength(1);
    expectUnpublished();
  });

  it.each([
    new Error('Script vocabulary marker has an ambiguous entry identity.'),
    new ScriptOutputProtocolError('script_vocabulary_ambiguous_identity'),
    Object.assign(new ScriptOutputProtocolError('script_vocabulary_missing_identity'), {
      candidate: missing,
    }),
    new DOMException('Cancelled', 'AbortError'),
    new Error('Provider unavailable'),
  ])('never repairs provider or unauthenticated errors (%s)', async (error) => {
    useScripts([error]);
    expect(await failure()).toBe(error);
    expect(scriptOutputProtocolFailure(error)).toBeUndefined();
    expect(captureGenerationFailure(error).attemptFailures).toBeUndefined();
    expect(scriptRequests()).toHaveLength(1);
    expectUnpublished();
  });

  it('keeps unrelated script schema failures terminal', async () => {
    useScripts([JSON.stringify({ turns: [{ speaker: 'HOST', text: 42 }] })]);
    const error = await failure();
    expect(scriptOutputProtocolFailure(error)).toBeUndefined();
    expect(scriptRequests()).toHaveLength(1);
    expectUnpublished();
  });

  it.each([new Error('Provider unavailable'), new DOMException('Cancelled', 'AbortError')])(
    'preserves the marker failure when replacement transport fails (%s)',
    async (error) => {
      useScripts([ambiguous, error]);
      expect(await failure()).toBe(error);
      expect(captureGenerationFailure(error).attemptFailures).toMatchObject([
        { attempt: 1, type: 'structure', candidate: ambiguous },
      ]);
      expect(scriptRequests()).toHaveLength(2);
      expectUnpublished();
    }
  );

  it('keeps malformed teaching reviewer output terminal after a valid marker replacement', async () => {
    mockTeachingCriticResponse.mockResolvedValue({ content: '{}', model: 'm' });
    const error = await failure();
    expect(captureGenerationFailure(error)).toMatchObject({
      category: 'review_protocol',
      attemptFailures: [{ attempt: 1, type: 'structure' }],
    });
    expect(scriptRequests()).toHaveLength(2);
    expectUnpublished();
  });

  it('publishes an initially valid script without consuming a replacement', async () => {
    useScripts([valid]);
    mockBlindResponse.mockResolvedValue({ content: JSON.stringify(approved), model: 'm' });
    await generateClassListening(PARAMS);
    expect(scriptRequests()).toHaveLength(1);
    expect(mockScriptCreate.mock.calls[0][0].data.turns).toEqual(SAMPLE_SCRIPT_RESULT.turns);
  });
});
