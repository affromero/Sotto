import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { AccessClient } from 'thesidedoor-core/access/browser';
import { skillRequirementsSchema } from '@sotto/shared';
import { z } from 'zod';
import { parseAgentModelId } from '@/lib/agent-models/id';
import { detectAudioFormat, isRecognizedAudio } from '@/lib/audio-format';
import { getAudioDuration } from '@/lib/audio-stitcher';
import { createReviewTransport } from './transport';

export const REVIEW_WORKLOAD_TIMEOUT_MS = 3_300_000;
const noNewWorkMs = 3_000_000;
const classTimeoutMs = 1_200_000;
const recordingTimeoutMs = 300_000;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const text = z.string().min(1).max(1024);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const preferenceSchema = z.strictObject({
  preferredAiModel: text.nullable(),
  preferredTtsProvider: text.nullable(),
  preferredTtsModel: text.nullable(),
  preferredSttModel: text.nullable(),
});
const aiSelectionSchema = z.strictObject({ aiProvider: z.literal('codex'), aiModel: text });
const selectionSchema = aiSelectionSchema.extend({
  ttsProvider: text,
  ttsModel: text,
  sttProvider: text,
  sttModel: text,
});
const automaticModelsSchema = z.strictObject({
  model: selectionSchema,
  platform: aiSelectionSchema,
  includedModels: z.array(text).max(1000).nullable(),
  includedTtsModels: z.array(text).max(1000).nullable(),
  includedSttModels: z.array(text).max(1000).nullable(),
});
const profileSchema = z.strictObject({
  id,
  preferences: preferenceSchema,
  selection: selectionSchema,
  existingCourseIds: z
    .array(id)
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length),
  fixture: z
    .strictObject({
      native: z.enum(['en', 'es', 'de']),
      target: z.enum(['en', 'es', 'de']),
      curriculumId: id,
    })
    .refine((pair) => ['en:es', 'es:en', 'en:de'].includes(`${pair.native}:${pair.target}`)),
});

export const reviewWorkloadInputSchema = z
  .strictObject({
    endpoint: z.url(),
    householdPassword: z.string().min(1).max(4096),
    expectedOwnerId: id,
    expectedAutomaticModels: automaticModelsSchema,
    profiles: z.array(profileSchema).length(2),
  })
  .refine(
    (input) =>
      new Set(input.profiles.map((profile) => profile.id)).size === 2 &&
      input.profiles.some((profile) => profile.id === input.expectedOwnerId) &&
      parseAgentModelId(input.expectedAutomaticModels.model.aiModel)?.provider === 'codex' &&
      parseAgentModelId(input.expectedAutomaticModels.platform.aiModel)?.provider === 'codex' &&
      input.profiles.every(
        (profile) => parseAgentModelId(profile.selection.aiModel)?.provider === 'codex'
      )
  );
export type ReviewWorkloadInput = z.infer<typeof reviewWorkloadInputSchema>;
const progressSchema = z
  .strictObject({
    profileId: id,
    courseIntent: z.boolean(),
    courseId: id.nullable(),
    preparationIntent: z.boolean(),
    preparationStartedAt: z.number().int().nonnegative().nullable(),
    operationId: z.uuid().nullable(),
    classId: id.nullable(),
    reference: z
      .strictObject({
        promptId: id,
        sha256: digest,
        durationSeconds: z.number().positive().max(15),
      })
      .nullable(),
    uploadIntent: z.boolean(),
    uploadStartedAt: z.number().int().nonnegative().nullable(),
    recordingId: id.nullable(),
    cancelIntent: z.boolean(),
    cancelled: z.boolean(),
    verified: z.boolean(),
  })
  .refine(
    (row) =>
      (!row.courseId || row.courseIntent) &&
      (!row.preparationIntent || (row.courseId !== null && row.preparationStartedAt !== null)) &&
      (!row.operationId || row.preparationIntent) &&
      (!row.classId || row.operationId !== null) &&
      (!row.reference || row.classId !== null) &&
      (!row.uploadIntent || (row.reference !== null && row.uploadStartedAt !== null)) &&
      (!row.recordingId || row.uploadIntent) &&
      (!row.verified || row.recordingId !== null) &&
      (!row.cancelIntent || (row.operationId !== null && !row.verified)) &&
      (!row.cancelled || row.cancelIntent)
  );
