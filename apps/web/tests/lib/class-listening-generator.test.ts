import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SourceDocuments } from '@/lib/providers/ai';
import { sampleTeaching } from '../helpers/learning/class-teaching';
import {
  mockEpisodeCreate,
  mockEpisodeUpdate,
  mockEpisodeUpdateMany,
  mockScriptCreate,
  mockVocabEntryCreateMany,
  mockLearnerVocabUpsert,
  mockClassSectionCreate,
  mockLessonQuestionCreateMany,
  mockUserFindUnique,
  mockClassAssessmentFind,
  mockGenerateScript,
  mockGetAiKey,
  mockGetAiProviderMeta,
  mockCreateSegmentsAndQueueAudio,
  mockBlindResponse,
  mockTeachingCriticResponse,
  mockTeachingResponse,
  mockLoadAndRender,
  mockGenerateResponse,
  mockLogUsage,
  mockGetConfiguredTtsProviderId,
  mockResolveTtsProvider,
  mockGetServerInfra,
  SAMPLE_TURNS,
  SAMPLE_VOCABULARY,
  SAMPLE_SCRIPT_RESULT,
  PARAMS,
  setupHappyPath,
} from '../helpers/runtime/listening-generation';

// ---- Import under test (must come AFTER vi.mock calls) ----

import {
  generateClassListening,
  prepareClassListening,
  queueListeningAudio,
} from '@/lib/class-listening-generator';
import { authorizedLearnerExecution } from '../helpers/runtime/provider-execution';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';
import { SectionQualityError } from '@/lib/classes/section-quality';
import { classListeningTranscriptPolicy } from '@/lib/classes/class-language-policy';
import { QuizRetryRepetitionError } from '@/lib/classes/quiz/retry';

describe('Listening audio admission', () => {
  it('does not admit audio after its episode is no longer ready', async () => {
    mockCreateSegmentsAndQueueAudio.mockImplementationOnce(async (_episode, _turns, options) => {
      await options.authorize({
        $queryRaw: async (query: TemplateStringsArray) =>
          query.join('').includes('FROM "Episode"') ? [{ id: 'episode-1' }] : [],
        episode: { findFirst: async () => null },
      });
    });
    await expect(
      queueListeningAudio(
        { episodeId: 'episode-1', turns: SAMPLE_TURNS, comprehensionQuestions: [] },
        authorizedLearnerExecution('u1'),
        { practiceSessionId: 'practice-1' }
      )
    ).rejects.toThrow('Listening audio source changed before admission');
  });

  it('rejects audio when the saved script differs from the reviewed turns', async () => {
    mockCreateSegmentsAndQueueAudio.mockImplementationOnce(async (_episode, _turns, options) => {
      await options.authorize({
        $queryRaw: async (query: TemplateStringsArray) =>
          query.join('').includes('FROM "Episode"') ? [{ id: 'episode-1' }] : [],
        episode: {
          findFirst: async () => ({ script: { turns: [{ speaker: 'A', text: 'Changed' }] } }),
        },
      });
    });
    await expect(
      queueListeningAudio(
        { episodeId: 'episode-1', turns: SAMPLE_TURNS, comprehensionQuestions: [] },
        authorizedLearnerExecution('u1'),
        { practiceSessionId: 'practice-1' }
      )
    ).rejects.toThrow('Listening audio source changed before admission');
  });

  it('does not queue an unreviewed copy when a first-A1 receipt is required', async () => {
    await expect(
      queueListeningAudio(
        { episodeId: 'episode-1', turns: SAMPLE_TURNS, comprehensionQuestions: [] },
        authorizedLearnerExecution('u1'),
        { classId: 'class-1', attempt: 1, requireInitialA1Proof: true }
      )
    ).rejects.toThrow('listening review is missing');
  });
  it('rejects obsolete class audio inside admission while preserving the saved episode', async () => {
    const generation = { status: 'GENERATING', attempt: 3, course: { userId: 'u1' } };
    mockCreateSegmentsAndQueueAudio.mockImplementationOnce(async (_episode, _turns, options) => {
      await options.onPrepared(
        {
          $queryRaw: async () => [],
          courseClass: { findUnique: async () => generation },
        },
        'saved-audio-key'
      );
    });
    await expect(
      queueListeningAudio(
        {
          episodeId: 'episode-1',
          turns: SAMPLE_TURNS,
          comprehensionQuestions: [],
        },
        authorizedLearnerExecution('u1'),
        { classId: 'class-1', attempt: 2 }
      )
    ).rejects.toThrow('cancelled');
  });
});
// ---- Tests ----

