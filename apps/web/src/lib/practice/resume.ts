/**
 * Re-entering a practice session that is still ACTIVE.
 *
 * Starting a practice is expensive — it spends LLM and TTS credits building
 * questions, prompts, and audio — so leaving one halfway should not throw that
 * away. This reads a session back into exactly the shape `startPractice`
 * returns, which is what `PracticeRunner` already knows how to render.
 *
 * Restores saved choices, drafts, latest evidence and the completion receipt.
 *
 * Lives outside practice-service.ts, which is already at its length ceiling.
 */
import { prisma, prismaUnfiltered } from '../prisma';
import { readSkillRequirements } from '../learning/skill-requirements';
import { z } from 'zod';
import {
  practiceReceiptSchema,
  speakingEvidenceSchema,
  writingFeedbackSchema,
} from '@sotto/shared';
import { practicePreparationSchema } from './preparation-state';
import { practicePreparationProgress, reconcilePracticePreparation } from './preparation';
import {
  readLearningFailure,
  learningFailureReason,
} from '../classes/quality/teaching-failure-store';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import {
  PracticeSessionNotFoundError,
  type PracticeMcItemPublic,
  type StartPracticeResult,
} from '../practice-service';

/** The stored item carries the answer key; only these three fields go out. */
interface StoredMcItem extends PracticeMcItemPublic {
  correctIndex: number;
}

function toPublic(item: StoredMcItem): PracticeMcItemPublic {
  return {
    id: item.id,
    prompt: item.prompt,
    options: item.options,
    ...(item.passageText ? { passageText: item.passageText } : {}),
  };
}

export async function resumePractice(
  sessionId: string,
  userId: string
): Promise<StartPracticeResult> {
  const readSession = () =>
    prisma.practiceSession.findFirst({
      where: { id: sessionId, course: { userId } },
      select: {
        id: true,
        kind: true,
        status: true,
        items: true,
        episodeId: true,
        skillRequirements: true,
        learnerAnswers: true,
        writingDrafts: true,
        submissionResult: true,
        progressRevision: true,
        generationState: true,
      },
    });
  let session = await readSession();
  if (!session) throw new PracticeSessionNotFoundError('Practice session not found');
  if (session.generationState) {
    const stored = practicePreparationSchema.parse(session.generationState);
    const operation = ['CANCELLING', 'RUNNING'].includes(stored.status)
      ? await reconcilePracticePreparation(sessionId, userId)
      : stored;
    if (operation.status === 'COMPLETED' && ['CANCELLING', 'RUNNING'].includes(stored.status)) {
      session = await readSession();
      if (!session?.generationState)
        throw new PracticeSessionNotFoundError('Practice preparation changed');
      const published = practicePreparationSchema.parse(session.generationState);
      if (
        published.id !== stored.id ||
        operation.id !== stored.id ||
        published.sessionId !== sessionId ||
        published.userId !== userId ||
        published.inputFingerprint !== stored.inputFingerprint ||
        published.status !== 'COMPLETED'
      )
        throw new PracticeSessionNotFoundError('Practice preparation changed');
    }
    if (operation.unavailableReason)
      return { status: 'unavailable', reason: operation.unavailableReason };
    if (
      operation.status !== 'COMPLETED' &&
      session.status !== 'ACTIVE' &&
      session.status !== 'COMPLETED'
    ) {
      const progress = practicePreparationProgress(operation);
      if (operation.status !== 'FAILED' || operation.failure !== 'generation_failed')
        return progress;
      const failure = await sottoTransaction(prismaUnfiltered, async (database) => {
        const owned = await database.practiceSession.findFirst({
          where: { id: sessionId, course: { userId } },
          select: { id: true, generationState: true },
        });
        if (!owned) throw new PracticeSessionNotFoundError('Practice session not found');
        const current = practicePreparationSchema.parse(owned.generationState);
        if (current.id !== operation.id || current.userId !== userId)
          throw new PracticeSessionNotFoundError('Practice preparation changed');
        return readLearningFailure(database, current);
      });
      return failure ? { ...progress, message: learningFailureReason(failure) } : progress;
    }
  }
  if (session.status !== 'ACTIVE' && !session.submissionResult) {
    throw new PracticeSessionNotFoundError('Practice session is already complete');
  }

  const items = ((session.items as unknown as StoredMcItem[]) ?? []).map(toPublic);
  const answers = z
    .record(z.string(), z.number().int().min(0).max(3))
    .safeParse(session.learnerAnswers);
  const drafts = z.record(z.string(), z.string()).safeParse(session.writingDrafts);
  const requirements = readSkillRequirements(session.skillRequirements);
  const progress = {
    progressRevision: session.progressRevision,
    ...(requirements ? { skillRequirements: requirements } : {}),
    ...(answers.success ? { learnerAnswers: answers.data } : {}),
    ...(drafts.success ? { writingDrafts: drafts.data } : {}),
    ...(session.submissionResult
      ? {
          submissionResult: practiceReceiptSchema.parse(session.submissionResult),
        }
      : {}),
  };

  if (session.kind === 'SPEAKING' || session.kind === 'FULL') {
    const prompts = await prisma.speakingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        targetPhrase: true,
        translation: true,
        referenceTtsUrl: true,
        recordings: {
          where: { userId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            status: true,
            transcript: true,
            overallScore: true,
            rubricScores: true,
            feedback: true,
          },
        },
      },
    });
    const speakingPrompts = prompts.map(({ recordings, ...prompt }) => ({
      ...prompt,
      latestRecording: recordings[0]
        ? speakingEvidenceSchema.parse({ ...recordings[0], recordingId: recordings[0].id })
        : null,
    }));
    if (session.kind === 'SPEAKING') {
      return {
        ...progress,
        status: 'ready_speaking',
        sessionId: session.id,
        prompts: speakingPrompts,
      };
    }

    const writingPrompts = await readWritingPrompts(session.id, userId);
    return {
      status: 'ready_full',
      ...progress,
      sessionId: session.id,
      kind: 'FULL',
      items,
      episodeId: session.episodeId ?? undefined,
      speakingPrompts,
      writingPrompts,
    };
  }

  if (session.kind === 'WRITING') {
    const prompts = await readWritingPrompts(session.id, userId);
    return { ...progress, status: 'ready_writing', sessionId: session.id, prompts };
  }

  return {
    status: 'ready',
    ...progress,
    sessionId: session.id,
    kind: session.kind,
    items,
    episodeId: session.episodeId ?? undefined,
  };
}

async function readWritingPrompts(sessionId: string, userId: string) {
  const prompts = await prisma.writingPrompt.findMany({
    where: { practiceSessionId: sessionId },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      task: true,
      guidance: true,
      ideas: true,
      responses: {
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { text: true, overallScore: true, corrections: true, feedback: true },
      },
    },
  });
  return prompts.map(({ responses, ...prompt }) => {
    const latest = responses[0];
    const grade = writingFeedbackSchema.safeParse(latest);
    return { ...prompt, savedDraft: latest?.text, response: grade.success ? grade.data : null };
  });
}
