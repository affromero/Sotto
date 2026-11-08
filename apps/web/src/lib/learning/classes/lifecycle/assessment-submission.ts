import { isDeepStrictEqual } from 'node:util';
import { classAssessmentSubmitSchema, classReceiptSchema } from '@sotto/shared';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { AssessmentFenceConflict } from './assessment-fence';
import { captureAssessmentForEvaluation } from '../material/assessment-read';
import {
  assessmentEvaluationReceipt,
  evaluateAssessmentMaterial,
} from '../material/assessment-material';
import { captureAssessmentWritingEvidence } from '../writing/assessment-writing-evidence';
import { captureAssessmentSpeakingEvidence } from '../speaking/assessment-speaking-evidence';
import {
  READ_ALOUD_ASSESSMENT_POLICY,
  requireReadAloudAssessmentMaterial,
} from '../speaking/assessment-speaking-policy';
import {
  verifyAssessmentOutcomeForSubmission,
  verifyHistoricalAssessmentGeneration,
} from './assessment-outcome';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { currentClassSections } from '../progress/current-sections';
import { applyClassPracticeReview } from '../formative/class-practice-review';

export class AssessmentSpeakingUnavailable extends Error {
  constructor() {
    super('Speaking assessment evidence is not available.');
    this.name = 'AssessmentSpeakingUnavailable';
  }
}

