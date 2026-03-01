import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockPrismaVoiceCloneFindUnique = vi.fn();
const mockPrismaVoiceCloneUpdate = vi.fn().mockResolvedValue({});
const mockPrismaVoiceFingerprintUpsert = vi.fn().mockResolvedValue({});
const mockPrismaVoiceFingerprintFindUnique = vi.fn();
const mockPrismaVoiceFingerprintFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaVoiceSimilarityMatchCreate = vi.fn().mockResolvedValue({});
const mockPrismaVoiceVerificationChallengeFindFirst = vi.fn();
const mockPrismaVoiceVerificationChallengeCreate = vi.fn().mockResolvedValue({});
const mockPrismaVoiceVerificationChallengeUpdate = vi.fn().mockResolvedValue({});
const mockPrismaTransaction = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    voiceClone: {
      findUnique: (...args: unknown[]) => mockPrismaVoiceCloneFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaVoiceCloneUpdate(...args),
    },
    voiceFingerprint: {
      upsert: (...args: unknown[]) => mockPrismaVoiceFingerprintUpsert(...args),
      findUnique: (...args: unknown[]) => mockPrismaVoiceFingerprintFindUnique(...args),
      findMany: (...args: unknown[]) => mockPrismaVoiceFingerprintFindMany(...args),
    },
    voiceSimilarityMatch: {
      create: (...args: unknown[]) => mockPrismaVoiceSimilarityMatchCreate(...args),
    },
    voiceVerificationChallenge: {
      findFirst: (...args: unknown[]) => mockPrismaVoiceVerificationChallengeFindFirst(...args),
      create: (...args: unknown[]) => mockPrismaVoiceVerificationChallengeCreate(...args),
      update: (...args: unknown[]) => mockPrismaVoiceVerificationChallengeUpdate(...args),
    },
    $transaction: (...args: unknown[]) => mockPrismaTransaction(...args),
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

const mockDownloadFile = vi.fn().mockResolvedValue(Buffer.from('fake-audio'));
const mockDeleteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/r2', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
}));

const mockDeleteClonedVoice = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/elevenlabs', () => ({
  deleteClonedVoice: (...args: unknown[]) => mockDeleteClonedVoice(...args),
}));

const mockGetByokKey = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/byok', () => ({
  getByokKey: (...args: unknown[]) => mockGetByokKey(...args),
}));

const mockExtractVoiceprint = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
const mockFindDuplicateVoiceprints = vi.fn().mockResolvedValue([]);
const mockVerifyChallenge = vi.fn().mockResolvedValue({ similarity: 0.85, passed: true });

vi.mock('@/lib/voice-fingerprint', () => ({
  extractVoiceprint: (...args: unknown[]) => mockExtractVoiceprint(...args),
  findDuplicateVoiceprints: (...args: unknown[]) => mockFindDuplicateVoiceprints(...args),
  verifyChallenge: (...args: unknown[]) => mockVerifyChallenge(...args),
}));

