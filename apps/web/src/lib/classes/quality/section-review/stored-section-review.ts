import { isDeepStrictEqual } from 'node:util';
import type { LearningDatabase } from '../../../learning/database';
import { currentClassSections } from '../../../learning/classes/progress/current-sections';
import { SectionQualityError } from '../../section-quality';
import type { InitialA1SectionSnapshot } from './section-review-proof';
import type { InitialA1WritingSnapshot } from './writing-review-proof';
import type { InitialA1SpeakingSnapshot } from './speaking-review-proof';
import type { InitialA1ListeningSnapshot } from './listening-review-proof';

/** Recheck exact reviewed rows and current section selection inside publication. */
export async function requireStoredInitialA1Sections(
  database: LearningDatabase,
  classId: string,
  expected: readonly InitialA1SectionSnapshot[]
) {
  const rows = await database.classSection.findMany({
    where: { classId, skill: { in: ['GRAMMAR', 'READING'] } },
    select: {
      id: true,
      skill: true,
      attempt: true,
      withdrawn: true,
      seed: true,
      questions: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          order: true,
          question: true,
          options: true,
          correctIndex: true,
          explanation: true,
          passageRef: true,
          passageText: true,
        },
      },
    },
  });
  const current = currentClassSections(rows);
  if (current.length !== expected.length)
    throw new SectionQualityError('The reviewed exercises changed before publication.');
  for (const proof of expected) {
    const matches = current.filter((section) => section.skill === proof.skill);
    const section = matches[0];
    if (
      matches.length !== 1 ||
      !section ||
      section.id !== proof.sectionId ||
      section.attempt !== proof.attempt ||
      section.seed !== proof.seed ||
      !isDeepStrictEqual(section.questions, proof.questions)
    )
      throw new SectionQualityError('The reviewed exercises changed before publication.');
  }
}

/** Recheck the reviewed writing prompts without including learner responses. */
export async function requireStoredInitialA1Writing(
  database: LearningDatabase,
  classId: string,
  expected: InitialA1WritingSnapshot
) {
  const rows = await database.classSection.findMany({
    where: { classId, skill: 'WRITING' },
    select: {
      id: true,
      skill: true,
      attempt: true,
      withdrawn: true,
      seed: true,
      writingPrompts: {
        orderBy: { order: 'asc' },
        select: { id: true, order: true, task: true, guidance: true, ideas: true },
      },
    },
  });
  const current = currentClassSections(rows);
  const section = current[0];
  if (
    current.length !== 1 ||
    !section ||
    section.id !== expected.sectionId ||
    section.attempt !== expected.attempt ||
    section.seed !== expected.seed ||
    !isDeepStrictEqual(section.writingPrompts, expected.prompts)
  )
    throw new SectionQualityError('The reviewed writing tasks changed before publication.');
}

/** Verify speaking tasks and their published references while excluding learner recordings. */
export async function requireStoredInitialA1Speaking(
  database: LearningDatabase,
  classId: string,
  expected: InitialA1SpeakingSnapshot
) {
  const rows = await database.classSection.findMany({
    where: { classId, skill: 'SPEAKING' },
    select: {
      id: true,
      skill: true,
      attempt: true,
      withdrawn: true,
      seed: true,
      prompts: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          order: true,
          targetPhrase: true,
          translation: true,
          ipa: true,
          referenceTtsUrl: true,
          learningObjectives: true,
        },
      },
    },
  });
  const current = currentClassSections(rows);
  const section = current[0];
  if (
    current.length !== 1 ||
    !section ||
    section.id !== expected.sectionId ||
    section.attempt !== expected.attempt ||
    section.seed !== expected.seed ||
    !isDeepStrictEqual(section.prompts, expected.prompts)
  )
    throw new SectionQualityError('The reviewed speaking tasks changed before publication.');
}

/** Match the listening questions to the exact reviewed, owned script. */
export async function requireStoredInitialA1Listening(
  database: LearningDatabase,
  classId: string,
  expected: InitialA1ListeningSnapshot
) {
  const rows = await database.classSection.findMany({
    where: { classId, skill: 'LISTENING' },
    select: {
      id: true,
      skill: true,
      attempt: true,
      withdrawn: true,
      seed: true,
      spec: true,
      episodeId: true,
      questions: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          order: true,
          question: true,
          options: true,
          correctIndex: true,
          explanation: true,
        },
      },
      episode: {
        select: {
          id: true,
          userId: true,
          source: true,
          deletedAt: true,
          script: {
            select: { id: true, turns: true, soundCues: true, markdown: true, version: true },
          },
        },
      },
    },
  });
  const current = currentClassSections(rows);
  const section = current[0];
  const episode = section?.episode;
  if (
    current.length !== 1 ||
    !section ||
    section.id !== expected.sectionId ||
    section.attempt !== expected.attempt ||
    section.seed !== expected.seed ||
    section.episodeId !== expected.episodeId ||
    !episode ||
    episode.id !== expected.episodeId ||
    episode.userId !== expected.userId ||
    episode.source !== 'CLASS' ||
    episode.deletedAt !== null ||
    !isDeepStrictEqual(section.spec, {
      objective: expected.objective,
      scriptHash: expected.scriptHash,
    }) ||
    !isDeepStrictEqual(section.questions, expected.questions) ||
    !episode.script ||
    episode.script.id !== expected.scriptId ||
    episode.script.version !== 1 ||
    !isDeepStrictEqual(episode.script.turns, expected.turns) ||
    !isDeepStrictEqual(episode.script.soundCues, expected.soundCues) ||
    episode.script.markdown !== expected.markdown
  )
    throw new SectionQualityError('The reviewed listening material changed before publication.');
}
