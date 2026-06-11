import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrismaVoiceTrackFindUnique = vi.fn();
const mockPrismaVoiceTrackFindUniqueOrThrow = vi.fn();
const mockPrismaVoiceTrackUpdate = vi.fn();
const mockPrismaVoiceTrackSegmentFindUnique = vi.fn();
const mockPrismaVoiceTrackSegmentUpdate = vi.fn();
const mockPrismaVoiceTrackSegmentCount = vi.fn();
const mockPrismaVoiceTrackSegmentFindMany = vi.fn();
const mockPrismaDiscoveryFindUnique = vi.fn();
const mockPrismaVoiceTrackVoiceUpsert = vi.fn();

vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    voiceTrack: {
      findUnique: (...args: unknown[]) => mockPrismaVoiceTrackFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockPrismaVoiceTrackFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockPrismaVoiceTrackUpdate(...args),
    },
    voiceTrackSegment: {
      findUnique: (...args: unknown[]) => mockPrismaVoiceTrackSegmentFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaVoiceTrackSegmentUpdate(...args),
      count: (...args: unknown[]) => mockPrismaVoiceTrackSegmentCount(...args),
      findMany: (...args: unknown[]) => mockPrismaVoiceTrackSegmentFindMany(...args),
    },
    discovery: {
      findUnique: (...args: unknown[]) => mockPrismaDiscoveryFindUnique(...args),
    },
    voiceTrackVoice: {
      upsert: (...args: unknown[]) => mockPrismaVoiceTrackVoiceUpsert(...args),
    },
  };
  return { prisma: mockPrisma, prismaUnfiltered: mockPrisma };
});

const mockAddJob = vi.fn();

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    STITCH_VOICE_TRACK: 'stitch_voice_track',
  },
  voiceTrackStitchingQueue: { name: 'voice-track-stitching' },
}));

const mockResolveTtsProvider = vi.fn();

vi.mock('@/lib/providers', () => ({
  resolveTtsProvider: (...args: unknown[]) => mockResolveTtsProvider(...args),
}));

const mockUploadVoiceTrackSegmentAudio = vi.fn();

vi.mock('@/lib/r2', () => ({
  uploadVoiceTrackSegmentAudio: (...args: unknown[]) => mockUploadVoiceTrackSegmentAudio(...args),
}));

const mockGenerateTtsAudio = vi.fn();