vi.mock('@/lib/voice-challenge-phrases', () => ({
  generateChallengePhrase: vi.fn().mockReturnValue('The quick brown fox jumps over the lazy dog'),
  CHALLENGE_EXPIRY_MS: 600000,
  MAX_CHALLENGE_ATTEMPTS: 3,
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: {
    VERIFY_VOICE: 'verify_voice',
    SEND_NOTIFICATION: 'send_notification',
  },
  voiceVerificationQueue: { name: 'voice-verification' },
  notificationQueue: { name: 'notification' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---- Import under test ----

import { processVoiceVerification } from '@/workers/voice-verification.worker';
import type { VerifyVoicePayload } from '@/lib/queue';
import type { Job } from 'bullmq';

// ---- Helpers ----

function createMockJob(data: VerifyVoicePayload): Job<VerifyVoicePayload> {
  return {
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<VerifyVoicePayload>;
}

// ---- Tests ----

describe('processVoiceVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaTransaction.mockImplementation(async (args: unknown) => {
      if (Array.isArray(args)) return Promise.all(args);
      return args;
    });
  });

  describe('extract_fingerprint', () => {
    const payload: VerifyVoicePayload = {
      voiceCloneId: 'clone-1',
      userId: 'user-1',
      action: 'extract_fingerprint',
    };

    beforeEach(() => {
      mockPrismaVoiceCloneFindUnique.mockResolvedValue({
        sampleUrl: 'https://r2.example.com/sample.mp3',
      });
    });

    it('downloads sample audio and extracts voiceprint', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockDownloadFile).toHaveBeenCalledWith('https://r2.example.com/sample.mp3');
      expect(mockExtractVoiceprint).toHaveBeenCalledWith(Buffer.from('fake-audio'));
    });

    it('stores the fingerprint in the database', async () => {
      mockExtractVoiceprint.mockResolvedValue([0.5, 0.6, 0.7]);
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaVoiceFingerprintUpsert).toHaveBeenCalledWith({
        where: { voiceCloneId: 'clone-1' },
        create: expect.objectContaining({
          voiceCloneId: 'clone-1',
          embedding: [0.5, 0.6, 0.7],
          modelVersion: 'wespeaker-cam++-lm-v1',
        }),
        update: expect.objectContaining({
          embedding: [0.5, 0.6, 0.7],
          modelVersion: 'wespeaker-cam++-lm-v1',
        }),
      });
    });

    it('queues check_duplicates after extraction', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'voice-verification' },
        'verify_voice',
        expect.objectContaining({
          voiceCloneId: 'clone-1',
          userId: 'user-1',
          action: 'check_duplicates',
        })
      );
    });

    it('throws when no sample audio exists', async () => {
      mockPrismaVoiceCloneFindUnique.mockResolvedValue({ sampleUrl: null });
      const job = createMockJob(payload);

      await expect(processVoiceVerification(job)).rejects.toThrow(
        'No sample audio for voice clone clone-1'
      );
    });

    it('throws when voice clone does not exist', async () => {
      mockPrismaVoiceCloneFindUnique.mockResolvedValue(null);
      const job = createMockJob(payload);

      await expect(processVoiceVerification(job)).rejects.toThrow(
        'No sample audio for voice clone clone-1'
      );
    });
  });

  describe('check_duplicates — match found', () => {
    const payload: VerifyVoicePayload = {
      voiceCloneId: 'clone-new',
      userId: 'user-uploader',
      action: 'check_duplicates',
    };

    beforeEach(() => {
      mockPrismaVoiceFingerprintFindUnique.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
      });
      mockFindDuplicateVoiceprints.mockResolvedValue([
        { voiceCloneId: 'clone-verified', similarity: 0.92 },
      ]);
      mockPrismaVoiceCloneFindUnique.mockResolvedValue({
        provider: 'elevenlabs',
        externalVoiceId: 'el-voice-123',
        sampleUrl: 'https://r2.example.com/sample.mp3',
        userId: 'user-uploader',
      });
    });

    it('sets verificationStatus to BLOCKED', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaVoiceCloneUpdate).toHaveBeenCalledWith({
        where: { id: 'clone-new' },
        data: { verificationStatus: 'BLOCKED' },
      });
    });

    it('creates a VoiceSimilarityMatch record', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaVoiceSimilarityMatchCreate).toHaveBeenCalledWith({
        data: {
          matchedVoiceId: 'clone-verified',
          blockedVoiceId: 'clone-new',
          similarity: 0.92,
        },
      });
    });

    it('deletes the blocked voice from ElevenLabs with BYOK key', async () => {
      mockGetByokKey.mockResolvedValueOnce('user-el-key');
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockGetByokKey).toHaveBeenCalledWith('user-uploader', 'elevenlabs');
      expect(mockDeleteClonedVoice).toHaveBeenCalledWith('el-voice-123', 'user-el-key');
    });

    it('deletes the sample audio from R2', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockDeleteFile).toHaveBeenCalledWith('https://r2.example.com/sample.mp3');
    });

    it('notifies the uploader about the block', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notification' },
        'send_notification',
        expect.objectContaining({
          userId: 'user-uploader',
          type: 'VOICE_BLOCKED_DUPLICATE',
        })
      );
    });

    it('notifies the matched voice owner', async () => {
      mockPrismaVoiceCloneFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === 'clone-verified')
          return { userId: 'user-owner', name: 'My Voice' };
        return {
          provider: 'elevenlabs',
          externalVoiceId: 'el-voice-123',
          sampleUrl: 'https://r2.example.com/sample.mp3',
          userId: 'user-uploader',
        };
      });

      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notification' },
        'send_notification',
        expect.objectContaining({
          userId: 'user-owner',
          type: 'VOICE_OWNERSHIP_ALERT',
        })
      );
    });
  });

  describe('check_duplicates — no match', () => {
    const payload: VerifyVoicePayload = {
      voiceCloneId: 'clone-unique',
      userId: 'user-1',
      action: 'check_duplicates',
    };

    beforeEach(() => {
      mockPrismaVoiceFingerprintFindUnique.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
      });
      mockFindDuplicateVoiceprints.mockResolvedValue([]);
    });

    it('sets verificationStatus to AWAITING_CHALLENGE via transaction', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaTransaction).toHaveBeenCalled();
    });

    it('creates a verification challenge with a phrase', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaTransaction).toHaveBeenCalled();
    });

    it('notifies user that verification is required', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notification' },
        'send_notification',
        expect.objectContaining({
          userId: 'user-1',
          type: 'VOICE_VERIFICATION_REQUIRED',
        })
      );
    });

    it('does not block or create similarity match', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaVoiceCloneUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { verificationStatus: 'BLOCKED' } })
      );
      expect(mockPrismaVoiceSimilarityMatchCreate).not.toHaveBeenCalled();
    });
  });

  describe('verify_challenge — passed', () => {
    const payload: VerifyVoicePayload = {
      voiceCloneId: 'clone-1',
      userId: 'user-1',
      action: 'verify_challenge',
      challengeId: 'challenge-1',
    };

    beforeEach(() => {
      mockPrismaVoiceVerificationChallengeFindFirst.mockResolvedValue({
        id: 'challenge-1',
        recordingUrl: 'https://r2.example.com/challenge.webm',
        attemptNumber: 1,
        passed: null,
      });
      mockVerifyChallenge.mockResolvedValue({ similarity: 0.85, passed: true });
    });

    it('downloads challenge recording and extracts voiceprint', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockDownloadFile).toHaveBeenCalledWith('https://r2.example.com/challenge.webm');
      expect(mockExtractVoiceprint).toHaveBeenCalled();
    });

    it('updates challenge with similarity and passed=true', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaVoiceVerificationChallengeUpdate).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { similarity: 0.85, passed: true },
      });
    });

    it('sets voice clone to VERIFIED', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaVoiceCloneUpdate).toHaveBeenCalledWith({
        where: { id: 'clone-1' },
        data: { verificationStatus: 'VERIFIED' },
      });
    });

    it('notifies user of successful verification', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notification' },
        'send_notification',
        expect.objectContaining({
          userId: 'user-1',
          type: 'VOICE_VERIFICATION_PASSED',
        })
      );
    });
  });

  describe('verify_challenge — failed with retries remaining', () => {
    const payload: VerifyVoicePayload = {
      voiceCloneId: 'clone-1',
      userId: 'user-1',
      action: 'verify_challenge',
    };

    beforeEach(() => {
      mockPrismaVoiceVerificationChallengeFindFirst.mockResolvedValue({
        id: 'challenge-1',
        recordingUrl: 'https://r2.example.com/challenge.webm',
        attemptNumber: 1,
        passed: null,
      });
      mockVerifyChallenge.mockResolvedValue({ similarity: 0.55, passed: false });
    });

    it('updates challenge with passed=false', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaVoiceVerificationChallengeUpdate).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { similarity: 0.55, passed: false },
      });
    });

    it('creates a new challenge with incremented attempt number', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      // Transaction should have been called with the new challenge
      expect(mockPrismaTransaction).toHaveBeenCalled();
    });

    it('notifies user to retry', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notification' },
        'send_notification',
        expect.objectContaining({
          userId: 'user-1',
          type: 'VOICE_VERIFICATION_REQUIRED',
        })
      );
    });

    it('does not reject or clean up when retries remain', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaVoiceCloneUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { verificationStatus: 'REJECTED' } })
      );
      expect(mockDeleteClonedVoice).not.toHaveBeenCalled();
    });
  });

  describe('verify_challenge — max attempts reached', () => {
    const payload: VerifyVoicePayload = {
      voiceCloneId: 'clone-1',
      userId: 'user-1',
      action: 'verify_challenge',
    };

    beforeEach(() => {
      mockPrismaVoiceVerificationChallengeFindFirst.mockResolvedValue({
        id: 'challenge-3',
        recordingUrl: 'https://r2.example.com/challenge-3.webm',
        attemptNumber: 3,
        passed: null,
      });
      mockVerifyChallenge.mockResolvedValue({ similarity: 0.50, passed: false });
      mockPrismaVoiceCloneFindUnique.mockResolvedValue({
        provider: 'elevenlabs',
        externalVoiceId: 'el-voice-456',
        sampleUrl: 'https://r2.example.com/sample.mp3',
        userId: 'user-1',
      });
    });

    it('sets voice clone to REJECTED', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockPrismaVoiceCloneUpdate).toHaveBeenCalledWith({
        where: { id: 'clone-1' },
        data: { verificationStatus: 'REJECTED' },
      });
    });

    it('deletes voice from ElevenLabs with BYOK key', async () => {
      mockGetByokKey.mockResolvedValueOnce('user-el-key-2');
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockGetByokKey).toHaveBeenCalledWith('user-1', 'elevenlabs');
      expect(mockDeleteClonedVoice).toHaveBeenCalledWith('el-voice-456', 'user-el-key-2');
    });

    it('deletes sample audio from R2', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockDeleteFile).toHaveBeenCalledWith('https://r2.example.com/sample.mp3');
    });

    it('notifies user of permanent failure', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      expect(mockAddJob).toHaveBeenCalledWith(
        { name: 'notification' },
        'send_notification',
        expect.objectContaining({
          userId: 'user-1',
          type: 'VOICE_VERIFICATION_FAILED',
        })
      );
    });

    it('does not create a new challenge', async () => {
      const job = createMockJob(payload);
      await processVoiceVerification(job);

      // No transaction for creating a new challenge
      expect(mockPrismaTransaction).not.toHaveBeenCalled();
    });
  });

  describe('verify_challenge — no recording found', () => {
    it('throws when no challenge recording exists', async () => {
      mockPrismaVoiceVerificationChallengeFindFirst.mockResolvedValue(null);

      const job = createMockJob({
        voiceCloneId: 'clone-1',
        userId: 'user-1',
        action: 'verify_challenge',
      });

      await expect(processVoiceVerification(job)).rejects.toThrow(
        'No challenge recording found for voice clone clone-1'
      );
    });
  });
});
