import { it, expect } from 'vitest';
import type { AssessmentSchemaContext } from './schema-context';

export function registerSchemaHistoryCases(getContext: () => AssessmentSchemaContext) {
  it('preserves committed answers when a question is deleted and rejects another assessment’s question', async () => {
    const { instance, classId, assessment } = getContext();
    const first = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    const second = await instance.database.classAssessment.create({ data: assessment(2, 1) });
    const left = await instance.database.classAssessmentSection.create({
      data: { assessmentId: first.id, skill: 'GRAMMAR', passThreshold: 0.7 },
    });
    const right = await instance.database.classAssessmentSection.create({
      data: { assessmentId: second.id, skill: 'GRAMMAR', passThreshold: 0.7 },
    });
    const makeQuestion = (assessmentId: string, sectionId: string) =>
      instance.database.classAssessmentQuestion.create({
        data: {
          assessmentId,
          sectionId,
          order: 1,
          question: 'Choose',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'Answer',
        },
      });
    const question = await makeQuestion(first.id, left.id);
    const other = await makeQuestion(second.id, right.id);
    await expect(
      instance.database.classAssessmentSubmission.create({
        data: { assessmentId: first.id, requestDigest: 'request', receipt: {} },
      })
    ).rejects.toThrow();
    await instance.database.classAssessment.update({
      where: { id: first.id },
      data: {
        status: 'READY',
        generationOperationId: 'submission-generation',
        reviewOperationId: 'submission-review',
        reviewedMaterialDigest: 'c'.repeat(64),
        reviewReceipt: {},
        sealedAt: new Date(),
      },
    });
    await expect(
      instance.database.classAssessmentSubmission.create({
        data: { assessmentId: first.id, requestDigest: 'request', receipt: {} },
      })
    ).rejects.toThrow();
    expect(await instance.database.classAssessmentSubmission.count()).toBe(0);
    await expect(
      instance.database.$transaction(async (tx) => {
        const partial = await tx.classAssessmentSubmission.create({
          data: { assessmentId: first.id, requestDigest: 'request', receipt: {} },
        });
        await tx.classAssessmentAnswer.create({
          data: {
            submissionId: partial.id,
            assessmentId: first.id,
            questionId: other.id,
            selectedIndex: 0,
            isCorrect: true,
          },
        });
      })
    ).rejects.toThrow();
    expect(await instance.database.classAssessmentSubmission.count()).toBe(0);
    const { submission, answer } = await instance.database.$transaction(async (tx) => {
      const saved = await tx.classAssessmentSubmission.create({
        data: { assessmentId: first.id, requestDigest: 'request', receipt: {} },
      });
      const selected = await tx.classAssessmentAnswer.create({
        data: {
          submissionId: saved.id,
          assessmentId: first.id,
          questionId: question.id,
          selectedIndex: 0,
          isCorrect: true,
        },
      });
      await tx.classAssessment.update({ where: { id: first.id }, data: { status: 'COMMITTED' } });
      return { submission: saved, answer: selected };
    });
    await expect(
      instance.database.classAssessmentAnswer.update({
        where: { id: answer.id },
        data: { selectedIndex: 1 },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentAnswer.delete({ where: { id: answer.id } })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentSubmission.update({
        where: { id: submission.id },
        data: { receipt: { changed: true } },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentSubmission.delete({ where: { id: submission.id } })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessment.update({
        where: { id: first.id },
        data: { status: 'READY' },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentQuestion.delete({ where: { id: question.id } })
    ).rejects.toThrow();
    await instance.database.courseClass.delete({ where: { id: classId } });
    expect(await instance.database.classAssessmentAnswer.count()).toBe(0);
  });

  it('binds committed productive snapshots to completed owned work and preserves them independently', async () => {
    const { instance, ownerId, courseId, classId, assessment } = getContext();
    const saved = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    const speaking = await instance.database.classAssessmentSection.create({
      data: { assessmentId: saved.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    const writing = await instance.database.classAssessmentSection.create({
      data: { assessmentId: saved.id, skill: 'WRITING', passThreshold: 0.7 },
    });
    const spokenPrompt = await instance.database.speakingPrompt.create({
      data: {
        assessmentSectionId: speaking.id,
        assessmentRubric: 'Criteria',
        assessmentTaskMode: 'READ_ALOUD',
        order: 1,
        targetPhrase: 'Да',
        translation: 'Sí',
      },
    });
    const writtenPrompt = await instance.database.writingPrompt.create({
      data: {
        assessmentSectionId: writing.id,
        assessmentRubric: 'Criteria',
        order: 1,
        task: 'Write',
      },
    });
    const recording = await instance.database.speakingRecording.create({
      data: {
        assessmentSectionId: speaking.id,
        promptId: spokenPrompt.id,
        userId: ownerId,
        audioUrl: '/audio',
        status: 'SCORED',
        overallScore: 0.8,
        gradingOperationId: 'speaking-operation',
      },
    });
    const response = await instance.database.writingResponse.create({
      data: {
        assessmentSectionId: writing.id,
        promptId: writtenPrompt.id,
        userId: ownerId,
        text: 'Да',
        overallScore: 0.9,
        gradingState: {
          status: 'COMPLETED',
          id: 'writing-operation',
          fingerprint: 'b'.repeat(64),
          userId: ownerId,
          courseId,
        },
      },
    });
    await instance.database.classAssessment.update({
      where: { id: saved.id },
      data: {
        status: 'READY',
        generationOperationId: 'evidence-generation',
        reviewOperationId: 'evidence-review',
        reviewedMaterialDigest: 'a'.repeat(64),
        reviewReceipt: {},
        sealedAt: new Date(),
      },
    });
    const createEvidence = async (
      wrong: 'score' | 'digest' | 'operation' | 'writing-fingerprint' | null,
      pause?: () => Promise<void>
    ) =>
      instance.database.$transaction(async (tx) => {
        const submission = await tx.classAssessmentSubmission.create({
          data: { assessmentId: saved.id, requestDigest: 'request', receipt: {} },
        });
        const common = {
          submissionId: submission.id,
          assessmentId: saved.id,
          operationFingerprint: (wrong === 'writing-fingerprint' ? 'd' : 'b').repeat(64),
          materialDigest: (wrong === 'digest' ? 'd' : 'a').repeat(64),
          inputDigest: 'c'.repeat(64),
        };
        const spoken = await tx.classAssessmentProductiveEvidence.create({
          data: {
            ...common,
            sectionId: speaking.id,
            promptId: spokenPrompt.id,
            speakingRecordingId: recording.id,
            operationId: wrong === 'operation' ? 'other-operation' : 'speaking-operation',
            score: wrong === 'score' ? 0.1 : 0.8,
            snapshot: { score: 0.8 },
          },
        });
        const written = await tx.classAssessmentProductiveEvidence.create({
          data: {
            ...common,
            sectionId: writing.id,
            promptId: writtenPrompt.id,
            writingResponseId: response.id,
            operationId: 'writing-operation',
            score: 0.9,
            snapshot: { score: 0.9 },
          },
        });
        if (pause) await pause();
        await tx.classAssessment.update({ where: { id: saved.id }, data: { status: 'COMMITTED' } });
        return { spoken, written };
      });
    for (const wrong of ['score', 'digest', 'operation', 'writing-fingerprint'] as const)
      await expect(createEvidence(wrong)).rejects.toThrow();
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { status: 'UNRESOLVED' },
    });
    await expect(createEvidence(null)).rejects.toThrow();
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { status: 'SCORED' },
    });
    expect(await instance.database.classAssessmentSubmission.count()).toBe(0);
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const committing = createEvidence(null, async () => {
      locked();
      await gate;
    });
    await acquired;
    const gradeUpdate = instance.database.writingResponse
      .update({
        where: { id: response.id },
        data: { feedback: 'Settled later', overallScore: 0.2 },
      })
      .then(() => 'updated');
    try {
      expect(
        await Promise.race([
          gradeUpdate,
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
        ])
      ).toBe('waiting');
    } finally {
      release();
    }
    const evidence = await committing;
    expect(await gradeUpdate).toBe('updated');
    await expect(
      instance.database.classAssessmentProductiveEvidence.update({
        where: { id: evidence.spoken.id },
        data: { score: 0.1 },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentProductiveEvidence.delete({
        where: { id: evidence.written.id },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.speakingRecording.delete({ where: { id: recording.id } })
    ).rejects.toThrow();
    expect(
      (
        await instance.database.classAssessmentProductiveEvidence.findUniqueOrThrow({
          where: { id: evidence.written.id },
        })
      ).score
    ).toBe(0.9);
    await instance.database.courseClass.delete({ where: { id: classId } });
    expect(await instance.database.classAssessmentProductiveEvidence.count()).toBe(0);
  });

  it.each(['course', 'user'] as const)(
    'permits a full %s cascade with committed productive evidence',
    async (parent) => {
      const { instance, ownerId, courseId, assessment } = getContext();
      const saved = await instance.database.classAssessment.create({ data: assessment(1, 1) });
      const section = await instance.database.classAssessmentSection.create({
        data: { assessmentId: saved.id, skill: 'WRITING', passThreshold: 0.7 },
      });
      const prompt = await instance.database.writingPrompt.create({
        data: {
          assessmentSectionId: section.id,
          assessmentRubric: 'Criteria',
          order: 1,
          task: 'Write',
        },
      });
      const response = await instance.database.writingResponse.create({
        data: {
          assessmentSectionId: section.id,
          promptId: prompt.id,
          userId: ownerId,
          text: 'Да',
          overallScore: 0.9,
          gradingState: {
            status: 'COMPLETED',
            id: 'cascade-writing',
            fingerprint: 'b'.repeat(64),
            userId: ownerId,
            courseId,
          },
        },
      });
      await instance.database.classAssessment.update({
        where: { id: saved.id },
        data: {
          status: 'READY',
          generationOperationId: 'cascade-generation',
          reviewOperationId: 'cascade-review',
          reviewedMaterialDigest: 'a'.repeat(64),
          reviewReceipt: {},
          sealedAt: new Date(),
        },
      });
      await instance.database.$transaction(async (tx) => {
        const submission = await tx.classAssessmentSubmission.create({
          data: { assessmentId: saved.id, requestDigest: 'request', receipt: {} },
        });
        await tx.classAssessmentProductiveEvidence.create({
          data: {
            submissionId: submission.id,
            assessmentId: saved.id,
            sectionId: section.id,
            promptId: prompt.id,
            writingResponseId: response.id,
            operationId: 'cascade-writing',
            operationFingerprint: 'b'.repeat(64),
            materialDigest: 'a'.repeat(64),
            inputDigest: 'c'.repeat(64),
            score: 0.9,
            snapshot: { score: 0.9 },
          },
        });
        await tx.classAssessment.update({ where: { id: saved.id }, data: { status: 'COMMITTED' } });
      });
      if (parent === 'course') await instance.database.course.delete({ where: { id: courseId } });
      else await instance.database.user.delete({ where: { id: ownerId } });
      expect(await instance.database.classAssessmentProductiveEvidence.count()).toBe(0);
    }
  );
}
