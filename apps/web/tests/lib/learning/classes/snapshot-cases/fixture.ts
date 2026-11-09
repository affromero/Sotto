import { randomUUID } from 'node:crypto';
import { createSkillRequirements } from '@sotto/shared';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureAssessmentCandidate } from '@/lib/learning/classes/material/assessment-snapshot';
import { reserveAssessmentListeningEpisode } from '@/lib/learning/classes/material/assessment-audio-reservation';
import { assessmentFormativeRevision } from '@/lib/learning/classes/material/assessment-formative-revision';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type { SharedTestInstance } from '../../../../helpers/setup/shared-instance';

interface SnapshotFixtureContext {
  instance: SharedTestInstance;
  ownerId: string;
  classId: string;
  courseId: string;
}

export async function createSnapshotFixture(
  { instance, ownerId, classId, courseId }: SnapshotFixtureContext,
  withListening = false,
  withSpeaking = false,
  reserveAudio = true,
  materialVersion: 1 | 2 = 1
) {
  const requirements = createSkillRequirements({
    scope: 'CLASS',
    nativeLang: 'es',
    targetLang: 'ru',
    level: 'A1',
    ttsProvider: withListening ? 'configured' : null,
    sttProvider: withSpeaking ? 'configured-stt' : null,
  });
  await instance.database.courseClass.update({
    where: { id: classId },
    data: { skillRequirements: requirements },
  });
  for (const skill of [
    'GRAMMAR',
    'READING',
    'WRITING',
    ...(withListening ? ['LISTENING'] : []),
    ...(withSpeaking ? ['SPEAKING'] : []),
  ] as const) {
    const formative = await instance.database.classSection.create({
      data: {
        classId,
        skill: skill as 'GRAMMAR' | 'READING' | 'WRITING' | 'LISTENING' | 'SPEAKING',
        status: 'READY',
        seed: skill,
        spec: {},
        passThreshold: 0.7,
      },
    });
    if (skill === 'GRAMMAR')
      await instance.database.lessonQuestion.create({
        data: {
          sectionId: formative.id,
          order: 1,
          skill: 'GRAMMAR',
          question: 'Formative question',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'Reason',
        },
      });
    if (skill === 'LISTENING') {
      const episode = await instance.database.episode.create({
        data: {
          userId: ownerId,
          title: 'Formative listening',
          topic: 'Greetings',
          source: 'CLASS',
          script: {
            create: { turns: [{ speaker: 'HOST', text: 'Привет' }], markdown: 'Привет' },
          },
        },
      });
      await instance.database.classSection.update({
        where: { id: formative.id },
        data: { episodeId: episode.id },
      });
    }
  }
  const materialHash = await instance.database.$transaction((tx) =>
    initialA1MaterialHash(tx, classId, ownerId)
  );
  const receiptId = randomUUID();
  await instance.database.courseClass.update({
    where: { id: classId },
    data: {
      prerequisiteGate: {
        version: 1,
        receiptId,
        classId,
        courseId,
        userId: ownerId,
        attempt: 1,
        materialHash,
        acknowledgment: { userId: ownerId, receiptId, materialHash },
      },
    },
  });
  const { revision } = await instance.database.$transaction((tx) =>
    assessmentFormativeRevision(tx, classId, ownerId)
  );
  const saved = await instance.database.classAssessment.create({
    data: {
      classId,
      courseId,
      userId: ownerId,
      classAttempt: 1,
      assessmentAttempt: 1,
      materialVersion,
      requirements,
      formativeRevision: revision,
      teachingKind: 'BASE',
      teachingReceiptId: receiptId,
      generationOperationId: 'snapshot-generation',
    },
  });
  for (const skill of ['GRAMMAR', 'READING'] as const) {
    const section = await instance.database.classAssessmentSection.create({
      data: {
        assessmentId: saved.id,
        skill,
        passThreshold: 0.7,
        passageText: skill === 'READING' ? 'Привет.' : null,
      },
    });
    for (let index = 0; index < 5; index += 1)
      await instance.database.classAssessmentQuestion.create({
        data: {
          assessmentId: saved.id,
          sectionId: section.id,
          order: index,
          question: `Question ${skill} ${index}`,
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'Reason',
        },
      });
  }
  const writing = await instance.database.classAssessmentSection.create({
    data: { assessmentId: saved.id, skill: 'WRITING', passThreshold: 0.7 },
  });
  for (let index = 0; index < 3; index += 1)
    await instance.database.writingPrompt.create({
      data: {
        assessmentSectionId: writing.id,
        assessmentRubric: 'Criteria',
        order: index,
        task: `Write ${index}`,
        guidance: 'Private guidance',
        ideas: ['Private idea'],
      },
    });
  if (withSpeaking) {
    const speaking = await instance.database.classAssessmentSection.create({
      data: { assessmentId: saved.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    for (let index = 0; index < 4; index += 1)
      await instance.database.speakingPrompt.create({
        data: {
          assessmentSectionId: speaking.id,
          assessmentRubric: 'Criteria',
          assessmentTaskMode: 'READ_ALOUD',
          order: index,
          targetPhrase: `Слово ${index}`,
          translation: `Palabra ${index}`,
        },
      });
  }
  if (withListening) {
    await instance.database.classAssessmentSection.create({
      data: {
        assessmentId: saved.id,
        skill: 'LISTENING',
        passThreshold: 0.7,
      },
    });
  }
  const ownership = await instance.database.$transaction((tx) =>
    capturePrerequisiteOwnership(tx, classId, courseId, ownerId)
  );
  const expected = {
    classId,
    assessmentId: saved.id,
    classAttempt: 1,
    assessmentAttempt: 1,
    ...(materialVersion === 2 ? { materialVersion: 2 as const } : {}),
    generationOperationId: 'snapshot-generation',
    ownership,
  };
  if (withListening && reserveAudio)
    await sottoTransaction(instance.database, (tx) =>
      reserveAssessmentListeningEpisode(tx, authorizedLearnerExecution(ownerId), expected)
    );
  const capture = () =>
    sottoTransaction(instance.database, (tx) =>
      captureAssessmentCandidate(tx, authorizedLearnerExecution(ownerId), expected)
    );
  return { saved, expected, capture };
}
