import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AccessError } from 'thesidedoor-core/access';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import {
  captureSpeakingPromptStorage,
  captureSpeakingRecordingStorage,
} from '@/lib/sidedoor/storage/core/speaking-storage';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { readSkillRequirements } from '@/lib/learning/skill-requirements';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  getConfiguredSttProviderId,
  resolveCapturedSttProvider,
  type SttProviderId,
} from '@/lib/providers/stt';
import { getServerInfra } from '@/lib/server-config';
import { isCurrentClassSection } from '@/lib/learning/classes/current-sections';

type RecordingParent =
  | { sectionId: string; practiceSessionId?: never; examSectionId?: never }
  | { sectionId?: never; practiceSessionId: string; examSectionId?: never }
  | { sectionId?: never; practiceSessionId?: never; examSectionId: string };

interface SpeakingRecordingSnapshot {
  attempt: number;
  sttProvider: string | null;
  targetLang: string;
  prompt: Awaited<ReturnType<typeof captureSpeakingPromptStorage>>;
  profile: { subjectId: string; generation: number };
  parent: RecordingParent;
}

async function captureSnapshot(
  database: Parameters<typeof captureSpeakingPromptStorage>[0],
  promptId: string,
  userId: string,
  parent: RecordingParent
): Promise<SpeakingRecordingSnapshot> {
  if ('sectionId' in parent)
    await database.$queryRaw`SELECT c.id FROM "CourseClass" c JOIN "ClassSection" s ON s."classId" = c.id WHERE s.id = ${parent.sectionId} FOR UPDATE OF c`;
  else if ('practiceSessionId' in parent)
    await database.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${parent.practiceSessionId} FOR UPDATE`;
  const [prompt, profile] = await Promise.all([
    captureSpeakingPromptStorage(database, promptId),
    database.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
  ]);
  if (!profile) throw new AccessError('unauthorized');
  const association = prompt.associations.parents.find((candidate) => {
    if ('sectionId' in parent)
      return candidate.kind === 'class' && candidate.id === parent.sectionId;
    if ('practiceSessionId' in parent)
      return candidate.kind === 'practice' && candidate.id === parent.practiceSessionId;
    return candidate.kind === 'exam' && candidate.id === parent.examSectionId;
  });
  if (!association) throw new AccessError('conflict', 'The speaking prompt parent changed');
  const section =
    'sectionId' in parent
      ? await database.classSection.findUnique({
          where: { id: parent.sectionId },
          select: {
            classId: true,
            skill: true,
            attempt: true,
            class: {
              select: {
                status: true,
                skillRequirements: true,
                course: { select: { targetLang: true } },
              },
            },
          },
        })
      : null;
  const practice =
    'practiceSessionId' in parent
      ? await database.practiceSession.findUnique({
          where: { id: parent.practiceSessionId },
          select: {
            status: true,
            skillRequirements: true,
            course: { select: { targetLang: true } },
          },
        })
      : null;
  if (section && !['AVAILABLE', 'IN_PROGRESS'].includes(section.class.status))
    throw new AccessError('conflict', 'This class no longer accepts recordings');
  if (section && !(await isCurrentClassSection(database, section)))
    throw new AccessError('conflict', 'This speaking prompt belongs to an earlier class attempt');
  if (practice && practice.status !== 'ACTIVE')
    throw new AccessError('conflict', 'This practice no longer accepts recordings');
  const requirements = readSkillRequirements(
    section?.class.skillRequirements ?? practice?.skillRequirements
  );
  if (requirements && requirements.skills.SPEAKING.state !== 'REQUIRED')
    throw new AccessError('conflict', 'Speaking is not required in this session');
  const exam =
    'examSectionId' in parent
      ? await database.examSection.findUnique({
          where: { id: parent.examSectionId },
          select: { exam: { select: { course: { select: { targetLang: true } } } } },
        })
      : null;
  const targetLang =
    requirements?.targetLang ??
    section?.class.course.targetLang ??
    practice?.course.targetLang ??
    exam?.exam.course.targetLang;
  if (!targetLang) throw new AccessError('conflict', 'The speaking language is unavailable');
  return {
    attempt: section?.attempt ?? 1,
    sttProvider: requirements?.sttProvider ?? null,
    targetLang,
    prompt,
    profile: { subjectId: `profile:${userId}`, generation: profile.createdAt.getTime() },
    parent,
  };
}

/** Publish the audio and its database reference through one owned storage transaction. */
export async function createSpeakingRecording(options: {
  request: Request;
  admission: AuthenticatedRequest;
  promptId: string;
  parent: RecordingParent;
  audio: Uint8Array;
  extension: string;
  contentType: string;
}) {
  const { request, admission, promptId, parent } = options;
  const initial = await sottoTransaction(
    prisma,
    async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      const snapshot = await captureSnapshot(database, promptId, admission.userId, parent);
      const user = await database.user.findUniqueOrThrow({
        where: { id: admission.userId },
        select: { preferredSttModel: true },
      });
      return { snapshot, model: user.preferredSttModel };
    },
    { signal: request.signal }
  );
  await getServerInfra();
  const stt = await resolveCapturedSttProvider({
    userId: admission.userId,
    execution: sottoRequestExecution(request, admission),
    requestedProvider:
      (initial.snapshot.sttProvider as SttProviderId | null) ?? getConfiguredSttProviderId(),
    requestedModel: initial.model ?? undefined,
    language: initial.snapshot.targetLang,
  });
  const recordingId = randomUUID();
  const operationId = randomUUID();
  let fingerprint: string | undefined;
  const reference = await writeStorageReference<SpeakingRecordingSnapshot>({
    database: prisma,
    signal: request.signal,
    prefix: `speaking/${admission.userId}/${promptId}`,
    extension: options.extension,
    body: options.audio,
    contentType: options.contentType,
    captureAdmission: async (database) => {
      await requireOriginalSottoAdmission(database, request, admission);
      const snapshot = await captureSnapshot(database, promptId, admission.userId, parent);
      if (!isDeepStrictEqual(snapshot, initial.snapshot))
        throw new AccessError(
          'conflict',
          'The speaking exercise changed before recording publication'
        );
      if (
        await database.speakingRecording.findUnique({
          where: { id: recordingId },
          select: { id: true },
        })
      )
        throw new AccessError('conflict', 'The speaking recording already exists');
      const scopes = [...snapshot.prompt.scopes];
      if (!scopes.some((scope) => scope.subjectId === snapshot.profile.subjectId))
        scopes.push(snapshot.profile);
      return {
        instanceId: snapshot.prompt.instanceId,
        scopes,
        consumer: `recording:${recordingId}:audio`,
        snapshot,
      };
    },
    validateAdmission: async (database, captured, committedReference) => {
      await requireOriginalSottoAdmission(database, request, admission);
      if (committedReference) {
        const existing = await database.speakingRecording.findUnique({
          where: { id: recordingId },
          select: { audioUrl: true, userId: true, promptId: true },
        });
        if (
          !existing ||
          existing.audioUrl !== committedReference ||
          existing.userId !== admission.userId ||
          existing.promptId !== promptId
        )
          throw new AccessError('conflict', 'The speaking recording reference changed');
        return;
      }
      const current = await captureSnapshot(database, promptId, admission.userId, parent);
      if (!isDeepStrictEqual(current, captured.snapshot))
        throw new AccessError('conflict', 'The speaking recording ownership changed');
    },
    previousReference: () => null,
    commit: async (database, audioUrl, captured) => {
      const recording = await database.speakingRecording.create({
        data: {
          id: recordingId,
          attempt: captured.attempt,
          sttProvider: captured.sttProvider,
          sttSelection: stt.selection,
          ...captured.parent,
          promptId,
          userId: admission.userId,
          audioUrl,
          status: 'PENDING',
        },
        select: { createdAt: true },
      });
      const storage = await resolveStorageInput(database, {
        consumer: `recording:${recordingId}:audio`,
        reference: audioUrl,
      });
      const ownership = await captureSpeakingRecordingStorage(database, recordingId);
      const record = await sottoJobOutbox(database).enqueue(
        prepareJob({
          id: operationId,
          namespace: SIDEDOOR_STATE_ID,
          handler: 'speaking-grading',
          version: 1,
          payload: {
            recordingId,
            recordingCreatedAt: recording.createdAt.getTime(),
            storage: storage.input,
            ownership,
          },
          scopes: [
            ...captured.prompt.scopes,
            ...(captured.prompt.scopes.some(
              (scope) => scope.subjectId === captured.profile.subjectId
            )
              ? []
              : [captured.profile]),
          ],
          delivery: { attempts: 3, priority: 0, availableAt: 0 },
        })
      );
      fingerprint = record.fingerprint;
    },
  });
  if (!fingerprint) throw new Error('Speaking grading work was not committed');
  return {
    id: recordingId,
    audioUrl: reference,
    status: 'PENDING' as const,
    operationId,
    fingerprint,
  };
}
