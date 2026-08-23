import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { PracticeSessionNotFoundError } from '@/lib/practice-service';
import { resumePractice } from '@/lib/practice/resume';

type RouteParams = { params: Promise<{ sessionId: string }> };

/** GET /api/v1/practice/[sessionId] — re-enter a practice session still in progress. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { sessionId } = await params;

    return NextResponse.json(await resumePractice(sessionId, authed.userId));
  } catch (error: unknown) {
    if (error instanceof PracticeSessionNotFoundError) {
      return errorResponse('Practice session not found', 404);
    }
    const message = error instanceof Error ? error.message : 'Failed to load practice';
    logger.error('Failed to resume practice', { error: message });
    return errorResponse(message, 500);
  }
}

/**
 * Memory-graph entries this session introduced and nothing else accounts for.
 *
 * Deleting a session must not erase what the learner knows, so a word or
 * grammar point survives if it has ever been reviewed (`reps`/`lastReviewed`),
 * if a class taught it, or if another session still lists it. What is left is
 * the case this exists for: a session that seeded its targets during
 * generation and was discarded before the learner answered anything, which
 * would otherwise leave the course showing reviews due for material that no
 * longer exists anywhere.
 */
async function pruneUntouchedTargets(
  courseId: string,
  lemmas: string[],
  grammarKeys: string[]
): Promise<{ vocab: number; grammar: number }> {
  if (lemmas.length === 0 && grammarKeys.length === 0) return { vocab: 0, grammar: 0 };

  // Read AFTER the session row is gone, so it cannot vouch for its own targets.
  const survivors = await prisma.practiceSession.findMany({
    where: { courseId },
    select: { vocabLemmas: true, grammarKeys: true },
  });
  const claimedLemmas = new Set(survivors.flatMap((s) => s.vocabLemmas));
  const claimedKeys = new Set(survivors.flatMap((s) => s.grammarKeys));

  const orphanLemmas = lemmas.filter((lemma) => !claimedLemmas.has(lemma));
  const orphanKeys = grammarKeys.filter((key) => !claimedKeys.has(key));

  const untouched = { reps: 0, lastReviewed: null };
  const [vocab, grammar] = await Promise.all([
    orphanLemmas.length > 0
      ? prisma.learnerVocab.deleteMany({
          where: { courseId, lemma: { in: orphanLemmas }, firstSeenClassId: null, ...untouched },
        })
      : Promise.resolve({ count: 0 }),
    orphanKeys.length > 0
      ? prisma.learnerGrammar.deleteMany({
          where: { courseId, topicKey: { in: orphanKeys }, ...untouched },
        })
      : Promise.resolve({ count: 0 }),
  ]);
  return { vocab: vocab.count, grammar: grammar.count };
}

/**
 * DELETE /api/v1/practice/[sessionId] — discard a practice session.
 *
 * Its prompts, recordings, and written responses cascade with it. A listening
 * session's episode does not: the relation is SetNull by design, and the audio
 * it points at stays in storage. Memory-graph entries the session introduced
 * and never got reviewed go with it; see pruneUntouchedTargets.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { sessionId } = await params;

    // Scoped through the course, so one learner cannot delete another's
    // session by guessing an id.
    const session = await prisma.practiceSession.findFirst({
      where: { id: sessionId, course: { userId: authed.userId } },
      select: { id: true, courseId: true, vocabLemmas: true, grammarKeys: true },
    });
    if (!session) return errorResponse('Practice session not found', 404);

    await prisma.practiceSession.delete({ where: { id: session.id } });

    const pruned = await pruneUntouchedTargets(
      session.courseId,
      session.vocabLemmas,
      session.grammarKeys
    );
    if (pruned.vocab > 0 || pruned.grammar > 0) {
      logger.info('Pruned memory-graph targets with a discarded practice session', {
        sessionId: session.id,
        vocab: String(pruned.vocab),
        grammar: String(pruned.grammar),
      });
    }

    return NextResponse.json({ deleted: true, pruned });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete practice';
    logger.error('Failed to delete practice session', { error: message });
    return errorResponse(message, 500);
  }
}
