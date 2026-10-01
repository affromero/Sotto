import {
  admitWritingExecution,
  reconcileWritingResponse,
  runWritingExecution,
  writingFailureDrained,
} from './writing-execution';
import { writingFeedbackSchema } from '@sotto/shared';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '../../prisma';
import { captureLearningModerationCredential, resolveCapturedLearningAi } from '../../learning-ai';
import { learningCredentialFingerprint } from '../../classes/preparation-selection';
import { validateSottoExecutionCredential } from '../../sidedoor/credentials/runtime/credential-execution';
import { gradeWriting } from '../../writing-grader';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';
import { readSkillRequirements } from '../skill-requirements';
import { isCurrentClassSection } from '../classes/current-sections';
import { sottoTransaction } from '../../sidedoor/access/state/transaction';

export class LearningWritingError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409
  ) {
    super(message);
  }
}

async function readOwnedWriting(
  database: Prisma.TransactionClient,
  kind: 'CLASS' | 'PRACTICE',
  parentId: string,
  promptId: string,
  userId: string
) {
  if (kind === 'CLASS')
    await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${parentId} FOR UPDATE`;
  else await database.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${parentId} FOR UPDATE`;
  const prompt = await database.writingPrompt.findFirst({
    where: {
      id: promptId,
      ...(kind === 'CLASS'
        ? { section: { classId: parentId, class: { course: { userId } } } }
        : { practiceSessionId: parentId, practiceSession: { course: { userId } } }),
    },
    include: {
      section: { include: { class: { include: { course: true, lesson: true } } } },
      practiceSession: { include: { course: true } },
    },
  });
  if (!prompt) throw new LearningWritingError('Writing prompt not found', 404);
  const parent = prompt.section?.class ?? prompt.practiceSession;
  if (prompt.section && !(await isCurrentClassSection(database, prompt.section)))
    throw new LearningWritingError('This writing task belongs to an earlier class attempt.', 409);
  if (!parent) throw new LearningWritingError('Writing prompt has no learning session', 409);
  if (!['ACTIVE', 'AVAILABLE', 'IN_PROGRESS'].includes(parent.status))
    throw new LearningWritingError('This learning session no longer accepts writing', 409);
  const requirements = readSkillRequirements(parent.skillRequirements);
  if (requirements && requirements.skills.WRITING.state !== 'REQUIRED')
    throw new LearningWritingError('Writing is not required in this session', 409);
  return {
    courseId: parent.course.id,
    promptId: prompt.id,
    sectionId: prompt.sectionId,
    practiceSessionId: prompt.practiceSessionId,
    attempt: prompt.section?.attempt ?? 1,
    task: prompt.task,
    nativeLang: requirements?.nativeLang ?? parent.course.nativeLang,
    targetLang: requirements?.targetLang ?? parent.course.targetLang,
    level: requirements?.level ?? prompt.section?.class.lesson.level ?? parent.course.currentLevel,
  };
}