vi.mock('@/lib/tts-generation', () => ({
  generateTtsAudio: (...args: unknown[]) => mockGenerateTtsAudio(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { processVoiceTrackAudio } from '@/workers/voice-track-audio.worker';
import type { GenerateVoiceTrackAudioPayload } from '@/lib/queue';
import type { Job } from 'bullmq';

function createMockJob(data: GenerateVoiceTrackAudioPayload): Job<GenerateVoiceTrackAudioPayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<GenerateVoiceTrackAudioPayload>;
}

const defaultPayload: GenerateVoiceTrackAudioPayload = {
  podcastId: 'podcast-001',
  voiceTrackId: 'voice-track-001',
  voiceTrackSegmentId: 'voice-track-segment-001',
  segmentId: 'segment-001',
  speaker: 'HOST',
  text: 'Welcome back.',
};

const mockProviderGetVoiceId = vi.fn();

function setupResolvedProvider(providerId: string, modelId: string) {
  mockResolveTtsProvider.mockResolvedValue({
    provider: {
      getVoiceId: (...args: unknown[]) => mockProviderGetVoiceId(...args),
      getModelId: () => modelId,
      providerId,
    },
    source: 'platform',
    providerId,
  });
}

function setupVoiceTrack(
  overrides: {
    ttsProvider?: string | null;
    ttsModel?: string | null;
    voices?: Array<{
      speaker: string;
      voiceId: string | null;
      provider: string | null;
      ttsModel: string | null;
    }>;
  } = {}
) {
  mockPrismaVoiceTrackFindUniqueOrThrow.mockResolvedValue({
    ttsProvider: 'ttsProvider' in overrides ? overrides.ttsProvider : 'elevenlabs',
    ttsModel: 'ttsModel' in overrides ? overrides.ttsModel : 'eleven_v3',
    voices: overrides.voices ?? [],
    podcast: {
      userId: 'user-001',
      language: null,
      user: {},
    },
  });
}

describe('processVoiceTrackAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaVoiceTrackFindUnique.mockResolvedValue({ status: 'GENERATING_AUDIO' });
    mockPrismaVoiceTrackFindUniqueOrThrow.mockReset();
    mockPrismaVoiceTrackUpdate.mockResolvedValue({});
    mockPrismaVoiceTrackSegmentFindUnique.mockResolvedValue({ audioUrl: null });
    mockPrismaVoiceTrackSegmentUpdate.mockResolvedValue({});
    mockPrismaVoiceTrackSegmentCount.mockResolvedValue(1);
    mockPrismaVoiceTrackSegmentFindMany.mockResolvedValue([{ id: 'voice-track-segment-001' }]);
    mockPrismaDiscoveryFindUnique.mockResolvedValue(null);
    mockPrismaVoiceTrackVoiceUpsert.mockResolvedValue({});
    mockUploadVoiceTrackSegmentAudio.mockResolvedValue('https://r2.example.com/voice-track.mp3');
    mockGenerateTtsAudio.mockResolvedValue({
      audioBuffer: Buffer.from('audio'),
      segmentDuration: 1.5,
      service: 'elevenlabs',
      durationMs: 25,
      wordTimings: null,
    });
    mockProviderGetVoiceId.mockReturnValue('pool-voice');
    setupResolvedProvider('elevenlabs', 'eleven_v3');
    setupVoiceTrack();
  });

  it('rejects voice track audio when neither speaker nor track has a TTS provider', async () => {
    setupVoiceTrack({ ttsProvider: null, ttsModel: null, voices: [] });
    const job = createMockJob(defaultPayload);

    await expect(processVoiceTrackAudio(job)).rejects.toThrow(
      'Voice track voice-track-001 is missing a TTS provider for speaker HOST'
    );
    expect(mockResolveTtsProvider).not.toHaveBeenCalled();
    expect(mockGenerateTtsAudio).not.toHaveBeenCalled();
  });

  it('uses the speaker-level TTS provider without writing it to the whole voice track', async () => {
    setupVoiceTrack({
      ttsProvider: null,
      ttsModel: null,
      voices: [
        {
          speaker: 'HOST',
          voiceId: 'speaker-voice',
          provider: 'elevenlabs',
          ttsModel: 'eleven_v3',
        },
      ],
    });
    const job = createMockJob(defaultPayload);

    await processVoiceTrackAudio(job);

    expect(mockResolveTtsProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-001',
        podcastId: 'podcast-001',
        requestedProvider: 'elevenlabs',
        requestedModel: 'eleven_v3',
      })
    );
    expect(mockProviderGetVoiceId).not.toHaveBeenCalled();
    expect(mockGenerateTtsAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceId: 'speaker-voice',
        providerId: 'elevenlabs',
        requestedModel: 'eleven_v3',
      })
    );
    expect(mockPrismaVoiceTrackUpdate).not.toHaveBeenCalled();
  });

  it('writes back only the resolved model for a track-level provider', async () => {
    setupVoiceTrack({ ttsProvider: 'openai', ttsModel: null, voices: [] });
    setupResolvedProvider('openai', 'tts-1-hd');
    mockProviderGetVoiceId.mockReturnValue('openai-pool-voice');
    const job = createMockJob(defaultPayload);

    await processVoiceTrackAudio(job);

    expect(mockResolveTtsProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedProvider: 'openai',
        requestedModel: undefined,
      })
    );
    expect(mockPrismaVoiceTrackUpdate).toHaveBeenCalledWith({
      where: { id: 'voice-track-001' },
      data: { ttsModel: 'tts-1-hd' },
    });
  });
});
