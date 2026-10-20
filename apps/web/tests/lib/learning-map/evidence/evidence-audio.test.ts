// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const boundary = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('@/lib/sidedoor/storage/core/storage-inputs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sidedoor/storage/core/storage-inputs')>()),
  resolveStorageInput: boundary.resolve,
}));
import {
  assertSelectedLearningAudio,
  publishLearningAudioIdentity,
} from '@/lib/learning-map/evidence/audio';
import { learningScriptHash, learningScriptTranscript } from '@/lib/learning/script-hash';
import { assessmentFixture } from './evidence-fixtures';

const turns = [{ speaker: 'Guest', text: 'Ein Gericht ohne Fleisch, bitte.' }];
function databaseFixture() {
  const identity = {
    ...assessmentFixture('LISTENING').media!,
    scriptSha256: learningScriptHash(turns),
  };
  const episode = {
    id: 'episode-1',
    userId: 'user-1',
    status: 'READY',
    deletedAt: null,
    audioUrl: identity.reference.reference,
    currentVersion: 1,
    audioGenerationKey: 'generation-1',
    script: { turns },
  };
  const checked = {
    schemaVersion: 1 as const,
    status: 'AWAITING_MEDIA' as const,
    scope: assessmentFixture('LISTENING').scope,
    criterion: assessmentFixture('LISTENING').criterion,
    task: {
      ...assessmentFixture('LISTENING').task,
      passageText: learningScriptTranscript(turns),
      audio: null,
    },
    scriptSha256: identity.scriptSha256,
    review: assessmentFixture('LISTENING').review,
  };
  const db = {
    episode: {
      findUnique: vi.fn(async () => episode),
      findUniqueOrThrow: vi.fn(async () => episode),
    },
    $queryRaw: vi.fn(async () => [{ learningAudioIdentity: identity }]),
    $executeRaw: vi.fn(async () => 1),
    classSection: {
      findMany: vi.fn(async () => [
        {
          classId: 'class-1',
          questions: [{ id: 'question-1', learningAssessment: checked as unknown }],
        },
      ]),
    },
    courseClass: { findUniqueOrThrow: vi.fn(async () => ({ courseId: 'course-1' })) },
    lessonQuestion: { update: vi.fn(async (input) => input) },
    practiceSession: { findMany: vi.fn(async () => []), update: vi.fn() },
  };
  boundary.resolve.mockResolvedValue({ input: identity.reference, backend: {} });
  return { db, tx: db as unknown as Prisma.TransactionClient, identity, episode };
}
beforeEach(() => {
  boundary.resolve.mockReset();
});
describe('canonical learning audio identity', () => {
  it('rejects a pending question whose reviewed transcript differs from the actual published speech', async () => {
    const { db, tx, identity } = databaseFixture();
    const sections = await db.classSection.findMany();
    const pending = sections[0]!.questions[0]!.learningAssessment as {
      task: { passageText: string };
    };
    pending.task.passageText = 'A different private script.';
    db.classSection.findMany.mockResolvedValue(sections);
    await expect(
      publishLearningAudioIdentity(tx, {
        episodeId: 'episode-1',
        audioUrl: identity.reference.reference,
        contentSha256: identity.contentSha256,
        contentBytes: identity.contentBytes,
        version: 1,
      })
    ).rejects.toThrow(/script or owner/);
  });
  it('seals pending questions with the published bytes, script and immutable canonical asset', async () => {
    const { db, tx, identity } = databaseFixture();
    const result = await publishLearningAudioIdentity(tx, {
      episodeId: 'episode-1',
      audioUrl: identity.reference.reference,
      contentSha256: identity.contentSha256,
      contentBytes: identity.contentBytes,
      version: 1,
    });
    expect(result).toEqual(identity);
    const stored = db.lessonQuestion.update.mock.results[0]!.value;
    await expect(stored).resolves.toMatchObject({
      data: {
        learningAssessment: {
          media: identity,
          task: {
            audio: { scriptSha256: identity.scriptSha256, contentSha256: identity.contentSha256 },
          },
        },
      },
    });
  });
  it('never rebinds previously sealed questions to regenerated audio', async () => {
    const { db, tx, identity } = databaseFixture();
    const sealed = assessmentFixture('LISTENING');
    db.classSection.findMany.mockResolvedValue([
      { classId: 'class-1', questions: [{ id: 'question-1', learningAssessment: sealed }] },
    ]);
    await publishLearningAudioIdentity(tx, {
      episodeId: 'episode-1',
      audioUrl: identity.reference.reference,
      contentSha256: '9'.repeat(64),
      contentBytes: 2000,
      version: 1,
    });
    expect(db.lessonQuestion.update.mock.results).toHaveLength(0);
    expect(sealed.media!.contentSha256).not.toBe('9'.repeat(64));
  });
  it('requires the selected current generation and exact registered consumer before evidence publication', async () => {
    const { tx, identity, episode } = databaseFixture();
    await expect(assertSelectedLearningAudio(tx, identity)).resolves.toEqual(identity);
    episode.audioGenerationKey = 'regenerated';
    await expect(assertSelectedLearningAudio(tx, identity)).rejects.toThrow(/generation changed/);
  });
  it.each(['script', 'reference', 'owner', 'deleted', 'registry'])(
    'rejects changed %s rather than borrowing current READY status',
    async (change) => {
      const { tx, identity, episode } = databaseFixture();
      if (change === 'script')
        episode.script.turns = [{ speaker: 'Guest', text: 'Changed speech.' }];
      if (change === 'reference') episode.audioUrl = '/api/storage/replacement.mp3';
      if (change === 'owner') episode.userId = 'someone-else';
      if (change === 'deleted') Object.assign(episode, { deletedAt: new Date() });
      if (change === 'registry')
        boundary.resolve.mockResolvedValue({
          input: { ...identity.reference, assetId: '0'.repeat(64) },
        });
      await expect(assertSelectedLearningAudio(tx, identity)).rejects.toThrow(/changed/);
    }
  );
});
