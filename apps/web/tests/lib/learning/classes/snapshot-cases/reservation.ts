import { expect, it } from 'vitest';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureAssessmentCandidate } from '@/lib/learning/classes/material/assessment-snapshot';
import { reserveAssessmentListeningEpisode } from '@/lib/learning/classes/material/assessment-audio-reservation';
import { validatePreparationAudio } from '@/lib/classes/preparation-audio';
import { assessmentFormativeRevision } from '@/lib/learning/classes/material/assessment-formative-revision';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type { SnapshotContext } from './context';

export function registerSnapshotReservationCases(getContext: () => SnapshotContext) {
  it('preserves a preparing listening selection without fabricating readiness', async () => {
    const { fixture } = getContext();
    const { capture } = await fixture(true);
    expect(await capture()).toEqual({ status: 'PREPARING_AUDIO' });
  });

  it('refuses formative listening that gains its first script after the snapshot starts', async () => {
    const { instance, ownerId, classId, fixture } = getContext();
    const { saved, expected } = await fixture(true);
    const formative = await instance.database.classSection.findFirstOrThrow({
      where: { classId, skill: 'LISTENING' },
    });
    if (!formative.episodeId) throw new Error('Missing formative listening episode');
    const episodeId = formative.episodeId;
    await instance.database.script.delete({ where: { episodeId } });
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const oldGate = cls.prerequisiteGate as Prisma.JsonObject;
    const materialHash = await instance.database.$transaction((tx) =>
      initialA1MaterialHash(tx, classId, ownerId)
    );
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        prerequisiteGate: {
          ...oldGate,
          materialHash,
          acknowledgment: { userId: ownerId, receiptId: oldGate.receiptId, materialHash },
        } as Prisma.InputJsonValue,
      },
    });
    const formativeRevision = await instance.database.$transaction((tx) =>
      assessmentFormativeRevision(tx, classId, ownerId)
    );
    await instance.database.classAssessment.update({
      where: { id: saved.id },
      data: { formativeRevision: formativeRevision.revision },
    });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const execution = {
      ...authorizedLearnerExecution(ownerId),
      authorize: async (tx: Prisma.TransactionClient) => {
        await tx.courseClass.findUniqueOrThrow({ where: { id: classId }, select: { id: true } });
        started();
        await gate;
        return { userId: ownerId };
      },
    };
    const capturing = instance.database.$transaction(
      (tx) => captureAssessmentCandidate(tx, execution, expected),
      { isolationLevel: 'Serializable', timeout: 15000 }
    );
    await began;
    try {
      await instance.database.script.create({
        data: {
          episodeId,
          turns: [{ speaker: 'HOST', text: 'Привет' }],
          markdown: 'Привет',
        },
      });
    } finally {
      release();
    }
    const error = await capturing.then(
      () => null,
      (cause: unknown) => cause
    );
    expect(isSerializationConflict(error)).toBe(true);
  }, 20000);

  it.each(['insert', 'update', 'delete'] as const)(
    'does not capture ready material while a held-out listening script %s races its snapshot',
    async (change) => {
      const { instance, ownerId, classId, fixture } = getContext();
      const { saved, expected } = await fixture(true);
      const section = await instance.database.classAssessmentSection.findFirstOrThrow({
        where: { assessmentId: saved.id, skill: 'LISTENING' },
      });
      if (!section.episodeId) throw new Error('Missing assessment listening episode');
      const episodeId = section.episodeId;
      const script =
        change === 'insert'
          ? null
          : await instance.database.script.create({
              data: {
                episodeId,
                turns: [{ speaker: 'HOST', text: 'Привет' }],
                markdown: 'Привет',
              },
            });
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      const execution = {
        ...authorizedLearnerExecution(ownerId),
        authorize: async (tx: Prisma.TransactionClient) => {
          await tx.courseClass.findUniqueOrThrow({ where: { id: classId }, select: { id: true } });
          started();
          await gate;
          return { userId: ownerId };
        },
      };
      const capturing = instance.database.$transaction(
        (tx) => captureAssessmentCandidate(tx, execution, expected),
        { isolationLevel: 'Serializable', timeout: 15000 }
      );
      await began;
      try {
        if (change === 'insert')
          await instance.database.script.create({
            data: {
              episodeId,
              turns: [{ speaker: 'HOST', text: 'Привет' }],
              markdown: 'Привет',
            },
          });
        else if (change === 'update')
          await instance.database.script.update({
            where: { id: script!.id },
            data: { markdown: 'Changed' },
          });
        else await instance.database.script.delete({ where: { id: script!.id } });
      } finally {
        release();
      }
      const error = await capturing.then(
        () => null,
        (reason: unknown) => reason
      );
      expect(isSerializationConflict(error)).toBe(true);
    },
    20000
  );

  it('reserves one private episode across concurrent retries and captures its deletion scopes', async () => {
    const { instance, ownerId, classId, courseId, fixture } = getContext();
    const { saved, expected } = await fixture(true, false, false);
    const reserve = () =>
      sottoTransaction(instance.database, (tx) =>
        reserveAssessmentListeningEpisode(tx, authorizedLearnerExecution(ownerId), expected)
      );
    const [first, second] = await Promise.all([reserve(), reserve()]);
    expect(second).toEqual(first);
    expect(first.storage.scopes.map((scope) => scope.subjectId)).toEqual(
      expect.arrayContaining([
        `episode:${first.episodeId}`,
        `class:${classId}`,
        `course:${courseId}`,
        `profile:${ownerId}`,
      ])
    );
    const episodes = await instance.database.episode.findMany({
      where: { userId: ownerId, assessmentAudioAssessmentId: saved.id },
    });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      id: first.episodeId,
      source: 'CLASS',
      visibility: 'PRIVATE',
      status: 'PENDING',
      audioUrl: null,
    });
    const section = await instance.database.classAssessmentSection.findFirstOrThrow({
      where: { episodeId: first.episodeId },
    });
    await expect(
      instance.database.classAssessmentSection.update({
        where: { id: section.id },
        data: { episodeId: null },
      })
    ).rejects.toThrow('Assessment audio must remain attached until deleted');
    await expect(
      instance.database.classAssessmentSection.delete({ where: { id: section.id } })
    ).rejects.toThrow('Assessment audio must remain attached until deleted');
    await instance.database.$transaction(async (tx) => {
      await tx.classAssessmentSection.delete({ where: { id: section.id } });
      await tx.episode.delete({ where: { id: first.episodeId } });
    });
    expect(
      await instance.database.episode.findUnique({ where: { id: first.episodeId } })
    ).toBeNull();
  });

  it('allows the class and its sealed assessment audio to be removed together', async () => {
    const { instance, classId, fixture } = getContext();
    const { saved } = await fixture(true);
    const section = await instance.database.classAssessmentSection.findFirstOrThrow({
      where: { assessmentId: saved.id, skill: 'LISTENING' },
    });
    if (!section.episodeId) throw new Error('Missing listening episode');
    const episodeId = section.episodeId;
    await instance.database.classAssessment.update({
      where: { id: saved.id },
      data: {
        status: 'READY',
        reviewOperationId: 'cleanup-review',
        reviewedMaterialDigest: 'a'.repeat(64),
        reviewReceipt: {},
        sealedAt: new Date(),
      },
    });
    await instance.database.$transaction(async (tx) => {
      await tx.courseClass.delete({ where: { id: classId } });
      await tx.episode.delete({ where: { id: episodeId } });
    });
    expect(
      await instance.database.classAssessment.findUnique({ where: { id: saved.id } })
    ).toBeNull();
    expect(await instance.database.episode.findUnique({ where: { id: episodeId } })).toBeNull();
  });

  it('rolls back a reservation and rejects changed authority or an older episode', async () => {
    const { instance, ownerId, fixture } = getContext();
    const { saved, expected, capture } = await fixture(true, false, false);
    const reserve = (binding: typeof expected) =>
      sottoTransaction(instance.database, (tx) =>
        reserveAssessmentListeningEpisode(tx, authorizedLearnerExecution(ownerId), binding)
      );
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        await reserveAssessmentListeningEpisode(tx, authorizedLearnerExecution(ownerId), expected);
        throw new Error('abort reservation');
      })
    ).rejects.toThrow('abort reservation');
    expect(
      await instance.database.episode.count({
        where: { userId: ownerId, assessmentAudioAssessmentId: saved.id },
      })
    ).toBe(0);
    await expect(reserve({ ...expected, assessmentAttempt: 2 })).rejects.toThrow(
      'Assessment class or generation changed'
    );
    await expect(reserve({ ...expected, generationOperationId: 'different' })).rejects.toThrow(
      'Assessment class or generation changed'
    );
    const episode = await instance.database.episode.create({
      data: { userId: ownerId, title: 'Old audio', topic: 'Old audio' },
    });
    const section = await instance.database.classAssessmentSection.findFirstOrThrow({
      where: { assessmentId: saved.id, skill: 'LISTENING' },
    });
    await expect(
      instance.database.episode.update({
        where: { id: episode.id },
        data: {
          assessmentAudioAssessmentId: saved.id,
          assessmentAudioSectionId: section.id,
          assessmentAudioOperationId: expected.generationOperationId,
        },
      })
    ).rejects.toThrow('Assessment audio marker cannot change');
    await expect(
      instance.database.episode.create({
        data: {
          userId: ownerId,
          title: 'Unattached audio',
          topic: 'Unattached audio',
          assessmentAudioAssessmentId: saved.id,
          assessmentAudioSectionId: section.id,
          assessmentAudioOperationId: expected.generationOperationId,
        },
      })
    ).rejects.toThrow('Assessment audio must be attached before commit');
    await expect(
      instance.database.classAssessmentSection.updateMany({
        where: { assessmentId: saved.id, skill: 'LISTENING' },
        data: { episodeId: episode.id },
      })
    ).rejects.toThrow('Assessment audio must match its creation reservation');
    const reserved = await reserve(expected);
    expect(reserved.episodeId).not.toBe(episode.id);
    expect(await capture()).toEqual({ status: 'PREPARING_AUDIO' });
  });

  it('rejects a pending listening episode with the wrong language or visibility', async () => {
    const { instance, ownerId, fixture } = getContext();
    const { saved, expected, capture } = await fixture(true);
    const section = await instance.database.classAssessmentSection.findFirstOrThrow({
      where: { assessmentId: saved.id, skill: 'LISTENING' },
    });
    if (!section.episodeId) throw new Error('listening fixture has no episode');
    await instance.database.episode.update({
      where: { id: section.episodeId },
      data: { language: 'en' },
    });
    await expect(capture()).rejects.toThrow('Assessment listening media is unavailable');
    await expect(
      sottoTransaction(instance.database, (tx) =>
        reserveAssessmentListeningEpisode(tx, authorizedLearnerExecution(ownerId), expected)
      )
    ).rejects.toThrow('Assessment listening media is unavailable');
    await instance.database.episode.update({
      where: { id: section.episodeId },
      data: { language: 'ru', visibility: 'UNLISTED' },
    });
    await expect(capture()).rejects.toThrow('Assessment listening media is unavailable');
    await instance.database.episode.update({
      where: { id: section.episodeId },
      data: { visibility: 'PRIVATE' },
    });
    await expect(capture()).resolves.toEqual({ status: 'PREPARING_AUDIO' });
  });

  it('prevents assessment audio from being attached to other learning activities', async () => {
    const { instance, ownerId, classId, courseId, fixture } = getContext();
    const { saved, capture } = await fixture(true);
    const section = await instance.database.classAssessmentSection.findFirstOrThrow({
      where: { assessmentId: saved.id, skill: 'LISTENING' },
    });
    if (!section.episodeId) throw new Error('listening fixture has no episode');
    const episodeId = section.episodeId;
    await expect(
      sottoTransaction(instance.database, (tx) =>
        validatePreparationAudio(tx, episodeId, 'unadmitted-generation')
      )
    ).rejects.toThrow(/already active or needs recovery/);
    const exam = await instance.database.mockExam.create({
      data: {
        userId: ownerId,
        courseId,
        institution: 'GOETHE',
        level: 'A1',
        blueprintId: 'goethe/a1',
      },
    });
    await expect(
      instance.database.classSection.create({
        data: { classId, skill: 'LISTENING', seed: 'shared-audio', spec: {}, episodeId },
      })
    ).rejects.toThrow('Assessment audio cannot be used by another activity');
    await expect(
      instance.database.examSection.create({
        data: {
          examId: exam.id,
          skill: 'LISTENING',
          part: 'Listen',
          order: 1,
          format: 'listening',
          episodeId,
        },
      })
    ).rejects.toThrow('Assessment audio cannot be used by another activity');
    await expect(
      instance.database.practiceSession.create({
        data: {
          courseId,
          kind: 'LISTENING',
          items: [],
          seed: 'shared-audio',
          episodeId,
        },
      })
    ).rejects.toThrow('Assessment audio cannot be used by another activity');
    await expect(capture()).resolves.toEqual({ status: 'PREPARING_AUDIO' });
    const ordinary = await instance.database.episode.create({
      data: { userId: ownerId, title: 'Ordinary audio', topic: 'Greetings', source: 'CLASS' },
    });
    const classSection = await instance.database.classSection.create({
      data: { classId, skill: 'LISTENING', seed: 'ordinary', spec: {} },
    });
    const examSection = await instance.database.examSection.create({
      data: { examId: exam.id, skill: 'LISTENING', part: 'Listen', order: 1, format: 'listening' },
    });
    const practice = await instance.database.practiceSession.create({
      data: { courseId, kind: 'LISTENING', items: [], seed: 'ordinary' },
    });
    await expect(
      instance.database.classSection.update({
        where: { id: classSection.id },
        data: { episodeId },
      })
    ).rejects.toThrow('Assessment audio cannot be used by another activity');
    await expect(
      instance.database.examSection.update({
        where: { id: examSection.id },
        data: { episodeId },
      })
    ).rejects.toThrow('Assessment audio cannot be used by another activity');
    await expect(
      instance.database.practiceSession.update({
        where: { id: practice.id },
        data: { episodeId },
      })
    ).rejects.toThrow('Assessment audio cannot be used by another activity');
    await instance.database.$transaction(async (tx) => {
      await tx.practiceSession.update({ where: { id: practice.id }, data: { episodeId } });
      await tx.practiceSession.update({
        where: { id: practice.id },
        data: { episodeId: ordinary.id },
      });
    });
    expect(
      (await instance.database.practiceSession.findUniqueOrThrow({ where: { id: practice.id } }))
        .episodeId
    ).toBe(ordinary.id);
  });

  it('rejects a concurrent attempt to reuse audio before its reservation commits', async () => {
    const { instance, ownerId, courseId, fixture } = getContext();
    const { expected } = await fixture(true, false, false);
    let release!: () => void;
    let reportEpisode!: (id: string) => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reserved = new Promise<string>((resolve) => {
      reportEpisode = resolve;
    });
    const reservation = sottoTransaction(instance.database, async (tx) => {
      const audio = await reserveAssessmentListeningEpisode(
        tx,
        authorizedLearnerExecution(ownerId),
        expected
      );
      reportEpisode(audio.episodeId);
      await gate;
    });
    const episodeId = await reserved;
    const reuse = instance.database.practiceSession
      .create({
        data: { courseId, kind: 'LISTENING', items: [], seed: 'concurrent', episodeId },
      })
      .then(
        () => 'attached',
        (error: Error) => error.message
      );
    await Promise.race([reuse, new Promise((resolve) => setTimeout(resolve, 50))]);
    release();
    await reservation;
    expect(await reuse).toMatch(
      /Foreign key constraint violated|Assessment audio cannot be used by another activity/
    );
  });
}
