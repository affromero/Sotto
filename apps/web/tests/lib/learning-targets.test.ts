import {
  authorizedLearnerExecution,
  blockedProviderExecution,
} from '../helpers/runtime/provider-execution';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCourseFindFirst = vi.fn();
const mockLearnerVocabUpsert = vi.fn();
const mockLearnerFocusTargetUpsert = vi.fn();
const mockLearnerFocusTargetFindFirst = vi.fn();
const mockLearnerFocusTargetUpdate = vi.fn();
const mockUploadFile = vi.fn();
const mockWriteStorageReference = vi.fn();
const mockGetAutoModelConfig = vi.fn();
const mockGetConfiguredTtsProviderId = vi.fn();
const mockResolveTtsProvider = vi.fn();
const mockGetVisualCueKey = vi.fn();
const mockReadStorageReference = vi.fn();
const mockRetireStorageReference = vi.fn();

vi.mock('thesidedoor-core/storage', async (original) => ({
  ...(await original<typeof import('thesidedoor-core/storage')>()),
  StorageReferenceRegistry: class {
    readReference = mockReadStorageReference;
    retire = mockRetireStorageReference;
  },
}));
vi.mock('@/lib/sidedoor/access/state/write-transaction', () => ({
  sottoStateWriteTransaction: (
    database: unknown,
    operation: (tx: unknown) => unknown,
    signal: AbortSignal
  ) => {
    signal.throwIfAborted();
    return operation(database);
  },
}));
vi.mock('@/lib/sidedoor/access/avatar/url', () => ({
  requireExternalAvatarUrl: vi.fn(),
  ManagedAvatarUrlError: class extends Error {},
}));

