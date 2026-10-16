import { readingVocabularySchema } from '@sotto/shared';
import { classTargetsFromSeed } from '../../classes/lesson/class-targets';
import { seedLessonItems } from '../../knowledge-graph';
import type { LearningDatabase } from '../database';
import { LearningIncompleteError } from '../session-evaluation';
import { readSkillRequirements } from '../skill-requirements';
import { currentClassSections } from './current-sections';

/** These writes commit only with the final material and active-course publication checks. */
export async function seedPublishedClassMemory(
  database: LearningDatabase,
  classId: string,
  userId: string,
  adaptiveSeed: unknown
): Promise<void> {
  const cls = await database.courseClass.findUniqueOrThrow({
    where: { id: classId },
    select: {
      courseId: true,
      adaptiveSeed: true,
      readingVocabulary: true,
      skillRequirements: true,
      course: { select: { userId: true } },
      sections: {
        select: {
          skill: true,
          attempt: true,
          episode: {
            select: {
              userId: true,
              deletedAt: true,
              vocabularyEntries: true,
            },
          },
        },
      },
    },
  });
  const requirements = readSkillRequirements(cls.skillRequirements);
  if (cls.course.userId !== userId || !requirements || requirements.scope !== 'CLASS')
    throw new LearningIncompleteError('Class memory needs the owned class requirements.');

  const seed = adaptiveSeed === undefined ? cls.adaptiveSeed : adaptiveSeed;
  const targets = classTargetsFromSeed(seed);
  await seedLessonItems(
    cls.courseId,
    classId,
    requirements.level,
    targets?.vocab ?? [],
    targets?.grammarPoints ?? [],
    database
  );

  if (requirements.skills.READING.state === 'REQUIRED') {
    const reading = readingVocabularySchema.parse(cls.readingVocabulary);
    await seedLessonItems(cls.courseId, classId, requirements.level, reading.words, [], database);
  }

  if (requirements.skills.LISTENING.state !== 'REQUIRED') return;
  for (const section of currentClassSections(cls.sections)) {
    if (section.skill !== 'LISTENING' || !section.episode) continue;
    const episode = section.episode;
    if (episode.userId !== userId || episode.deletedAt)
      throw new LearningIncompleteError('Listening memory needs its owned current episode.', [
        'LISTENING',
      ]);
    await seedLessonItems(
      cls.courseId,
      classId,
      requirements.level,
      episode.vocabularyEntries.map((word) => ({
        lemma: word.word,
        gloss: word.translation,
        pos: word.partOfSpeech ?? undefined,
        pronunciation: word.pronunciation ?? undefined,
      })),
      [],
      database
    );
  }
}