describe('generateClassListening', () => {
  it('does not create an episode for an obsolete class generation attempt', async () => {
    setupHappyPath();
    await expect(prepareClassListening({ ...PARAMS, attempt: 2 })).rejects.toThrow('cancelled');
    expect(mockEpisodeCreate).not.toHaveBeenCalled();
    expect(mockGenerateScript).not.toHaveBeenCalled();
  });

  it('rejects a first-A1 script changed while the blind reviewer is running', async () => {
    setupHappyPath();
    const script = structuredClone(SAMPLE_SCRIPT_RESULT);
    mockGenerateScript.mockResolvedValue(script);
    mockBlindResponse.mockImplementationOnce(async () => {
      script.turns[0]!.text = 'Changed during review';
      return {
        model: 'm',
        content: JSON.stringify({
          passageFindings: [],
          issues: [],
          questions: [0, 2, 0, 2].map((key, index) => ({
            index,
            acceptableOptionIndices: [key],
            issues: [],
          })),
        }),
      };
    });
    await expect(
      prepareClassListening({
        ...PARAMS,
        execution: { ...PARAMS.execution, initialA1Class: true },
        teaching: structuredClone(sampleTeaching),
        requireInitialA1Proof: true,
      })
    ).rejects.toThrow('listening review is no longer valid');
    expect(mockScriptCreate).not.toHaveBeenCalled();
    expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
  });
  it('replaces an initially repeated quiz with fresh reviewed listening questions', async () => {
    setupHappyPath();
    const replacement = [
      {
        question: 'Which greeting opens the conversation?',
        options: ['Hola', 'Adiós', 'Gracias', 'Por favor'],
        correctIndex: 0,
        explanation: 'Hola opens the conversation.',
      },
      {
        question: 'What are the speakers doing?',
        options: ['Writing', 'Reading', 'Listening', 'Speaking'],
        correctIndex: 2,
        explanation: 'This is listening practice.',
      },
      {
        question: 'Who introduces the conversation?',
        options: ['HOST', 'EXPERT', 'NARRATOR', 'GUEST'],
        correctIndex: 0,
        explanation: 'The host introduces the scene.',
      },
      {
        question: 'Which topic do the speakers discuss?',
        options: ['Weather', 'Numbers', 'Greetings', 'Food'],
        correctIndex: 2,
        explanation: 'They discuss greetings.',
      },
    ];
    mockGenerateResponse
      .mockResolvedValueOnce({
        content: JSON.stringify({
          questions: [
            { ...replacement[0], question: 'What does "hola" mean?' },
            ...replacement.slice(1),
          ],
        }),
        model: 'm',
      })
      .mockResolvedValue({ content: JSON.stringify({ questions: replacement }), model: 'm' });
    await generateClassListening({
      ...PARAMS,
      retry: {
        previousQuestions: [
          { question: 'What does "hola" mean?', options: ['hello', 'goodbye', 'please', 'thanks'] },
        ],
        missedQuestions: [],
      },
    });
    const saved = mockLessonQuestionCreateMany.mock.calls[0][0].data;
    expect(saved).toEqual(
      expect.arrayContaining([expect.objectContaining({ question: replacement[0].question })])
    );
    expect(
      saved.some((question: { question: string }) => question.question === 'What does "hola" mean?')
    ).toBe(false);
    expect(mockGenerateResponse.mock.calls[1][0]).toContain('previous candidate repeated');
  });

  it('refuses repeated listening questions before publishing a replacement or starting audio', async () => {
    setupHappyPath();
    await expect(
      generateClassListening({
        ...PARAMS,
        retry: {
          previousQuestions: [
            {
              question: 'What does "hola" mean?',
              options: ['hello', 'goodbye', 'please', 'thanks'],
            },
          ],
          missedQuestions: [
            {
              question: 'What does "hola" mean?',
              selectedAnswer: 'goodbye',
              explanation: 'Review greetings.',
            },
          ],
        },
      })
    ).rejects.toBeInstanceOf(QuizRetryRepetitionError);
    expect(mockClassSectionCreate).not.toHaveBeenCalled();
    expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    expect(mockEpisodeUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'episode-1', userId: 'u1', audioGenerationKey: null }),
      data: { status: 'FAILED' },
    });
  });

  it('uses missed listening concepts to prepare a fresh reviewed exercise', async () => {
    setupHappyPath();
    const result = await generateClassListening({
      ...PARAMS,
      retry: {
        previousQuestions: [
          { question: 'Which greeting did Ana use yesterday?', options: ['Hola', 'Adiós'] },
        ],
        missedQuestions: [
          {
            question: 'Which greeting did Ana use yesterday?',
            selectedAnswer: 'Adiós',
            explanation: 'Review greetings.',
          },
        ],
      },
    });
    expect(result).toMatchObject({ sectionId: 'section-1', episodeId: 'episode-1' });
    expect(mockLessonQuestionCreateMany.mock.calls[0][0].data).toEqual(
      expect.arrayContaining([expect.objectContaining({ question: 'What does "hola" mean?' })])
    );
    expect(mockGenerateResponse.mock.calls[0][0]).toContain('Review greetings.');
    expect(mockGenerateScript.mock.calls[0][0].focusAreas.join(' ')).toContain('Review greetings.');
  });

  it('blocks default listening while speech is disabled even with a configured cloud provider', async () => {
    setupHappyPath();
    mockGetConfiguredTtsProviderId.mockReturnValue('cartesia');
    mockUserFindUnique.mockResolvedValue({
      preferredTtsProvider: 'disabled',
      preferredTtsModel: null,
    });
    await expect(generateClassListening(PARAMS)).rejects.toThrow(/disabled/);
    expect(mockEpisodeCreate).not.toHaveBeenCalled();
    expect(mockResolveTtsProvider).not.toHaveBeenCalled();
  });

  it('pins the personal local provider and custom model before listening audio generation', async () => {
    setupHappyPath();
    mockGetConfiguredTtsProviderId.mockReturnValue('cartesia');
    mockUserFindUnique.mockResolvedValue({
      preferredTtsProvider: 'local',
      preferredTtsModel: 'piper-de',
    });
    mockResolveTtsProvider.mockResolvedValue({
      providerId: 'local',
      provider: { getModelId: () => 'piper-de' },
    });
    await generateClassListening(PARAMS);
    expect(mockEpisodeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ttsProvider: 'local',
          ttsModel: 'piper-de',
        }),
      })
    );
  });

  it('keeps an explicit listening provider authoritative over the personal local preference', async () => {
    setupHappyPath();
    mockUserFindUnique.mockResolvedValue({
      preferredTtsProvider: 'local',
      preferredTtsModel: 'piper-de',
    });
    await generateClassListening({ ...PARAMS, ttsProvider: 'cartesia' });
    expect(mockEpisodeCreate.mock.calls[0][0].data.ttsProvider).toBe('cartesia');
  });

  it('rejects malformed blind review before publishing listening questions', async () => {
    setupHappyPath();
    mockBlindResponse.mockResolvedValue({ content: '{"questions":[]}', model: 'm' });
    const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(SectionQualityError);
    const failure = captureGenerationFailure(error);
    expect(failure.teachingFailure).toBeUndefined();
    expect(failure.protocolEvidence).toMatchObject([
      { kind: 'listening', role: 'blind_section', reason: 'schema', pathCodes: ['response'] },
    ]);
    expect(JSON.parse(failure.protocolEvidence![0].payload.json!).response).toBe(
      '{"questions":[]}'
    );
    expect(mockClassSectionCreate).not.toHaveBeenCalled();
    expect(mockEpisodeUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'episode-1', userId: 'u1', audioGenerationKey: null }),
      data: { status: 'FAILED' },
    });
  });

  it('renders with the captured personal TTS selection instead of the instance default', async () => {
    setupHappyPath();
    await generateClassListening({ ...PARAMS, ttsProvider: 'cartesia' });
    expect(mockEpisodeCreate.mock.calls[0][0].data.ttsProvider).toBe('cartesia');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ preferredTtsModel: null });
  });

  describe('happy path', () => {
    it('supplies original PDFs to the script author while preserving restricted quiz and review inputs', async () => {
      setupHappyPath();
      const sourceDocuments: SourceDocuments = {
        parts: [
          {
            type: 'document',
            mediaType: 'application/pdf',
            name: 'Workbook.pdf',
            data: Buffer.from('%PDF-1.7'),
          },
        ],
        validate: async () => {},
      };
      await generateClassListening({
        ...PARAMS,
        execution: { ...PARAMS.execution, sourceDocuments },
      });
      expect(mockGenerateScript.mock.calls[0][0].sourceDocuments).toBe(sourceDocuments);
      for (const request of mockGenerateResponse.mock.calls)
        expect(request[2]?.sourceDocuments).toBeUndefined();
    });
    it('pins the admin model when listening audio is deferred for learner review', async () => {
      setupHappyPath();
      await generateClassListening({ ...PARAMS, deferAudio: true });
      expect(mockEpisodeCreate.mock.calls[0][0].data).toMatchObject({
        ttsProvider: 'kokoro',
        ttsModel: 'kokoro',
      });
    });
    it('prepares scheduled listening without requiring a speech provider or starting audio jobs', async () => {
      setupHappyPath();
      mockGetConfiguredTtsProviderId.mockReturnValue(null);
      mockResolveTtsProvider.mockRejectedValue(new Error('No speech credential configured'));
      mockCreateSegmentsAndQueueAudio.mockRejectedValue(
        new Error('Audio must await learner review')
      );
      const result = await generateClassListening({ ...PARAMS, deferAudio: true });
      expect(result).toEqual({ sectionId: 'section-1', episodeId: 'episode-1' });
      expect(mockEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-1' },
        data: { status: 'SCRIPT_READY' },
      });
    });

    it('returns { sectionId, episodeId } on success', async () => {
      setupHappyPath();

      const result = await generateClassListening(PARAMS);

      expect(result).toEqual({ sectionId: 'section-1', episodeId: 'episode-1' });
    });

    it('creates a CLASS-source PRIVATE episode for the user', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockGetServerInfra).toHaveBeenCalledOnce();
      expect(mockGetServerInfra.mock.invocationCallOrder[0]).toBeLessThan(
        mockGetConfiguredTtsProviderId.mock.invocationCallOrder[0]
      );
      expect(mockEpisodeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            source: 'CLASS',
            visibility: 'PRIVATE',
            language: 'es',
            status: 'PENDING',
          }),
        })
      );
    });

    it('seeds the CLASS episode with the configured local TTS provider (TTS_PROVIDER=kokoro)', async () => {
      setupHappyPath();
      mockGetConfiguredTtsProviderId.mockReturnValue('kokoro');

      await generateClassListening(PARAMS);

      expect(mockEpisodeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ttsProvider: 'kokoro' }),
        })
      );
    });

    it('calls generateScript with targetLanguage, conversational_mix and forLearning', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockGenerateScript).toHaveBeenCalledWith(
        expect.objectContaining({
          targetLanguage: 'es',
          languageMode: 'conversational_mix',
          forLearning: true,
          learningNativeLanguage: PARAMS.nativeLang,
          mustIncludeVocabulary: PARAMS.mustIncludeVocab,
        })
      );
    });

    it('persists the reviewed script and vocabulary', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockScriptCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            episodeId: 'episode-1',
            turns: SAMPLE_TURNS,
            markdown: SAMPLE_SCRIPT_RESULT.markdown,
          }),
        })
      );
      expect(mockVocabEntryCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ episodeId: 'episode-1', word: 'hola', translation: 'hello' }),
            expect.objectContaining({
              episodeId: 'episode-1',
              word: 'gracias',
              translation: 'thank you',
            }),
          ]),
        })
      );
    });

    it('shares the supported listening task while preserving annotated turns for persistence and audio', async () => {
      setupHappyPath();
      const { loadAndRender } =
        await vi.importActual<typeof import('@/lib/prompt-loader')>('@/lib/prompt-loader');
      mockLoadAndRender.mockImplementation(loadAndRender);
      const turns = [
        {
          speaker: 'HOST',
          text: '[V1:hola], estos verbos usan «haber» en el pretérito perfecto. Aquí «hablado» es una forma de «hablar», no el infinitivo. [1] [SFX: intro]',
        },
      ];
      mockGenerateScript.mockResolvedValue({ ...SAMPLE_SCRIPT_RESULT, turns });

      await generateClassListening(PARAMS);

      const blindInput = JSON.parse(mockBlindResponse.mock.calls[0][1][0].content);
      const teachingInput = JSON.parse(mockTeachingResponse.mock.calls[0][1][0].content);
      const policy = classListeningTranscriptPolicy(PARAMS);
      for (const reviewer of [
        mockBlindResponse,
        mockTeachingCriticResponse,
        mockTeachingResponse,
      ]) {
        expect(reviewer.mock.calls[0][0]).toContain(policy);
        expect(reviewer.mock.calls[0][0]).toContain('learners can pause and replay the audio');
        expect(reviewer.mock.calls[0][0]).toContain(
          'multiple-choice questions are visible before answering'
        );
        expect(reviewer.mock.calls[0][0]).toContain('Do not assume a learner-visible transcript');
        expect(reviewer.mock.calls[0][0]).toContain(
          'actual audio delivery requires separate verification'
        );
        expect(reviewer.mock.calls[0][0]).toContain('Cite the actual wording or dependency');
      }
      expect(blindInput.passage).toBe(
        'HOST: hola, estos verbos usan «haber» en el pretérito perfecto. Aquí «hablado» es una forma de «hablar», no el infinitivo.'
      );
      expect(
        teachingInput.items.map(
          (item: { content: { passageText: string } }) => item.content.passageText
        )
      ).toEqual([blindInput.passage, undefined, undefined, undefined, undefined]);
      expect(mockScriptCreate.mock.calls[0][0].data.turns).toEqual(turns);
      expect(mockCreateSegmentsAndQueueAudio.mock.calls[0][1]).toEqual(turns);
    });

    it('calls createSegmentsAndQueueAudio with episodeId and the turns', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockCreateSegmentsAndQueueAudio).toHaveBeenCalledWith(
        'episode-1',
        SAMPLE_TURNS,
        expect.objectContaining({ authorize: expect.any(Function) })
      );
    });

    it('keeps composed audio unqueued until the class association and questions persist', async () => {
      setupHappyPath();
      let associationPersisted = false;
      let questionsPersisted = false;
      mockClassSectionCreate.mockImplementationOnce(async () => {
        associationPersisted = true;
        return { id: 'section-1' };
      });
      mockLessonQuestionCreateMany.mockImplementationOnce(async () => {
        questionsPersisted = true;
        return { count: 4 };
      });
      mockCreateSegmentsAndQueueAudio.mockImplementationOnce(async () => {
        if (!associationPersisted || !questionsPersisted)
          throw new Error('Unpublished learning association');
      });
      await generateClassListening(PARAMS);
      expect(mockEpisodeUpdate).toHaveBeenCalledWith({
        where: { id: 'episode-1' },
        data: { status: 'SCRIPT_READY' },
      });
    });

    it('does not admit audio when persisting the class questions fails', async () => {
      setupHappyPath();
      mockLessonQuestionCreateMany.mockRejectedValueOnce(new Error('Question persistence failed'));
      await expect(generateClassListening(PARAMS)).rejects.toThrow('Question persistence failed');
      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });

    it('retires an unqueued episode if assessment scope cannot be loaded', async () => {
      setupHappyPath();
      mockClassAssessmentFind.mockRejectedValueOnce(new Error('Assessment scope unavailable'));
      await expect(prepareClassListening(PARAMS)).rejects.toThrow('Assessment scope unavailable');
      expect(mockEpisodeUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'episode-1',
          userId: PARAMS.userId,
          source: 'CLASS',
          status: 'SCRIPT_READY',
          audioGenerationKey: null,
        },
        data: { status: 'FAILED', failureReason: expect.any(String) },
      });
      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });

    it('prepares a class script and questions without admitting audio', async () => {
      setupHappyPath();
      const prepared = await prepareClassListening(PARAMS);
      expect(prepared).toMatchObject({
        sectionId: 'section-1',
        episodeId: 'episode-1',
        content: { turns: SAMPLE_TURNS },
      });
      expect(mockClassSectionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'READY' }) })
      );
      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });

    it('marks a prepared episode failed when admitting its audio fails', async () => {
      setupHappyPath();
      mockCreateSegmentsAndQueueAudio.mockRejectedValueOnce(new Error('Audio admission failed'));
      await expect(generateClassListening(PARAMS)).rejects.toThrow('Audio admission failed');
      expect(mockEpisodeUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'episode-1',
          userId: PARAMS.userId,
          source: 'CLASS',
          status: 'SCRIPT_READY',
          audioGenerationKey: null,
        },
        data: {
          status: 'FAILED',
          failureReason: expect.stringContaining('Audio generation did not start'),
        },
      });
    });

    it('retains episode vocabulary without adding unseen course memory before class publication', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockLearnerVocabUpsert).not.toHaveBeenCalled();
      expect(
        mockVocabEntryCreateMany.mock.calls[0][0].data.map((entry: { word: string }) => entry.word)
      ).toEqual(SAMPLE_VOCABULARY.map(({ word }) => word));
    });

    it('creates a LISTENING ClassSection with the episodeId and status READY', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockClassSectionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            classId: 'class-1',
            skill: 'LISTENING',
            status: 'READY',
            episodeId: 'episode-1',
            spec: expect.objectContaining({ scriptHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
          }),
        })
      );
    });

    it('creates LessonQuestion rows for the generated comprehension questions', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockLessonQuestionCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              sectionId: 'section-1',
              skill: 'LISTENING',
              order: 1,
              question: 'What does "hola" mean?',
              correctIndex: 0,
            }),
          ]),
        })
      );
    });

    it('logs usage for both script and quiz generation steps', async () => {
      setupHappyPath();

      await generateClassListening(PARAMS);

      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'class-listening-script',
          userId: 'u1',
          episodeId: 'episode-1',
        })
      );
      expect(mockLogUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'class-listening-quiz',
          userId: 'u1',
          episodeId: 'episode-1',
        })
      );
    });
  });

  describe('error paths', () => {
    it('fails before generating a script or queuing audio when the selected credential is unavailable', async () => {
      setupHappyPath();
      mockResolveTtsProvider.mockRejectedValue(new Error('No API key available for cartesia.'));
      await expect(generateClassListening(PARAMS)).rejects.toThrow(/No API key available/);
      expect(mockEpisodeCreate).not.toHaveBeenCalled();
      expect(mockGenerateScript).not.toHaveBeenCalled();
      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });

    it('keeps AI audio opt-in when no speech provider is selected', async () => {
      setupHappyPath();
      mockGetConfiguredTtsProviderId.mockReturnValue(null);
      await expect(generateClassListening(PARAMS)).rejects.toThrow(/not enabled/);
      expect(mockEpisodeCreate).not.toHaveBeenCalled();
      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    });
    it('throws when there is no BYOK key and no local agent configured', async () => {
      mockGetAiKey.mockResolvedValue(null);
      const prev = process.env.AI_PROVIDER;
      process.env.AI_PROVIDER = '';
      try {
        await expect(generateClassListening(PARAMS)).rejects.toThrow(/AI provider/i);
      } finally {
        process.env.AI_PROVIDER = prev;
      }
    });

    it('throws when the provider has no default model', async () => {
      mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
      mockGetAiProviderMeta.mockReturnValue({ defaultModel: null });

      await expect(generateClassListening(PARAMS)).rejects.toThrow(/No default AI model/);
    });

    it('marks episode FAILED and re-throws when generateScript throws', async () => {
      setupHappyPath();
      mockGetAiKey.mockResolvedValue({ provider: 'anthropic', apiKey: 'k' });
      mockGetAiProviderMeta.mockReturnValue({ defaultModel: 'm' });
      mockEpisodeCreate.mockResolvedValue({
        id: 'episode-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      mockEpisodeUpdate.mockResolvedValue({});
      mockGenerateScript.mockRejectedValue(new Error('AI timeout'));

      await expect(generateClassListening(PARAMS)).rejects.toThrow('AI timeout');
      expect(mockEpisodeUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'episode-1',
            userId: 'u1',
            audioGenerationKey: null,
          }),
          data: { status: 'FAILED' },
        })
      );
    });

    it('retains both malformed quizzes without publishing an incomplete listening section', async () => {
      setupHappyPath();
      mockGenerateResponse.mockResolvedValue({
        content: 'not json at all',
        inputTokens: 10,
        outputTokens: 10,
        model: 'm',
      });

      const error = await generateClassListening(PARAMS).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      const attempts = captureGenerationFailure(error).attemptFailures;
      expect(
        attempts?.map((attempt) => ({ attempt: attempt.attempt, type: attempt.type }))
      ).toEqual([
        { attempt: 1, type: 'structure' },
        { attempt: 2, type: 'structure' },
      ]);
      expect(
        attempts?.every(
          (attempt) => attempt.type === 'structure' && attempt.candidate === 'not json at all'
        )
      ).toBe(true);
      expect(mockClassSectionCreate).not.toHaveBeenCalled();
      // Episode should be marked FAILED on error
      expect(mockEpisodeUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } })
      );
    });

    it('throws when quiz response produces no usable questions', async () => {
      setupHappyPath();
      // Valid JSON but no properly-shaped entries
      mockGenerateResponse.mockResolvedValue({
        content: JSON.stringify([{ question: 42, options: 'nope', correctIndex: 'x' }]),
        inputTokens: 10,
        outputTokens: 10,
        model: 'm',
      });

      await expect(generateClassListening(PARAMS)).rejects.toThrow(/valid questions/);
    });
  });

  describe('vocabulary edge cases', () => {
    it('skips vocabulary persistence when the result has no vocabulary array', async () => {
      setupHappyPath();
      mockGenerateScript.mockResolvedValue({ ...SAMPLE_SCRIPT_RESULT, vocabulary: [] });

      await generateClassListening(PARAMS);

      // createMany should not be called when vocabulary is empty
      expect(mockVocabEntryCreateMany).not.toHaveBeenCalled();
      expect(mockLearnerVocabUpsert).not.toHaveBeenCalled();
    });

    it('keeps class vocabulary out of course memory until publication even with an empty entry', async () => {
      setupHappyPath();
      mockGenerateScript.mockResolvedValue({
        ...SAMPLE_SCRIPT_RESULT,
        vocabulary: [
          { ...SAMPLE_VOCABULARY[0], word: '' }, // falsy — should be skipped
          SAMPLE_VOCABULARY[1],
        ],
      });

      await generateClassListening(PARAMS);

      expect(mockLearnerVocabUpsert).not.toHaveBeenCalled();
    });
  });
});