vi.mock('@/lib/prisma', () => {
  const database = {
    course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) },
    learnerVocab: { upsert: (...a: unknown[]) => mockLearnerVocabUpsert(...a) },
    learnerFocusTarget: {
      upsert: (...a: unknown[]) => mockLearnerFocusTargetUpsert(...a),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findFirst: (...a: unknown[]) => mockLearnerFocusTargetFindFirst(...a),
      update: (...a: unknown[]) => mockLearnerFocusTargetUpdate(...a),
    },
  };
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/r2', () => ({
  uploadFile: (...a: unknown[]) => mockUploadFile(...a),
}));
vi.mock('@/lib/sidedoor/storage/core/storage-write', () => ({
  writeStorageReference: (...a: unknown[]) => mockWriteStorageReference(...a),
}));
vi.mock('@/lib/sidedoor/storage/core/focus-target-storage', () => ({
  captureFocusTargetStorage: vi.fn(),
}));
vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...a: unknown[]) => mockGetAutoModelConfig(...a),
}));
vi.mock('@/lib/providers/tts', async (importOriginal) => ({
  selectTtsProviderId: (await importOriginal<typeof import('@/lib/providers/tts')>())
    .selectTtsProviderId,
  isSpeechDisabled: (await importOriginal<typeof import('@/lib/providers/tts')>()).isSpeechDisabled,
  getConfiguredTtsProviderId: (...a: unknown[]) => mockGetConfiguredTtsProviderId(...a),
  resolveTtsProvider: (...a: unknown[]) => mockResolveTtsProvider(...a),
}));
vi.mock('@/lib/visual-cue-keys', () => ({
  getVisualCueKey: (...a: unknown[]) => mockGetVisualCueKey(...a),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  addLearningTarget,
  addVisualCue,
  generateTargetPronunciation,
  inferFocusTargetKind,
  normalizeLearningTargetText,
} from '@/lib/learning-targets';

const COURSE = {
  id: 'c1',
  userId: 'u1',
  nativeLang: 'en',
  targetLang: 'es',
  currentLevel: 'A2',
};

const TARGET_ROW = {
  id: 'ft1',
  courseId: 'c1',
  kind: 'PHRASE' as const,
  text: 'me cuesta',
  normalizedText: 'me cuesta',
  contextText: null,
  sourceType: 'CLASS' as const,
  sourceId: null,
  sourceLabel: null,
  userMarkedDifficulty: 4,
  priorityBoost: 0.47,
  visualCueUrl: null,
  visualCueAlt: null,
  visualCueAttribution: null,
  visualCueProvider: null,
  pronunciationAudioUrl: null,
  lastSelectedAt: new Date('2026-06-15T00:00:00.000Z'),
  lastPracticedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCourseFindFirst.mockResolvedValue(COURSE);
  mockLearnerVocabUpsert.mockResolvedValue({});
  mockGetConfiguredTtsProviderId.mockReturnValue(null);
  mockGetAutoModelConfig.mockResolvedValue({
    model: { ttsProvider: 'openai', ttsModel: 'tts-1-hd' },
  });
  mockGetVisualCueKey.mockResolvedValue(null);
  mockReadStorageReference.mockResolvedValue(null);
  mockLearnerFocusTargetUpsert.mockImplementation(async (arg: { create: object }) => ({
    ...TARGET_ROW,
    ...arg.create,
  }));
  mockLearnerFocusTargetFindFirst.mockResolvedValue({
    ...TARGET_ROW,
    course: {
      userId: 'u1',
      targetLang: 'es',
      user: { preferredTtsProvider: null, preferredTtsModel: null },
    },
  });
  mockLearnerFocusTargetUpdate.mockResolvedValue(TARGET_ROW);
  mockWriteStorageReference.mockResolvedValue('https://cdn.example/focus.mp3');
});

describe('learning target text handling', () => {
  it('normalizes selected text for stable deduplication', () => {
    expect(normalizeLearningTargetText('  ME   cuesta  ')).toBe('me cuesta');
  });

  it('infers word, phrase, and sentence targets', () => {
    expect(inferFocusTargetKind('hola')).toBe('WORD');
    expect(inferFocusTargetKind('me cuesta')).toBe('PHRASE');
    expect(inferFocusTargetKind('Me cuesta entenderlo.')).toBe('SENTENCE');
  });
});

describe('addVisualCue', () => {
  it('does not publish when the request is cancelled during the provider request', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        controller.abort(new Error('Request cancelled'));
        return {
          ok: true,
          json: async () => ({
            photos: [{ src: { landscape: 'https://images.pexels.com/new.jpg' } }],
          }),
        };
      })
    );
    mockGetVisualCueKey.mockResolvedValue('user-pexels-key');
    const execution = { ...authorizedLearnerExecution('u1'), signal: controller.signal };
    await expect(addVisualCue('c1', 'u1', 'ft1', execution)).rejects.toThrow('Request cancelled');
    expect(mockLearnerFocusTargetUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['https://unknown.example/image.jpg', null, false],
    ['https://images.pexels.com/new.jpg', null, false],
    ['https://images.pexels.com/old.jpg', 'pexels', true],
  ])(
    'handles a previous external cue %s according to its provenance',
    async (previous, provider, allowed) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            photos: [{ src: { landscape: 'https://images.pexels.com/new.jpg' } }],
          }),
        })
      );
      mockGetVisualCueKey.mockResolvedValue('user-pexels-key');
      mockLearnerFocusTargetFindFirst.mockResolvedValue({
        ...TARGET_ROW,
        visualCueUrl: previous,
        visualCueProvider: provider,
        course: { userId: 'u1' },
      });
      const update = addVisualCue('c1', 'u1', 'ft1', authorizedLearnerExecution('u1'));
      if (allowed) {
        await expect(update).resolves.toBeDefined();
        expect(mockLearnerFocusTargetUpdate).toHaveBeenCalled();
      } else {
        await expect(update).rejects.toThrow('Visual cue storage ownership needs recovery');
        expect(mockLearnerFocusTargetUpdate).not.toHaveBeenCalled();
      }
      expect(mockRetireStorageReference).not.toHaveBeenCalled();
    }
  );

  it('does not publish a provider response after learner access is revoked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          photos: [{ src: { landscape: 'https://images.pexels.com/new.jpg' } }],
        }),
      })
    );
    mockGetVisualCueKey.mockResolvedValue('user-pexels-key');
    const execution = {
      userId: 'u1',
      authorize: async () => {
        throw new Error('Access revoked');
      },
    };

    await expect(addVisualCue('c1', 'u1', 'ft1', execution)).rejects.toThrow('Access revoked');
    expect(mockLearnerFocusTargetUpdate).not.toHaveBeenCalled();
  });

  it('rejects provider images on an unexpected host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ photos: [{ src: { landscape: 'https://example.com/image.jpg' } }] }),
      })
    );
    mockGetVisualCueKey.mockResolvedValue('user-pexels-key');

    await expect(addVisualCue('c1', 'u1', 'ft1', authorizedLearnerExecution('u1'))).rejects.toThrow(
      'Visual cue provider returned an invalid image URL'
    );
    expect(mockLearnerFocusTargetUpdate).not.toHaveBeenCalled();
  });

  it('does not replace a visual cue changed while the provider was responding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          photos: [{ src: { landscape: 'https://images.pexels.com/new.jpg' } }],
        }),
      })
    );
    mockGetVisualCueKey.mockResolvedValue('user-pexels-key');
    const original = { ...TARGET_ROW, course: { userId: 'u1' } };
    mockLearnerFocusTargetFindFirst
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce({ ...original, visualCueUrl: 'https://images.pexels.com/other.jpg' });

    await expect(addVisualCue('c1', 'u1', 'ft1', authorizedLearnerExecution('u1'))).rejects.toThrow(
      'Learning target changed while fetching its visual cue'
    );
    expect(mockLearnerFocusTargetUpdate).not.toHaveBeenCalled();
  });

  it('uses the learner visual-cue key before env fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        photos: [
          {
            alt: 'learner looking at notes',
            photographer: 'Ana',
            photographer_url: 'https://pexels.example/ana',
            src: { landscape: 'https://images.pexels.com/photo.jpg' },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    mockGetVisualCueKey.mockResolvedValue('user-pexels-key');
    mockLearnerFocusTargetUpdate.mockResolvedValue({
      ...TARGET_ROW,
      visualCueUrl: 'https://images.pexels.com/photo.jpg',
      visualCueAlt: 'learner looking at notes',
      visualCueAttribution: 'Ana (https://pexels.example/ana)',
      visualCueProvider: 'pexels',
    });

    const target = await addVisualCue('c1', 'u1', 'ft1', authorizedLearnerExecution('u1'));

    expect(target.visualCueUrl).toBe('https://images.pexels.com/photo.jpg');
    expect(mockGetVisualCueKey).toHaveBeenCalledWith(
      'u1',
      'pexels',
      expect.objectContaining({ userId: 'u1' })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: { Authorization: 'user-pexels-key' },
      })
    );
  });
});

