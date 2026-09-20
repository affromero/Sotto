import { StorageWriteJournal } from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import {
  captureCourseStorage,
  CourseStorageChangedError,
} from '@/lib/sidedoor/storage/core/course-storage';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';

type Scope = { subjectId: string; generation: number };
type Parents = {
  sectionId: string | null;
  practiceSessionId: string | null;
  examSectionId: string | null;
};
export class SpeakingStorageChangedError extends Error {
  constructor() {
    super('Speaking storage ownership or associations changed');
    this.name = 'SpeakingStorageChangedError';
  }
}

async function profileScope(database: Prisma.TransactionClient, id: string): Promise<Scope> {
  const profile = await database.user.findUnique({ where: { id }, select: { createdAt: true } });
  if (!profile) throw new SpeakingStorageChangedError();
  return { subjectId: `profile:${id}`, generation: profile.createdAt.getTime() };
}

async function parentScopes(database: Prisma.TransactionClient, parents: Parents) {
  const scopes: Scope[] = [];
  const associations: Array<{ kind: string; id: string; courseId: string; parentId: string }> = [];
  if (parents.sectionId) {
    const section = await database.classSection.findUnique({
      where: { id: parents.sectionId },
      select: {
        id: true,
        classId: true,
        class: { select: { courseId: true } },
      },
    });
    if (!section) throw new SpeakingStorageChangedError();
    scopes.push(...(await captureCourseStorage(database, section.class.courseId)).scopes);
    associations.push({
      kind: 'class',
      id: section.id,
      parentId: section.classId,
      courseId: section.class.courseId,
    });
  }
  if (parents.practiceSessionId) {
    const practice = await database.practiceSession.findUnique({
      where: { id: parents.practiceSessionId },
      select: { id: true, courseId: true },
    });
    if (!practice) throw new SpeakingStorageChangedError();
    scopes.push(...(await captureCourseStorage(database, practice.courseId)).scopes);
    associations.push({
      kind: 'practice',
      id: practice.id,
      parentId: practice.id,
      courseId: practice.courseId,
    });
  }
  if (parents.examSectionId) {
    const section = await database.examSection.findUnique({
      where: { id: parents.examSectionId },
      select: {
        id: true,
        examId: true,
        exam: { select: { courseId: true, userId: true } },
      },
    });
    if (!section) throw new SpeakingStorageChangedError();
    scopes.push(
      ...(await captureCourseStorage(database, section.exam.courseId)).scopes,
      await profileScope(database, section.exam.userId)
    );
    associations.push({
      kind: 'exam',
      id: section.id,
      parentId: section.examId,
      courseId: section.exam.courseId,
    });
  }
  return { scopes, associations };
}

async function captureScopes(database: Prisma.TransactionClient, scopes: Scope[]) {
  const instance = await sottoStorageInstance(database).read();
  const subjects = new Map<string, number>([[instance.subjectId, instance.generation]]);
  for (const scope of scopes) {
    const saved = subjects.get(scope.subjectId);
    if (saved !== undefined && saved !== scope.generation) throw new SpeakingStorageChangedError();
    subjects.set(scope.subjectId, scope.generation);
  }
  const writes = new StorageWriteJournal(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  const captured = [...subjects]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([subjectId, generation]) => ({ subjectId, generation }));
  for (const scope of captured)
    if (await writes.tombstone(scope.subjectId)) throw new SpeakingStorageChangedError();
  return { instanceId: instance.instanceId, scopes: captured };
}

/** Preserve every populated parent, including cross-profile exam ownership. */
export async function captureSpeakingPromptStorage(database: Prisma.TransactionClient, id: string) {
  const prompt = await database.speakingPrompt.findUnique({
    where: { id },
    select: {
      id: true,
      createdAt: true,
      referenceTtsUrl: true,
      sectionId: true,
      practiceSessionId: true,
      examSectionId: true,
    },
  });
  if (!prompt) throw new SpeakingStorageChangedError();
  try {
    const parents = await parentScopes(database, prompt);
    if (!parents.associations.length) throw new SpeakingStorageChangedError();
    return {
      ...(await captureScopes(database, parents.scopes)),
      reference: prompt.referenceTtsUrl,
      associations: {
        promptId: prompt.id,
        createdAt: prompt.createdAt.getTime(),
        parents: parents.associations,
      },
    };
  } catch (error) {
    if (error instanceof CourseStorageChangedError) throw new SpeakingStorageChangedError();
    throw error;
  }
}

/** Recording scalar section IDs are checked explicitly; they are not database cascade edges. */
export async function captureSpeakingRecordingStorage(
  database: Prisma.TransactionClient,
  id: string
) {
  const recording = await database.speakingRecording.findUnique({
    where: { id },
    select: {
      id: true,
      createdAt: true,
      audioUrl: true,
      promptId: true,
      userId: true,
      sectionId: true,
      practiceSessionId: true,
      examSectionId: true,
    },
  });
  if (!recording) throw new SpeakingStorageChangedError();
  try {
    const prompt = await captureSpeakingPromptStorage(database, recording.promptId);
    const parents = await parentScopes(database, recording);
    return {
      ...(await captureScopes(database, [
        ...prompt.scopes,
        ...parents.scopes,
        await profileScope(database, recording.userId),
      ])),
      reference: recording.audioUrl,
      associations: {
        recordingId: recording.id,
        createdAt: recording.createdAt.getTime(),
        userId: recording.userId,
        prompt: prompt.associations,
        parents: parents.associations,
      },
    };
  } catch (error) {
    if (error instanceof CourseStorageChangedError) throw new SpeakingStorageChangedError();
    throw error;
  }
}