export const reviewWorkloadCheckpointSchema = z.strictObject({
  version: z.literal(1),
  inputHash: digest,
  startedAt: z.number().int().nonnegative(),
  profiles: z.array(progressSchema).length(2),
});
export type ReviewWorkloadCheckpoint = z.infer<typeof reviewWorkloadCheckpointSchema>;
type Profile = ReviewWorkloadInput['profiles'][number];
type Progress = ReviewWorkloadCheckpoint['profiles'][number];
export interface ReviewWorkloadBoundary {
  assertFence: () => Promise<void>;
  persistCheckpoint: (checkpoint: ReviewWorkloadCheckpoint) => Promise<void>;
  fetch?: typeof globalThis.fetch;
  signal: AbortSignal;
}
export class ReviewWorkloadError extends Error {
  constructor(readonly phase: string) {
    super(`Review workload failed at ${phase}; retain the fence and private checkpoint.`);
    this.name = 'ReviewWorkloadError';
  }
}

const courseSchema = z.object({
  id,
  userId: id,
  nativeLang: text,
  targetLang: text,
  currentLevel: text,
  curriculumId: id,
});
const courseListSchema = z.object({
  courses: z.array(z.object({ id, nativeLang: text, targetLang: text })).max(1000),
});
const activitySchema = z.object({
  operationId: z.uuid(),
  status: z.enum([
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'CANCELLING',
    'CANCELLED',
    'FAILED',
    'UNRESOLVED',
  ]),
  aiProvider: text,
  aiModel: text,
  audioRequiresReview: z.boolean(),
  maxProviderRequests: z.number().nullable(),
  providerRequestsCompleted: z.number().int().nonnegative(),
  providerRequestInFlight: z.boolean(),
});
const promptSchema = z.object({ id, targetPhrase: text, referenceTtsUrl: text.nullable() });
const classSchema = z.object({
  id,
  courseId: id,
  attempt: z.literal(1),
  status: z.enum(['AVAILABLE', 'IN_PROGRESS']),
  skillRequirements: skillRequirementsSchema,
  lesson: z.object({ title: text, level: z.literal('A1') }),
  sections: z
    .array(
      z.object({
        id,
        skill: z.enum(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']),
        status: z.enum(['READY', 'PASSED']),
        questions: z
          .array(z.object({ id, question: z.string().trim().min(1).max(32000) }))
          .max(100),
        prompts: z.array(promptSchema).max(100),
        writingPrompts: z
          .array(z.object({ id, task: z.string().trim().min(1).max(32000) }))
          .max(100),
        episode: z.object({ id, status: text, audioUrl: text.nullable() }).nullable(),
      })
    )
    .length(5),
});
const recordingSchema = z.object({
  status: z.enum(['PENDING', 'GRADING', 'SCORED', 'FAILED']),
  transcript: z.string().max(32000).nullable(),
  overallScore: z.number().min(0).max(100).nullable(),
  feedback: z.string().max(32000).nullable(),
});

/** Use the real candidate API and worker; never settle work or reconstruct authority here. */
export async function runReviewWorkloads(
  value: unknown,
  retained: unknown,
  boundary: ReviewWorkloadBoundary
) {
  let phase = 'input';
  const fail: () => never = () => {
    throw new ReviewWorkloadError(phase);
  };
  try {
    boundary.signal.throwIfAborted();
    const input = reviewWorkloadInputSchema.parse(value);
    const inputHash = createHash('sha256')
      .update(
        JSON.stringify({
          endpoint: input.endpoint,
          expectedOwnerId: input.expectedOwnerId,
          expectedAutomaticModels: input.expectedAutomaticModels,
          profiles: input.profiles,
        })
      )
      .digest('hex');
    const checkpoint = reviewWorkloadCheckpointSchema.parse(
      retained ?? {
        version: 1,
        inputHash,
        startedAt: Date.now(),
        profiles: input.profiles.map((profile) => ({
          profileId: profile.id,
          courseIntent: false,
          courseId: null,
          preparationIntent: false,
          preparationStartedAt: null,
          operationId: null,
          classId: null,
          reference: null,
          uploadIntent: false,
          uploadStartedAt: null,
          recordingId: null,
          cancelIntent: false,
          cancelled: false,
          verified: false,
        })),
      }
    );
    if (
      checkpoint.inputHash !== inputHash ||
      checkpoint.startedAt > Date.now() + 5000 ||
      !isDeepStrictEqual(
        checkpoint.profiles.map((row) => row.profileId),
        input.profiles.map((profile) => profile.id)
      )
    )
      fail();
    for (const name of ['courseId', 'classId', 'recordingId'] as const) {
      const ids = checkpoint.profiles.map((row) => row[name]).filter((item) => item !== null);
      if (new Set(ids).size !== ids.length) fail();
    }
    const remaining = checkpoint.startedAt + REVIEW_WORKLOAD_TIMEOUT_MS - Date.now();
    if (remaining <= 0) fail();
    const signal = AbortSignal.any([boundary.signal, AbortSignal.timeout(remaining)]);
    const permittedAudio = new Set<string>();
    const paths = new Map<string, Set<string>>([
      ['/api/v1/access/household', new Set(['POST'])],
      ['/api/v1/access/select-profile', new Set(['POST'])],
      ['/api/v1/access/authorize-owner', new Set(['POST'])],
      ['/api/v1/profiles', new Set(['GET'])],
      ['/api/v1/users/me', new Set(['GET'])],
      ['/api/v1/admin/auto-models', new Set(['GET'])],
      ['/api/v1/courses', new Set(['GET', 'POST'])],
      ['/api/v1/episodes', new Set(['GET'])],
    ]);
    const api = createReviewTransport({
      endpoint: input.endpoint,
      signal,
      fetch: boundary.fetch,
      fail,
      admitResource: (path, method) =>
        paths.get(path)?.has(method) === true || (method === 'GET' && permittedAudio.has(path)),
    });
    const persist = async () => {
      signal.throwIfAborted();
      await boundary.assertFence();
      await boundary.persistCheckpoint(structuredClone(checkpoint));
      signal.throwIfAborted();
      await boundary.assertFence();
    };
    const request = async (path: string, body?: unknown, method?: string) => {
      signal.throwIfAborted();
      await boundary.assertFence();
      return api.request(path, body, method);
    };
    const requireNewWorkTime = () => {
      signal.throwIfAborted();
      if (Date.now() >= checkpoint.startedAt + noNewWorkMs) fail();
    };
    const mutate = async (path: string, body: unknown, expectedStatus: number) => {
      await boundary.assertFence();
      requireNewWorkTime();
      const response = await api.fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status !== expectedStatus) fail();
      return response.json() as Promise<unknown>;
    };
    const admit = (path: string, methods = ['GET']) => paths.set(path, new Set(methods));
    const select = async (profile: Profile) => {
      api.selectProfile(null);
      await request('/api/v1/access/select-profile', { id: profile.id });
      api.selectProfile(profile.id);
      const current = z
        .object({ id })
        .passthrough()
        .parse(await request('/api/v1/users/me'));
      if (
        current.id !== profile.id ||
        !isDeepStrictEqual(preferenceSchema.strip().parse(current), profile.preferences)
      )
        fail();
    };
    const configuration = async () => {
      const owner = input.profiles.find((profile) => profile.id === input.expectedOwnerId)!;
      await select(owner);
      const authorized = z
        .object({ ok: z.literal(true) })
        .parse(await request('/api/v1/access/authorize-owner', {}));
      if (
        !authorized.ok ||
        !isDeepStrictEqual(
          automaticModelsSchema.parse(await request('/api/v1/admin/auto-models')),
          input.expectedAutomaticModels
        )
      )
        fail();
    };
    const checkCourses = async (profile: Profile, row: Progress) => {
      const list = courseListSchema.parse(await request('/api/v1/courses')).courses;
      const expected = [
        ...profile.existingCourseIds,
        ...(row.courseId ? [row.courseId] : []),
      ].sort();
      if (!isDeepStrictEqual(list.map((course) => course.id).sort(), expected)) fail();
      const matching = list.filter(
        (course) =>
          course.nativeLang === profile.fixture.native &&
          course.targetLang === profile.fixture.target
      );
      if (
        row.courseId
          ? matching.length !== 1 || matching[0].id !== row.courseId
          : matching.length !== 0
      )
        fail();
    };
    const newMutation = async (profile: Profile, row: Progress) => {
      requireNewWorkTime();
      await configuration();
      await select(profile);
      await checkCourses(profile, row);
      requireNewWorkTime();
    };
    phase = 'authentication';
    await persist();
    await boundary.assertFence();
    await new AccessClient({ endpoint: '/api/v1/access', fetch: api.fetch }).enterHousehold(
      input.householdPassword,
      signal
    );
    const profiles = z
      .object({ profiles: z.array(z.object({ id })).max(10) })
      .parse(await request('/api/v1/profiles')).profiles;
    if (
      !isDeepStrictEqual(
        profiles.map((profile) => profile.id).sort(),
        input.profiles.map((profile) => profile.id).sort()
      )
    )
      fail();
    await configuration();

    for (let index = 0; index < input.profiles.length; index++) {
      const profile = input.profiles[index];
      const row = checkpoint.profiles[index];
      phase = 'retained_intent';
      if (
        (row.courseIntent && !row.courseId) ||
        (row.preparationIntent && !row.operationId) ||
        (row.uploadIntent && !row.recordingId) ||
        row.cancelIntent
      )
        fail();
      await select(profile);
      await checkCourses(profile, row);
      if (!row.courseId) {
        phase = 'course_admission';
        await newMutation(profile, row);
        row.courseIntent = true;
        await persist();
        const course = courseSchema.parse(
          z
            .object({ course: courseSchema })
            .parse(
              await mutate(
                '/api/v1/courses',
                { native: profile.fixture.native, target: profile.fixture.target },
                201
              )
            ).course
        );
        if (
          course.userId !== profile.id ||
          course.nativeLang !== profile.fixture.native ||
          course.targetLang !== profile.fixture.target ||
          course.curriculumId !== profile.fixture.curriculumId ||
          course.currentLevel !== 'A1' ||
          input.profiles.some((item) => item.existingCourseIds.includes(course.id)) ||
          checkpoint.profiles.some((item) => item.courseId === course.id)
        )
          fail();
        row.courseId = course.id;
        await persist();
      }
      const courseId = row.courseId;
      const activityPath = `/api/v1/courses/${courseId}/preparation`;
      const generationPath = `/api/v1/courses/${courseId}/generation`;
      const admissionPath = `/api/v1/courses/${courseId}/next-class?background=1`;
      admit(activityPath);
      admit(generationPath, ['GET', 'DELETE']);
      admit(admissionPath, ['POST']);
      if (!row.operationId) {
        phase = 'preparation_admission';
        await newMutation(profile, row);
        row.preparationIntent = true;
        row.preparationStartedAt = Date.now();
        await persist();
        const result = z
          .object({ started: z.literal(true), operationId: z.uuid(), status: text })
          .parse(await mutate(admissionPath, {}, 202));
        row.operationId = result.operationId;
        await persist();
      }
      const activity = async () => {
        const result = activitySchema.parse(await request(activityPath));
        if (
          result.operationId !== row.operationId ||
          result.aiProvider !== 'codex' ||
          result.aiModel !== profile.selection.aiModel ||
          result.audioRequiresReview ||
          result.maxProviderRequests !== null
        )
          fail();
        return result;
      };
      const cancelActive = async () => {
        phase = 'generation_cancellation';
        await select(profile);
        const current = await activity();
        if (!['QUEUED', 'RUNNING'].includes(current.status)) return;
        row.cancelIntent = true;
        await persist();
        const cancelled = z
          .object({ operationId: z.uuid(), cancelled: z.boolean(), cancelling: z.boolean() })
          .parse(await request(generationPath, undefined, 'DELETE'));
        if (
          cancelled.operationId !== row.operationId ||
          (!cancelled.cancelled && !cancelled.cancelling)
        )
          fail();
        const end = Math.min(
          Date.now() + recordingTimeoutMs,
          checkpoint.startedAt + REVIEW_WORKLOAD_TIMEOUT_MS
        );
        while (Date.now() < end) {
          const state = await activity();
          if (state.status === 'CANCELLED' && !state.providerRequestInFlight) {
            row.cancelled = true;
            await persist();
            return;
          }
          if (state.status === 'UNRESOLVED' || state.status === 'FAILED') fail();
          await delay(5000, undefined, { signal });
        }
        fail();
      };
      phase = 'generation';
      let generated: z.infer<typeof classSchema> | null = null;
      while (!generated) {
        const current = await activity();
        if (
          !row.reference &&
          (Date.now() >= row.preparationStartedAt! + classTimeoutMs ||
            Date.now() >= checkpoint.startedAt + noNewWorkMs)
        ) {
          await cancelActive();
          phase = 'generation_deadline';
          fail();
        }
        if (!['QUEUED', 'RUNNING', 'COMPLETED'].includes(current.status)) fail();
        if (current.status !== 'COMPLETED') {
          await delay(5000, undefined, { signal });
          continue;
        }
        if (current.providerRequestsCompleted < 1) fail();
        if (current.providerRequestInFlight) {
          await delay(5000, undefined, { signal });
          continue;
        }
        const generation = z
          .object({ operationId: z.uuid(), classId: id })
          .parse(await request(generationPath));
        if (
          generation.operationId !== row.operationId ||
          (row.classId && row.classId !== generation.classId)
        )
          fail();
        if (!row.classId) {
          row.classId = generation.classId;
          await persist();
        }
        const classPath = `/api/v1/classes/${row.classId}`;
        admit(classPath);
        const candidate = classSchema.parse(await request(classPath));
        const requirements = candidate.skillRequirements;
        if (
          candidate.id !== row.classId ||
          candidate.courseId !== courseId ||
          requirements.scope !== 'CLASS' ||
          requirements.level !== 'A1' ||
          requirements.nativeLang !== profile.fixture.native ||
          requirements.targetLang !== profile.fixture.target ||
          requirements.ttsProvider !== profile.selection.ttsProvider ||
          requirements.sttProvider !== profile.selection.sttProvider ||
          !requirements.referenceAudioRequired ||
          new Set(candidate.sections.map((section) => section.skill)).size !== 5
        )
          fail();
        for (const section of candidate.sections) {
          const requirement = requirements.skills[section.skill];
          const items =
            section.skill === 'SPEAKING'
              ? section.prompts
              : section.skill === 'WRITING'
                ? section.writingPrompts
                : section.questions;
          if (requirement.state !== 'REQUIRED' || items.length !== requirement.expectedCount)
            fail();
        }
        const listening = candidate.sections.find((section) => section.skill === 'LISTENING')!;
        const speaking = candidate.sections.find((section) => section.skill === 'SPEAKING')!;
        if (!listening.episode || speaking.prompts.some((prompt) => !prompt.referenceTtsUrl))
          fail();
        if (listening.episode.status !== 'READY' || !listening.episode.audioUrl) {
          await delay(5000, undefined, { signal });
          continue;
        }
        const episodePath = `/api/v1/episodes/${listening.episode.id}`;
        admit(episodePath);
        const episode = z
          .object({
            id,
            userId: id,
            source: z.literal('CLASS'),
            visibility: z.literal('PRIVATE'),
            status: z.literal('READY'),
            language: text,
            audioUrl: text,
          })
          .parse(await request(episodePath));
        if (
          episode.id !== listening.episode.id ||
          episode.userId !== profile.id ||
          episode.language !== profile.fixture.target ||
          !episode.audioUrl.startsWith('/api/v1/storage/')
        )
          fail();
        const ownedEpisodes = z
          .array(
            z.object({ id, userId: id, ttsProvider: text.nullable(), ttsModel: text.nullable() })
          )
          .max(1000)
          .parse(await request('/api/v1/episodes'));
        const owned = ownedEpisodes.filter((item) => item.id === episode.id);
        if (
          owned.length !== 1 ||
          owned[0].userId !== profile.id ||
          owned[0].ttsProvider !== profile.selection.ttsProvider ||
          owned[0].ttsModel !== profile.selection.ttsModel
        )
          fail();
        generated = candidate;
      }
      phase = 'reference_audio';
      const prompt = generated.sections.find((section) => section.skill === 'SPEAKING')!.prompts[0];
      const reference = prompt.referenceTtsUrl!;
      if (!reference.startsWith('/api/v1/storage/') || reference.includes('?')) fail();
      permittedAudio.add(reference);
      await boundary.assertFence();
      const response = await api.fetch(reference);
      if (!response.ok) fail();
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 1024 * 1024 || !isRecognizedAudio(bytes)) fail();
      const format = detectAudioFormat(bytes);
      const directory = await mkdtemp(join(tmpdir(), 'sotto-review-reference-'));
      let duration: number;
      try {
        const path = join(directory, `reference.${format.ext}`);
        await writeFile(path, bytes, { mode: 0o600, flag: 'wx', signal });
        duration = await getAudioDuration(
          path,
          AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        );
      } finally {
        await rm(directory, { recursive: true });
      }
      if (!Number.isFinite(duration) || duration <= 0 || duration > 15) fail();
      const observed = {
        promptId: prompt.id,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        durationSeconds: duration,
      };
      if (row.reference && !isDeepStrictEqual(row.reference, observed)) fail();
      row.reference = observed;
      await persist();
      const recordingPath = `/api/v1/classes/${row.classId}/speaking/${prompt.id}`;
      admit(recordingPath, ['POST']);
      if (!row.recordingId) {
        phase = 'synthetic_recording_admission';
        await newMutation(profile, row);
        row.uploadIntent = true;
        row.uploadStartedAt = Date.now();
        await persist();
        const form = new FormData();
        form.set(
          'audio',
          new Blob([Uint8Array.from(bytes)], { type: format.mime }),
          `synthetic-reference.${format.ext}`
        );
        await boundary.assertFence();
        requireNewWorkTime();
        const uploaded = await api.fetch(recordingPath, { method: 'POST', body: form });
        if (uploaded.status !== 201) fail();
        const recording = z
          .object({ recordingId: id, status: z.literal('PENDING') })
          .parse(await uploaded.json());
        row.recordingId = recording.recordingId;
        await persist();
      }
      const pollPath = `${recordingPath}?recordingId=${row.recordingId}`;
      admit(pollPath);
      phase = 'synthetic_assessment';
      for (;;) {
        if (!row.verified && Date.now() >= row.uploadStartedAt! + recordingTimeoutMs) fail();
        const result = recordingSchema.parse(await request(pollPath));
        if (result.status === 'FAILED') fail();
        if (result.status === 'SCORED') {
          if (
            !result.transcript?.trim() ||
            !result.feedback?.trim() ||
            result.overallScore === null
          )
            fail();
          break;
        }
        await delay(5000, undefined, { signal });
      }
      row.verified = true;
      await persist();
      await select(profile);
      await checkCourses(profile, row);
    }
    phase = 'final_verification';
    await configuration();
    for (const profile of input.profiles) await select(profile);
    await boundary.assertFence();
    signal.throwIfAborted();
    return {
      profileCount: checkpoint.profiles.length,
      generatedClasses: checkpoint.profiles.filter((row) => row.verified).length,
      syntheticAssessments: checkpoint.profiles.filter((row) => row.verified).length,
      humanPronunciationVerified: false as const,
      codexWorkload: 'verified' as const,
      selectedSpeechWorkload: 'verified' as const,
      speechSelections: input.profiles.map((profile) => profile.selection),
      referenceAudioSha256: checkpoint.profiles.map((row) => row.reference!.sha256),
    };
  } catch {
    boundary.signal.throwIfAborted();
    fail();
  }
}
