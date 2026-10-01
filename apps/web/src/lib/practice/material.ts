import { z } from 'zod';
import { assertStoredReadingVocabulary } from '../learning/reading-vocabulary';
import { learningScriptHash } from '../learning/script-hash';
import { resolveStorageInput } from '../sidedoor/storage/core/storage-inputs';
import type { LearningDatabase } from '../learning/database';
import { readSkillRequirements } from '../learning/skill-requirements';
import { assertLearningMaterial, LearningIncompleteError } from '../learning/session-evaluation';

const storedItemsSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      prompt: z.string().trim().min(1),
      options: z
        .array(z.string().trim().min(1))
        .length(4)
        .refine((options) => new Set(options.map((option) => option.toLowerCase())).size === 4),
      correctIndex: z.number().int().min(0).max(3),
      explanation: z.string().trim().min(1),
      passageText: z.string().optional(),
    })
  )
  .max(256);

/** Validate stored material after prompts and owned references publish, before activation. */
export async function assertStoredPracticeMaterial(database: LearningDatabase, sessionId: string) {
  const session = await database.practiceSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      course: { select: { userId: true } },
      prompts: true,
      writingPrompts: true,
      episode: { include: { script: true } },
    },
  });
  const requirements = readSkillRequirements(session.skillRequirements);
  if (!requirements) throw new LearningIncompleteError('Practice requirements are unavailable.');
  const parsedItems = storedItemsSchema.safeParse(session.items);
  if (!parsedItems.success)
    throw new LearningIncompleteError(
      'Practice questions are incomplete or have duplicated choices.'
    );
  const items = parsedItems.data;
  if (session.prompts.some((prompt) => !prompt.targetPhrase.trim() || !prompt.translation.trim()))
    throw new LearningIncompleteError('Speaking prompts are incomplete.', ['SPEAKING']);
  if (session.writingPrompts.some((prompt) => !prompt.task.trim()))
    throw new LearningIncompleteError('Writing tasks are incomplete.', ['WRITING']);
  if (
    requirements.skills.LISTENING.state === 'REQUIRED' &&
    (!session.episode?.script ||
      session.episode.deletedAt ||
      session.episode.userId !== session.course.userId ||
      !z
        .array(z.object({ text: z.string().trim().min(1) }))
        .min(1)
        .safeParse(session.episode.script.turns).success ||
      session.listeningScriptHash !== learningScriptHash(session.episode.script.turns))
  )
    throw new LearningIncompleteError(
      'Listening questions do not match the preserved owned script.',
      ['LISTENING']
    );
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new LearningIncompleteError('Practice question identities are duplicated.');
  if (requirements.referenceAudioRequired)
    for (const prompt of session.prompts) {
      if (!prompt.referenceTtsUrl)
        throw new LearningIncompleteError('Speaking reference audio is missing.', ['SPEAKING']);
      await resolveStorageInput(database, {
        consumer: `speaking-prompt:${prompt.id}:reference`,
        reference: prompt.referenceTtsUrl,
      });
    }
  if (session.kind === 'VOCAB') {
    if (!items.length) throw new LearningIncompleteError('Vocabulary exercises are unavailable.');
    return;
  }
  const mc = (skill: 'GRAMMAR' | 'READING' | 'LISTENING', prefix: string) => {
    const questions = items.filter((item) =>
      session.kind === 'FULL'
        ? item.id.startsWith(prefix)
        : session.kind === skill && !item.id.startsWith('f')
    );
    return {
      skill,
      itemIds: questions.map((item) => item.id),
      passageText: questions.find((item) => item.passageText)?.passageText,
      audio: skill === 'LISTENING' && !session.episode?.deletedAt ? session.episode : null,
    };
  };
  assertLearningMaterial(requirements, [
    mc('GRAMMAR', 'g'),
    mc('READING', 'r'),
    mc('LISTENING', 'l'),
    {
      skill: 'SPEAKING',
      itemIds: session.prompts.map((prompt) => prompt.id),
      referenceAudioUrls: session.prompts.map((prompt) => prompt.referenceTtsUrl),
    },
    { skill: 'WRITING', itemIds: session.writingPrompts.map((prompt) => prompt.id) },
  ]);
  if (requirements.skills.READING.state === 'REQUIRED')
    await assertStoredReadingVocabulary(
      database,
      session.courseId,
      session.readingVocabulary,
      items.filter((item) =>
        session.kind === 'FULL'
          ? item.id.startsWith('r')
          : session.kind === 'READING' && !item.id.startsWith('f')
      )
    );
}