/** Pending work is visible before grading, so an older success cannot cover an in-flight edit. */
export async function submitLearningWriting(options: {
  kind: 'CLASS' | 'PRACTICE';
  parentId: string;
  promptId: string;
  userId: string;
  text: string;
  execution: SottoProviderExecution;
}) {
  const { kind, parentId, promptId, userId, text, execution } = options;
  const preflight = await sottoTransaction(
    prisma,
    async (database) => {
      await execution.authorize(database);
      const captured = await readOwnedWriting(database, kind, parentId, promptId, userId);
      const latest = await database.writingResponse.findFirst({
        where: { promptId, userId, attempt: captured.attempt },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (latest?.text.trim() === text.trim()) {
        const saved = writingFeedbackSchema.safeParse(latest);
        if (saved.success)
          return {
            captured,
            cachedGrade: {
              overallScore: saved.data.overallScore,
              corrections: saved.data.corrections,
              feedback: saved.data.feedback,
            },
          };
      }
      return { captured };
    },
    { signal: execution.signal }
  );
  if (preflight.cachedGrade) return preflight.cachedGrade;
  const ai = await resolveCapturedLearningAi(userId, execution);
  const moderation = await captureLearningModerationCredential(execution);
  const selection = {
    provider: ai.provider,
    model: ai.model,
    ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
    ...(ai.isolatedImage ? { isolatedImage: ai.isolatedImage } : {}),
    credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
    moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
  };
  const admission = await sottoTransaction(
    prisma,
    async (database) => {
      await execution.authorize(database);
      const captured = await readOwnedWriting(database, kind, parentId, promptId, userId);
      if (ai.execution.credential)
        await validateSottoExecutionCredential(
          database,
          execution.authorize,
          ai.execution.credential,
          execution.signal
        );
      if (moderation)
        await validateSottoExecutionCredential(
          database,
          execution.authorize,
          moderation,
          execution.signal
        );
      if (!isDeepStrictEqual(captured, preflight.captured))
        throw new LearningWritingError('Writing material changed before admission.', 409);
      let latest = await database.writingResponse.findFirst({
        where: { promptId, userId, attempt: captured.attempt },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (latest && !writingFeedbackSchema.safeParse(latest).success) {
        await reconcileWritingResponse(database, latest.id);
        latest = await database.writingResponse.findUnique({ where: { id: latest.id } });
      }
      if (
        latest &&
        !writingFeedbackSchema.safeParse(latest).success &&
        !(await writingFailureDrained(database, latest.gradingState))
      )
        throw new LearningWritingError(
          'The previous writing grade is pending or has an unknown outcome. Check the saved response before submitting again.',
          409
        );
      if (latest?.text.trim() === text.trim()) {
        const saved = writingFeedbackSchema.safeParse(latest);
        if (saved.success) {
          const { overallScore, corrections, feedback } = saved.data;
          return {
            captured,
            responseId: latest.id,
            cachedGrade: { overallScore, corrections, feedback },
          };
        }
      }
      const pending = await database.writingResponse.create({
        data: {
          promptId,
          userId,
          text,
          sectionId: captured.sectionId,
          practiceSessionId: captured.practiceSessionId,
          attempt: captured.attempt,
        },
      });
      const operation = await admitWritingExecution(database, {
        responseId: pending.id,
        courseId: captured.courseId,
        execution,
        selection,
      });
      return { captured, responseId: pending.id, operation };
    },
    { signal: execution.signal }
  );
  if ('cachedGrade' in admission) return admission.cachedGrade!;
  const validate = async (database: Prisma.TransactionClient) => {
    const current = await readOwnedWriting(database, kind, parentId, promptId, userId);
    if (!isDeepStrictEqual(current, admission.captured))
      throw new LearningWritingError('Writing material changed while grading.', 409);
    const latest = await database.writingResponse.findFirst({
      where: { promptId, userId, attempt: admission.captured.attempt },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (latest?.id !== admission.responseId)
      throw new LearningWritingError('A later response replaced this writing submission.', 409);
  };
  return runWritingExecution({
    responseId: admission.responseId,
    operation: admission.operation!,
    execution,
    validate,
    grade: (gradingExecution) =>
      gradeWriting({
        userId,
        execution: gradingExecution,
        nativeLang: admission.captured.nativeLang,
        targetLang: admission.captured.targetLang,
        level: admission.captured.level,
        task: admission.captured.task,
        text,
      }),
    publish: async (database, grade) => {
      const current = await readOwnedWriting(database, kind, parentId, promptId, userId);
      if (!isDeepStrictEqual(current, admission.captured))
        throw new LearningWritingError(
          'Writing material changed while grading. Submit your answer again.',
          409
        );
      const latest = await database.writingResponse.findFirst({
        where: { promptId, userId, attempt: admission.captured.attempt },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (latest?.id !== admission.responseId)
        throw new LearningWritingError('A later response replaced this writing submission.', 409);
      await database.writingResponse.update({
        where: { id: admission.responseId },
        data: {
          overallScore: grade.overallScore,
          corrections: grade.corrections as unknown as Prisma.InputJsonValue,
          feedback: grade.feedback,
        },
      });
    },
  });
}
