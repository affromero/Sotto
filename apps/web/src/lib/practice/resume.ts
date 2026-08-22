/**
 * Re-entering a practice session that is still ACTIVE.
 *
 * Starting a practice is expensive — it spends LLM and TTS credits building
 * questions, prompts, and audio — so leaving one halfway should not throw that
 * away. This reads a session back into exactly the shape `startPractice`
 * returns, which is what `PracticeRunner` already knows how to render.
 *
 * It restores the material, not the learner's in-flight answers: multiple
 * choice selections live only in the runner's client state, so a resumed
 * session shows every question unanswered. Speaking and writing responses are
 * persisted per prompt and are unaffected.
 *
 * Lives outside practice-service.ts, which is already at its length ceiling.
 */
import { prisma } from '../prisma';
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
  return { id: item.id, prompt: item.prompt, options: item.options };
}

export async function resumePractice(
  sessionId: string,
  userId: string
): Promise<StartPracticeResult> {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, course: { userId } },
    select: { id: true, kind: true, status: true, items: true, episodeId: true },
  });
  if (!session) throw new PracticeSessionNotFoundError('Practice session not found');
  if (session.status !== 'ACTIVE') {
    throw new PracticeSessionNotFoundError('Practice session is already complete');
  }

  const items = ((session.items as unknown as StoredMcItem[]) ?? []).map(toPublic);

  if (session.kind === 'SPEAKING' || session.kind === 'FULL') {
    const prompts = await prisma.speakingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: { id: true, targetPhrase: true, translation: true, referenceTtsUrl: true },
    });
    if (session.kind === 'SPEAKING') {
      return { status: 'ready_speaking', sessionId: session.id, prompts };
    }

    const writingPrompts = await prisma.writingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: { id: true, task: true, guidance: true, ideas: true },
    });
    return {
      status: 'ready_full',
      sessionId: session.id,
      kind: 'FULL',
      items,
      episodeId: session.episodeId ?? undefined,
      speakingPrompts: prompts,
      writingPrompts,
    };
  }

  if (session.kind === 'WRITING') {
    const prompts = await prisma.writingPrompt.findMany({
      where: { practiceSessionId: session.id },
      orderBy: { order: 'asc' },
      select: { id: true, task: true, guidance: true, ideas: true },
    });
    return { status: 'ready_writing', sessionId: session.id, prompts };
  }

  return {
    status: 'ready',
    sessionId: session.id,
    kind: session.kind,
    items,
    episodeId: session.episodeId ?? undefined,
  };
}
