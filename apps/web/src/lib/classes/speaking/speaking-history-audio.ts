import type { Prisma } from '@/generated/prisma/client';
import { captureSpeakingRecordingStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';

/** Capture one published class recording and its current registered storage identity. */
export async function captureSpeakingHistoryAudio(
  database: Prisma.TransactionClient,
  input: { classId: string; promptId: string; recordingId: string; userId: string }
) {
  await database.$queryRaw`
    SELECT cls.id FROM "CourseClass" cls JOIN "Course" c ON c.id = cls."courseId"
    WHERE cls.id = ${input.classId} AND c."userId" = ${input.userId} FOR UPDATE OF cls
  `;
  const recording = await database.speakingRecording.findFirst({
    where: {
      id: input.recordingId,
      userId: input.userId,
      promptId: input.promptId,
      practiceSessionId: null,
      examSectionId: null,
      assessmentSectionId: null,
      prompt: {
        section: {
          classId: input.classId,
          withdrawn: false,
          class: { course: { userId: input.userId } },
        },
        practiceSessionId: null,
        examSectionId: null,
        assessmentSectionId: null,
      },
    },
    select: {
      id: true,
      incarnationId: true,
      promptId: true,
      sectionId: true,
      userId: true,
      audioUrl: true,
      prompt: {
        select: {
          id: true,
          incarnationId: true,
          sectionId: true,
          section: { select: { id: true, incarnationId: true } },
        },
      },
    },
  });
  if (
    !recording ||
    !recording.prompt.section ||
    (recording.sectionId !== null && recording.sectionId !== recording.prompt.sectionId)
  )
    return null;
  const ownership = await captureSpeakingRecordingStorage(database, recording.id);
  if (ownership.reference !== recording.audioUrl) return null;
  const storage = await resolveStorageInput(database, {
    consumer: `recording:${recording.id}:audio`,
    reference: recording.audioUrl,
  });
  return { recording, ownership, storage };
}