describe('generateTargetPronunciation', () => {
  it('reuses saved pronunciation without another provider request', async () => {
    mockLearnerFocusTargetFindFirst.mockResolvedValue({
      ...TARGET_ROW,
      pronunciationAudioUrl: 'learning-targets/ft1/saved.mp3',
      course: {
        userId: 'u1',
        targetLang: 'de',
        user: { preferredTtsProvider: 'local', preferredTtsModel: 'local' },
      },
    });
    const target = await generateTargetPronunciation(
      'c1',
      'u1',
      'ft1',
      blockedProviderExecution('u1')
    );
    expect(target.pronunciationAudioUrl).toBe('learning-targets/ft1/saved.mp3');
    expect(mockResolveTtsProvider).not.toHaveBeenCalled();
  });
  it('does not generate pronunciation through the cloud default when audio is explicitly disabled', async () => {
    mockGetConfiguredTtsProviderId.mockReturnValue('cartesia');
    mockLearnerFocusTargetFindFirst.mockResolvedValue({
      ...TARGET_ROW,
      course: {
        userId: 'u1',
        targetLang: 'de',
        user: { preferredTtsProvider: 'disabled', preferredTtsModel: null },
      },
    });
    await expect(
      generateTargetPronunciation('c1', 'u1', 'ft1', blockedProviderExecution('u1'))
    ).rejects.toThrow(/disabled/);
    expect(mockWriteStorageReference).not.toHaveBeenCalled();
    expect(mockResolveTtsProvider).not.toHaveBeenCalled();
  });

  it('uses the learner preferred TTS provider and model for pronunciation', async () => {
    mockGetConfiguredTtsProviderId.mockReturnValue('openai');
    const generateSpeech = vi.fn().mockResolvedValue(Buffer.from('mp3'));
    mockLearnerFocusTargetFindFirst.mockResolvedValue({
      ...TARGET_ROW,
      course: {
        userId: 'u1',
        targetLang: 'es',
        user: { preferredTtsProvider: 'cartesia', preferredTtsModel: 'sonic-2' },
      },
    });
    mockResolveTtsProvider.mockResolvedValue({
      provider: {
        getVoiceId: () => 'cartesia-voice',
        getModelId: () => 'sonic-2',
        generateSpeech,
      },
    });
    mockUploadFile.mockResolvedValue('https://cdn.example/focus.mp3');
    mockLearnerFocusTargetUpdate.mockResolvedValue({
      ...TARGET_ROW,
      pronunciationAudioUrl: 'https://cdn.example/focus.mp3',
    });

    const target = await generateTargetPronunciation(
      'c1',
      'u1',
      'ft1',
      blockedProviderExecution('u1')
    );

    expect(target.pronunciationAudioUrl).toBe('https://cdn.example/focus.mp3');
    expect(mockResolveTtsProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedProvider: 'cartesia',
        requestedModel: 'sonic-2',
        language: 'es',
      })
    );
    expect(generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'me cuesta',
        voiceId: 'cartesia-voice',
        modelId: 'sonic-2',
        language: 'es',
      })
    );
  });

  it('uses the server TTS provider and model when the learner has no provider preference', async () => {
    const generateSpeech = vi.fn().mockResolvedValue(Buffer.from('mp3'));
    mockGetConfiguredTtsProviderId.mockReturnValue('openai');
    mockLearnerFocusTargetFindFirst.mockResolvedValue({
      ...TARGET_ROW,
      course: {
        userId: 'u1',
        targetLang: 'es',
        user: { preferredTtsProvider: null, preferredTtsModel: 'tts-1-hd' },
      },
    });
    mockResolveTtsProvider.mockResolvedValue({
      provider: {
        getVoiceId: () => 'openai-voice',
        getModelId: () => 'tts-1-hd',
        generateSpeech,
      },
    });
    mockUploadFile.mockResolvedValue('https://cdn.example/focus.mp3');
    mockLearnerFocusTargetUpdate.mockResolvedValue({
      ...TARGET_ROW,
      pronunciationAudioUrl: 'https://cdn.example/focus.mp3',
    });

    const target = await generateTargetPronunciation(
      'c1',
      'u1',
      'ft1',
      blockedProviderExecution('u1')
    );

    expect(target.pronunciationAudioUrl).toBe('https://cdn.example/focus.mp3');
    expect(mockResolveTtsProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedProvider: 'openai',
        requestedModel: 'tts-1-hd',
        language: 'es',
      })
    );
  });
});

describe('addLearningTarget', () => {
  it('stores phrase targets and makes them schedulable without adding a translation', async () => {
    const target = await addLearningTarget('c1', 'u1', {
      text: 'me cuesta',
      sourceType: 'CLASS',
      userMarkedDifficulty: 4,
    });

    expect(target).toMatchObject({ id: 'ft1', text: 'me cuesta', kind: 'PHRASE' });
    expect(mockLearnerVocabUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          lemma: 'me cuesta',
          translation: '',
          partOfSpeech: 'phrase',
          mastery: 0.05,
        }),
      })
    );
    expect(mockLearnerFocusTargetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          courseId_kind_normalizedText: {
            courseId: 'c1',
            kind: 'PHRASE',
            normalizedText: 'me cuesta',
          },
        },
      })
    );
  });
});