/** Commit only complete owned held-out work. The caller cannot supply productive scores. */
export async function submitAssessment(input: {
  classId: string;
  assessmentId: string;
  choices: unknown;
  execution: SottoProviderExecution;
}) {
  const choices = classAssessmentSubmitSchema
    .parse({ choices: input.choices })
    .choices.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      input.execution.signal?.throwIfAborted();
      const actor = await input.execution.authorize(database);
      if (actor.userId !== input.execution.userId) throw new AssessmentFenceConflict();
      await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${input.classId} FOR UPDATE`;
      await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${input.assessmentId} FOR UPDATE`;
      const assessment = await database.classAssessment.findFirst({
        where: {
          id: input.assessmentId,
          classId: input.classId,
          userId: actor.userId,
          class: { course: { userId: actor.userId } },
        },
        include: {
          submission: true,
          class: {
            include: {
              lesson: true,
              submission: { include: { answers: true } },
              sections: {
                include: {
                  questions: true,
                  prompts: {
                    include: {
                      recordings: {
                        where: { userId: actor.userId },
                        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                      },
                    },
                  },
                  writingPrompts: {
                    include: {
                      responses: {
                        where: { userId: actor.userId },
                        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!assessment) throw new AssessmentFenceConflict();
      const requestDigest = objectiveEvidenceHash({
        version: 1,
        classId: input.classId,
        assessmentId: input.assessmentId,
        userId: actor.userId,
        choices,
      });
      if (assessment.submission) {
        const receipt = classReceiptSchema.parse(assessment.submission.receipt);
        if (
          assessment.status !== 'COMMITTED' ||
          assessment.submission.requestDigest !== requestDigest
        )
          throw new AssessmentFenceConflict();
        const saved = assessment.class.submission;
        if (
          !saved ||
          saved.attempt !== assessment.classAttempt ||
          saved.userId !== actor.userId ||
          saved.passed !== receipt.passed ||
          saved.overallScore !== receipt.overallScore ||
          !isDeepStrictEqual(saved.receipt, receipt)
        )
          throw new AssessmentFenceConflict();
        const current =
          assessment.class.attempt === assessment.classAttempt &&
          assessment.class.status === (receipt.passed ? 'PASSED' : 'FAILED');
        if (!current) {
          if (receipt.passed || !assessment.generationOperationId)
            throw new AssessmentFenceConflict();
          const reopened =
            assessment.class.attempt === assessment.classAttempt &&
            assessment.class.status === 'IN_PROGRESS';
          if (!reopened) throw new AssessmentFenceConflict();
          const generation = await sottoJobOutbox(database).read(assessment.generationOperationId);
          if (
            !generation ||
            !(await verifyHistoricalAssessmentGeneration(database, {
              id: generation.job.id,
              fingerprint: generation.fingerprint,
            }))
          )
            throw new AssessmentFenceConflict();
        }
        const replayActor = await input.execution.authorize(database);
        if (replayActor.userId !== actor.userId) throw new AssessmentFenceConflict();
        input.execution.signal?.throwIfAborted();
        return receipt;
      }
      if (
        assessment.status !== 'READY' ||
        assessment.class.attempt !== assessment.classAttempt ||
        !['AVAILABLE', 'IN_PROGRESS'].includes(assessment.class.status)
      )
        throw new AssessmentFenceConflict();
      const captured = await captureAssessmentForEvaluation(database, input);
      if (!assessment.generationOperationId) throw new AssessmentFenceConflict();
      const generation = await sottoJobOutbox(database).read(assessment.generationOperationId);
      if (
        !generation ||
        !(await verifyAssessmentOutcomeForSubmission(database, {
          id: generation.job.id,
          fingerprint: generation.fingerprint,
        }))
      )
        throw new AssessmentFenceConflict();
      if (
        captured.material.sections.some((section) => section.skill === 'SPEAKING') &&
        captured.speakingPolicy !== READ_ALOUD_ASSESSMENT_POLICY
      )
        throw new AssessmentSpeakingUnavailable();
      if (captured.speakingPolicy) requireReadAloudAssessmentMaterial(captured.material);
      const questions = captured.material.sections.flatMap((section) =>
        section.items.flatMap((item) =>
          'correctIndex' in item ? [{ ...item, sectionId: section.id }] : []
        )
      );
      if (
        choices.length !== questions.length ||
        choices.some(
          (choice) =>
            !questions.some(
              (question) =>
                question.id === choice.itemId && choice.selectedIndex < question.options.length
            )
        )
      )
        throw new AssessmentFenceConflict();
      const writing = captured.material.sections
        .filter((section) => section.skill === 'WRITING')
        .flatMap((section) => section.items);
      const productive = [];
      for (const prompt of writing)
        productive.push(
          await captureAssessmentWritingEvidence(database, { ...input, promptId: prompt.id })
        );
      const speaking = captured.material.sections
        .filter((section) => section.skill === 'SPEAKING')
        .flatMap((section) => section.items);
      for (const prompt of speaking)
        productive.push(
          await captureAssessmentSpeakingEvidence(database, { ...input, promptId: prompt.id })
        );
      const evaluated = evaluateAssessmentMaterial(
        captured.material,
        captured.scope,
        choices,
        productive.map((item) => item.evidence)
      );
      if (!evaluated.complete) throw new AssessmentFenceConflict();
      const receipt = assessmentEvaluationReceipt(captured.material, evaluated);
      const submission = await database.classAssessmentSubmission.create({
        data: { assessmentId: assessment.id, requestDigest, receipt },
      });
      await database.classAssessmentAnswer.createMany({
        data: choices.map((choice) => ({
          submissionId: submission.id,
          assessmentId: assessment.id,
          questionId: choice.itemId,
          selectedIndex: choice.selectedIndex,
          isCorrect:
            questions.find((question) => question.id === choice.itemId)!.correctIndex ===
            choice.selectedIndex,
        })),
      });
      await database.classAssessmentProductiveEvidence.createMany({
        data: productive.map((item) => ({
          submissionId: submission.id,
          assessmentId: assessment.id,
          sectionId: item.evidence.sectionId,
          promptId: item.evidence.itemId,
          ...('responseId' in item
            ? { writingResponseId: item.responseId }
            : { speakingRecordingId: item.recordingId }),
          operationId: item.evidence.operationId,
          operationFingerprint: item.operationFingerprint,
          materialDigest: item.evidence.materialDigest,
          inputDigest: item.inputDigest,
          score: item.evidence.score,
          snapshot: item.receipt,
        })),
      });
      const previous = assessment.class.submission;
      if (previous && previous.userId !== actor.userId) throw new AssessmentFenceConflict();
      if (previous?.history != null && !Array.isArray(previous.history))
        throw new AssessmentFenceConflict();
      const history = Array.isArray(previous?.history) ? [...previous.history] : [];
      if (previous)
        history.push({
          attempt: previous.attempt,
          receipt: previous.receipt ?? {
            passed: previous.passed,
            overallScore: previous.overallScore,
          },
          submittedAt: previous.submittedAt.toISOString(),
          answers: previous.answers.map(({ sectionId, questionId, selectedIndex, isCorrect }) => ({
            sectionId,
            questionId,
            selectedIndex,
            isCorrect,
          })),
        });
      const practiceSections = currentClassSections(assessment.class.sections).filter(
        (section) => captured.material.requirements.skills[section.skill].state === 'REQUIRED'
      );
      const practiceAnswers = z
        .record(z.string(), z.number().int().nonnegative())
        .parse(assessment.class.learnerAnswers);
      const gradedPractice = practiceSections.flatMap((section) =>
        section.questions.map((question) => {
          const selectedIndex = practiceAnswers[question.id];
          if (
            selectedIndex === undefined ||
            !Array.isArray(question.options) ||
            selectedIndex >= question.options.length
          )
            throw new AssessmentFenceConflict();
          return {
            sectionId: section.id,
            questionId: question.id,
            selectedIndex,
            isCorrect: selectedIndex === question.correctIndex,
          };
        })
      );
      const practiceResults = practiceSections
        .filter((section) => section.skill === 'READING' || section.skill === 'GRAMMAR')
        .map((section) => {
          const results = gradedPractice.filter((answer) => answer.sectionId === section.id);
          if (!results.length) throw new AssessmentFenceConflict();
          return {
            id: section.id,
            skill: section.skill,
            score: results.filter((answer) => answer.isCorrect).length / results.length,
          };
        });
      const now = new Date();
      await applyClassPracticeReview(database, {
        classId: input.classId,
        courseId: assessment.courseId,
        userId: actor.userId,
        attempt: assessment.classAttempt,
        adaptiveSeed: assessment.class.adaptiveSeed,
        readingVocabulary: assessment.class.readingVocabulary,
        lesson: assessment.class.lesson,
        sections: practiceSections,
        answers: gradedPractice,
        graded: gradedPractice,
        previousAnswers: previous?.answers ?? [],
        history,
        sectionResults: practiceResults,
        now,
      });
      await database.classSubmission.upsert({
        where: { classId: input.classId },
        create: {
          classId: input.classId,
          userId: actor.userId,
          attempt: assessment.classAttempt,
          overallScore: receipt.overallScore,
          passed: receipt.passed,
          receipt,
          history: [],
          answers: { create: gradedPractice },
        },
        update: {
          attempt: assessment.classAttempt,
          overallScore: receipt.overallScore,
          passed: receipt.passed,
          submittedAt: new Date(),
          receipt,
          history: history as Prisma.InputJsonValue,
          answers: { deleteMany: {}, create: gradedPractice },
        },
      });
      await database.classAssessment.update({
        where: { id: assessment.id },
        data: { status: 'COMMITTED' },
      });
      await database.courseClass.update({
        where: { id: input.classId },
        data: {
          status: receipt.passed ? 'PASSED' : 'FAILED',
          submittedAt: now,
          ...(receipt.passed ? { passedAt: now } : { failedAt: now }),
        },
      });
      if (receipt.passed)
        await database.course.updateMany({
          where: { id: assessment.courseId, activeClassId: input.classId },
          data: { activeClassId: null },
        });
      const finalActor = await input.execution.authorize(database);
      if (finalActor.userId !== actor.userId) throw new AssessmentFenceConflict();
      input.execution.signal?.throwIfAborted();
      return receipt;
    },
    { signal: input.execution.signal, timeoutMs: 60_000 }
  );
}
