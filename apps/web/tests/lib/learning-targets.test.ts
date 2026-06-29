import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCourseFindFirst = vi.fn();
const mockLearnerVocabUpsert = vi.fn();
const mockLearnerFocusTargetUpsert = vi.fn();
const mockLearnerFocusTargetFindFirst = vi.fn();
const mockLearnerFocusTargetUpdate = vi.fn();
const mockAssertStorageWritable = vi.fn();
const mockUploadFile = vi.fn();
const mockGetAutoModelConfig = vi.fn();
const mockGetConfiguredTtsProviderId = vi.fn();
const mockResolveTtsProvider = vi.fn();
const mockGetVisualCueKey = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) },
    learnerVocab: { upsert: (...a: unknown[]) => mockLearnerVocabUpsert(...a) },
    learnerFocusTarget: {
      upsert: (...a: unknown[]) => mockLearnerFocusTargetUpsert(...a),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findFirst: (...a: unknown[]) => mockLearnerFocusTargetFindFirst(...a),
      update: (...a: unknown[]) => mockLearnerFocusTargetUpdate(...a),
    },
  },
}));
vi.mock('@/lib/r2', () => ({
  assertStorageWritable: (...a: unknown[]) => mockAssertStorageWritable(...a),
  uploadFile: (...a: unknown[]) => mockUploadFile(...a),
}));
vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: (...a: unknown[]) => mockGetAutoModelConfig(...a),
}));
vi.mock('@/lib/providers/tts', () => ({
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
  mockAssertStorageWritable.mockResolvedValue(undefined);
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

    const target = await addVisualCue('c1', 'u1', 'ft1');

    expect(target.visualCueUrl).toBe('https://images.pexels.com/photo.jpg');
    expect(mockGetVisualCueKey).toHaveBeenCalledWith('u1', 'pexels');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: { Authorization: 'user-pexels-key' },
      })
    );
  });
});

describe('generateTargetPronunciation', () => {
  it('uses the learner preferred TTS provider and model for pronunciation', async () => {
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

    const target = await generateTargetPronunciation('c1', 'u1', 'ft1');

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

  it('uses the admin-selected TTS provider with the learner preferred model', async () => {
    const generateSpeech = vi.fn().mockResolvedValue(Buffer.from('mp3'));
    mockGetConfiguredTtsProviderId.mockReturnValue('openai');
    mockLearnerFocusTargetFindFirst.mockResolvedValue({
      ...TARGET_ROW,
      course: {
        userId: 'u1',
        targetLang: 'es',
        user: { preferredTtsProvider: 'cartesia', preferredTtsModel: 'tts-1-hd' },
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

    const target = await generateTargetPronunciation('c1', 'u1', 'ft1');

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
