import type { Prisma } from '@/generated/prisma/client';
import { sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { captureSpeakingPromptStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import {
  readClassTeachingPreludeInTransaction,
  readInitialA1PracticeAuthorization,
} from '@/lib/classes/lesson/initial-a1-provenance';
import { isCurrentClassSection } from '@/lib/learning/classes/progress/current-sections';
import {
  speakingReferenceEnvelopeSchema,
  speakingReferenceObjectBytes,
} from './speaking-reference-crypto';

/** Capture a published, learner-owned encrypted reference and its live storage identity. */
export async function captureSpeakingReferenceAudio(
  database: Prisma.TransactionClient,
  input: { classId: string; promptId: string; userId: string }
) {
  await database.$queryRaw`
    SELECT cls.id FROM "CourseClass" cls JOIN "Course" c ON c.id = cls."courseId"
    WHERE cls.id = ${input.classId} AND c."userId" = ${input.userId} FOR UPDATE OF cls
  `;
  const prompt = await database.speakingPrompt.findFirst({
    where: {
      id: input.promptId,
      practiceSessionId: null,
      examSectionId: null,
      assessmentSectionId: null,
      section: {
        classId: input.classId,
        skill: 'SPEAKING',
        withdrawn: false,
        class: { course: { userId: input.userId } },
      },
    },
    select: {
      id: true,
      incarnationId: true,
      referenceTtsUrl: true,
      referenceEncryption: true,
      section: {
        select: {
          id: true,
          incarnationId: true,
          attempt: true,
          classId: true,
          skill: true,
          withdrawn: true,
          class: {
            select: {
              id: true,
              createdAt: true,
              course: {
                select: {
                  id: true,
                  createdAt: true,
                  user: { select: { id: true, createdAt: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!prompt?.section || !prompt.referenceTtsUrl || !prompt.referenceEncryption) return null;
  if (!(await isCurrentClassSection(database, prompt.section))) return null;
  const prelude = await readClassTeachingPreludeInTransaction(
    database,
    input.classId,
    input.userId
  );
  const practiceAuthorization =
    prelude.kind === 'REPLAY'
      ? { kind: 'REPLAY' as const }
      : await readInitialA1PracticeAuthorization(database, input.classId, input.userId);
  const parsed = speakingReferenceEnvelopeSchema.safeParse(prompt.referenceEncryption);
  if (!parsed.success) throw new Error('Invalid speaking reference envelope');
  const envelope = parsed.data;
  const objectBytes = speakingReferenceObjectBytes(envelope);
  const instance = await sottoStorageInstance(database).read();
  const cls = prompt.section.class;
  const binding = {
    ...envelope.binding,
    instanceId: instance.instanceId,
    userId: cls.course.user.id,
    userCreatedAt: cls.course.user.createdAt.getTime(),
    courseId: cls.course.id,
    courseCreatedAt: cls.course.createdAt.getTime(),
    classId: cls.id,
    classCreatedAt: cls.createdAt.getTime(),
    sectionId: prompt.section.id,
    sectionIncarnationId: prompt.section.incarnationId,
    promptId: prompt.id,
    promptIncarnationId: prompt.incarnationId,
    attempt: prompt.section.attempt,
  };
  const ownership = await captureSpeakingPromptStorage(database, prompt.id);
  if (ownership.reference !== prompt.referenceTtsUrl) return null;
  const storage = await resolveStorageInput(database, {
    consumer: `speaking-prompt:${prompt.id}:reference`,
    reference: prompt.referenceTtsUrl,
  });
  return { prompt, envelope, binding, objectBytes, ownership, storage, practiceAuthorization };
}
