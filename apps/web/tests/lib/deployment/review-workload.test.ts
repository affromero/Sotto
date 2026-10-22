// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ReviewWorkloadError,
  REVIEW_WORKLOAD_TIMEOUT_MS,
  reviewWorkloadCheckpointSchema,
} from '../../../../../scripts/deploy/review/runtime/workload';
import { audio, fixture } from '../../helpers/review-workload/fixture';

function passiveFixture(passiveId: 'owner' | 'member' = 'member') {
  const f = fixture();
  const passive = f.input.profiles.find((profile) => profile.id === passiveId)!;
  const active = f.input.profiles.find((profile) => profile.id !== passiveId)!;
  passive.fixture = null;
  active.existingCourseIds = [];
  f.remote.get(active.id)!.originalCourses = [];
  f.remote.get(passive.id)!.originalCourses[0].targetLang = 'de';
  return { ...f, passiveId, activeId: active.id };
}

describe('fenced review workloads', () => {
  it('generates for both original profiles and assesses the exact newly generated synthetic audio', async () => {
    const f = fixture();
    const result = await f.run();
    expect(result).toMatchObject({
      profileCount: 2,
      generatedClasses: 2,
      syntheticAssessments: 2,
      humanPronunciationVerified: false,
      codexWorkload: 'verified',
      selectedSpeechWorkload: 'verified',
    });
    expect(f.checkpoint()?.profiles.every((row) => row.verified)).toBe(true);
    expect(f.mutations.map((row) => row.path)).toEqual([
      '/api/v1/courses',
      '/api/v1/courses/fixture-course-owner/next-class?background=1',
      '/api/v1/classes/class-owner/speaking/prompt-owner-0',
      '/api/v1/courses',
      '/api/v1/courses/fixture-course-member/next-class?background=1',
      '/api/v1/classes/class-member/speaking/prompt-member-0',
    ]);
    expect(JSON.stringify(f.checkpoint())).not.toContain(f.input.householdPassword);
    expect(JSON.stringify(f.checkpoint())).not.toContain('private-cookie');
    const previous = structuredClone(f.mutations);
    f.input.householdPassword = 'a freshly admitted household password';
    expect(await f.run()).toEqual(result);
    expect(f.mutations).toEqual(previous);
  });

  it.each(['loseCourseReply', 'losePreparationReply', 'loseUploadReply'] as const)(
    'retains an uncertain %s and never repeats its mutation',
    async (failure) => {
      const f = fixture();
      f.control[failure] = true;
      await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
      const original = structuredClone(f.mutations);
      expect(f.checkpoint()?.profiles[0].verified).toBe(false);
      f.control[failure] = false;
      await expect(f.run()).rejects.toMatchObject({ phase: 'retained_intent' });
      expect(f.mutations).toEqual(original);
    }
  );

  it('does not send fixture work without a durable checkpoint or after the parent aborts', async () => {
    const unavailable = fixture();
    unavailable.control.checkpointWritable = false;
    await expect(unavailable.run()).rejects.toMatchObject({ phase: 'authentication' });
    expect(unavailable.mutations).toEqual([]);
    const aborted = fixture();
    aborted.control.abortOnCourseIntent = true;
    const outcome = await aborted.run().then(
      () => null,
      (error: unknown) => error
    );
    expect(outcome).toBe(aborted.controller.signal.reason);
    expect(aborted.mutations).toEqual([]);
    expect(aborted.checkpoint()?.profiles[0].courseIntent).toBe(true);
  });

  it.each([
    'wrongActor',
    'changedPreferences',
    'changedModels',
    'ownerAuthorized',
    'occupiedPair',
  ] as const)('refuses %s before creating a fixture', async (failure) => {
    const f = fixture();
    f.control[failure] = failure === 'ownerAuthorized' ? false : true;
    await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
    expect(f.mutations).toEqual([]);
  });

  it.each([
    'wrongCurriculum',
    'wrongOperation',
    'wrongAiModel',
    'wrongTtsModel',
    'missingOwnedEpisode',
    'exemptSpeech',
    'missingAudio',
  ] as const)('refuses %s without submitting a speaking attempt', async (failure) => {
    const f = fixture();
    f.control[failure] = true;
    await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
    expect(f.mutations.every((row) => !row.path.includes('/speaking/'))).toBe(true);
  });

  it.each(['foreignAudio', 'redirectedAudio'] as const)(
    'rejects %s without forwarding credentials or uploading',
    async (failure) => {
      const f = fixture();
      f.control[failure] = true;
      await expect(f.run()).rejects.toMatchObject({ phase: 'reference_audio' });
      expect(f.requests.every((path) => !path.includes('outside.example'))).toBe(true);
      expect(f.mutations.every((row) => !row.path.includes('/speaking/'))).toBe(true);
    }
  );

  it.each(['oversized', 'invalid', 'too-long'])(
    'rejects %s reference audio before upload',
    async (kind) => {
      const f = fixture();
      f.control.audioBytes =
        kind === 'oversized'
          ? Buffer.alloc(1024 * 1024 + 1)
          : kind === 'invalid'
            ? Buffer.from('not an audio file')
            : audio(16);
      await expect(f.run()).rejects.toMatchObject({ phase: 'reference_audio' });
      expect(f.mutations.every((row) => !row.path.includes('/speaking/'))).toBe(true);
    }
  );

  it.each(['failedRecording', 'emptyTranscript', 'unknownRecording'] as const)(
    'refuses %s and retains the original attempt',
    async (failure) => {
      const f = fixture();
      f.control[failure] = true;
      await expect(f.run()).rejects.toMatchObject({ phase: 'synthetic_assessment' });
      expect(f.checkpoint()?.profiles[0].recordingId).toBe('recording-owner');
      expect(f.checkpoint()?.profiles[0].verified).toBe(false);
      const original = structuredClone(f.mutations);
      await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
      expect(f.mutations).toEqual(original);
    }
  );

  it('binds control fields while excluding credentials from the durable input hash', async () => {
    const f = fixture();
    f.control.loseCourseReply = true;
    await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
    const original = structuredClone(f.requests);
    f.input.profiles[0].fixture!.curriculumId = 'another-admitted-curriculum';
    await expect(f.run()).rejects.toMatchObject({ phase: 'input' });
    expect(f.requests).toEqual(original);
  });

  it.each([false, true])(
    'cancels only the recorded active generation and preserves uncertain cancellation=%s',
    async (lostReply) => {
      const f = fixture();
      f.control.failActivity = true;
      await expect(f.run()).rejects.toMatchObject({ phase: 'generation' });
      const saved = f.checkpoint()!;
      saved.profiles[0].preparationStartedAt = Date.now() - 1_200_001;
      f.replaceCheckpoint(saved);
      f.remote.get('owner')!.status = 'RUNNING';
      f.control.failActivity = false;
      f.control.loseCancelReply = lostReply;
      await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
      expect(f.checkpoint()?.profiles[0]).toMatchObject({
        cancelIntent: true,
        cancelled: !lostReply,
      });
      const cancellation = f.mutations.filter((row) => row.path.endsWith('/generation'));
      expect(cancellation.map((row) => row.path)).toEqual([
        '/api/v1/courses/fixture-course-owner/generation',
      ]);
      await expect(f.run()).rejects.toMatchObject({ phase: 'retained_intent' });
      expect(f.mutations.filter((row) => row.path.endsWith('/generation'))).toEqual(cancellation);
    }
  );

  it('never resets the retained fifty-five-minute deadline', async () => {
    const f = fixture();
    f.control.loseCourseReply = true;
    await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
    const saved = f.checkpoint()!;
    saved.startedAt = Date.now() - REVIEW_WORKLOAD_TIMEOUT_MS;
    f.replaceCheckpoint(saved);
    const original = structuredClone(f.requests);
    await expect(f.run()).rejects.toMatchObject({ phase: 'input' });
    expect(f.requests).toEqual(original);
  });

  it('starts no fixture work after the retained fifty-minute cutoff', async () => {
    const f = fixture();
    f.control.failAfterInitialCheckpoint = true;
    await expect(f.run()).rejects.toMatchObject({ phase: 'authentication' });
    const saved = f.checkpoint()!;
    saved.startedAt = Date.now() - 3_000_001;
    f.replaceCheckpoint(saved);
    f.control.failAfterInitialCheckpoint = false;
    await expect(f.run()).rejects.toMatchObject({ phase: 'course_admission' });
    expect(f.mutations).toEqual([]);
    expect(f.checkpoint()?.startedAt).toBe(saved.startedAt);
  });

  it.each([
    ['courseIntent', 'courseId', 0],
    ['preparationIntent', 'operationId', 1],
    ['uploadIntent', 'recordingId', 2],
  ] as const)('rechecks time after durable %s acknowledgment', async (intent, result, count) => {
    const f = fixture();
    const original = f.boundary.persistCheckpoint;
    f.boundary.persistCheckpoint = async (next) => {
      await original(next);
      if (next.profiles[0][intent] && !next.profiles[0][result])
        vi.spyOn(Date, 'now').mockReturnValue(next.startedAt + 3_000_000);
    };
    try {
      await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
      expect(f.mutations).toHaveLength(count);
      expect(f.checkpoint()?.profiles[0][intent]).toBe(true);
      expect(f.checkpoint()?.profiles[0][result]).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('sends no course mutation when the fence is lost after durable intent', async () => {
    const f = fixture();
    const original = f.boundary.persistCheckpoint;
    f.boundary.persistCheckpoint = async (next) => {
      await original(next);
      if (next.profiles[0].courseIntent) f.control.fenceHeld = false;
    };
    await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
    expect(f.mutations).toEqual([]);
    expect(f.checkpoint()?.profiles[0].courseIntent).toBe(true);
  });

  it('rechecks completed resources after their individual deadlines without resubmitting', async () => {
    const f = fixture();
    const result = await f.run();
    const saved = f.checkpoint()!;
    for (const row of saved.profiles) {
      row.preparationStartedAt = Date.now() - 1_200_001;
      row.uploadStartedAt = Date.now() - 300_001;
    }
    f.replaceCheckpoint(saved);
    const original = structuredClone(f.mutations);
    expect(await f.run()).toEqual(result);
    expect(f.mutations).toEqual(original);
  });

  it.each(['member', 'owner'] as const)(
    'preserves the passive %s course and performs the complete workload for the other profile',
    async (passiveId) => {
      const f = passiveFixture(passiveId);
      const originalCourse = structuredClone(f.remote.get(passiveId)!.originalCourses);
      const result = await f.run();
      expect(result).toMatchObject({
        profileCount: 2,
        generatedClasses: 1,
        syntheticAssessments: 1,
        humanPronunciationVerified: false,
        codexWorkload: 'verified',
        selectedSpeechWorkload: 'verified',
        speechSelections: f.input.profiles.map((profile) => profile.selection),
      });
      expect(result.referenceAudioSha256).toEqual([
        f.checkpoint()!.profiles.find((row) => row.profileId === f.activeId)!.reference!.sha256,
      ]);
      expect(f.mutations.map(({ path, profile }) => ({ path, profile }))).toEqual([
        { path: '/api/v1/courses', profile: f.activeId },
        {
          path: `/api/v1/courses/fixture-course-${f.activeId}/next-class?background=1`,
          profile: f.activeId,
        },
        {
          path: `/api/v1/classes/class-${f.activeId}/speaking/prompt-${f.activeId}-0`,
          profile: f.activeId,
        },
      ]);
      expect(f.remote.get(passiveId)).toMatchObject({
        originalCourses: originalCourse,
        course: null,
        operation: null,
        recording: null,
      });
      expect(f.checkpoint()!.profiles.find((row) => row.profileId === passiveId)).toMatchObject({
        courseIntent: false,
        courseId: null,
        preparationIntent: false,
        operationId: null,
        reference: null,
        uploadIntent: false,
        recordingId: null,
        verified: false,
      });
      const mutations = structuredClone(f.mutations);
      expect(await f.run()).toEqual(result);
      expect(f.mutations).toEqual(mutations);
    }
  );

  it('refuses two passive profiles before login or durable work', async () => {
    const f = passiveFixture();
    f.input.profiles.forEach((profile) => {
      profile.fixture = null;
    });
    await expect(f.run()).rejects.toMatchObject({ phase: 'input' });
    expect(f.requests).toEqual([]);
    expect(f.checkpoint()).toBeNull();
    expect(f.mutations).toEqual([]);
  });

  it.each(['preferences', 'course'] as const)(
    'refuses changed passive %s before starting the active owner workload',
    async (change) => {
      const f = passiveFixture();
      const passive = f.remote.get(f.passiveId)!;
      if (change === 'preferences') passive.preferences.preferredTtsModel = 'changed-model';
      else passive.originalCourses[0].id = 'replacement-owned-course';
      await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
      expect(f.mutations).toEqual([]);
      expect(f.remote.get(f.activeId)!.course).toBeNull();
    }
  );

  it.each(['preferences', 'course'] as const)(
    'refuses changed passive %s during the final readback after real workload completion',
    async (change) => {
      const f = passiveFixture();
      const fetch = f.boundary.fetch;
      f.boundary.fetch = async (resource, options) => {
        const response = await fetch(resource, options);
        if (
          new URL(String(resource)).pathname === '/api/v1/admin/auto-models' &&
          f.checkpoint()!.profiles.find((row) => row.profileId === f.activeId)!.verified
        ) {
          const passive = f.remote.get(f.passiveId)!;
          if (change === 'preferences') passive.preferences.preferredSttModel = 'changed-model';
          else passive.originalCourses[0].id = 'replacement-owned-course';
        }
        return response;
      };
      await expect(f.run()).rejects.toMatchObject({
        phase: 'final_verification',
      });
      expect(f.checkpoint()!.profiles.find((row) => row.profileId === f.activeId)!.verified).toBe(
        true
      );
      expect(f.mutations.every((mutation) => mutation.profile === f.activeId)).toBe(true);
    }
  );

  const course = { courseIntent: true, courseId: 'forged-course' };
  const preparation = {
    ...course,
    preparationIntent: true,
    preparationStartedAt: 1,
    operationId: randomUUID(),
  };
  const generated = { ...preparation, classId: 'forged-class' };
  const reference = {
    ...generated,
    reference: {
      promptId: 'forged-prompt',
      sha256: 'a'.repeat(64),
      durationSeconds: 1,
    },
  };
  const upload = { ...reference, uploadIntent: true, uploadStartedAt: 1 };
  const recording = { ...upload, recordingId: 'forged-recording' };
  it.each([
    ['courseIntent', { courseIntent: true }],
    ['courseId', course],
    ['preparationIntent', { ...course, preparationIntent: true, preparationStartedAt: 1 }],
    ['preparationStartedAt', { preparationStartedAt: 1 }],
    ['operationId', preparation],
    ['classId', generated],
    ['reference', reference],
    ['uploadIntent', upload],
    ['uploadStartedAt', { uploadStartedAt: 1 }],
    ['recordingId', recording],
    ['cancelIntent', { ...preparation, cancelIntent: true }],
    ['cancelled', { ...preparation, cancelIntent: true, cancelled: true }],
    ['verified', { ...recording, verified: true }],
  ] as const)(
    'refuses a schema-valid passive %s before any active work or HTTP request',
    async (field, patch) => {
      const f = passiveFixture();
      f.control.failAfterInitialCheckpoint = true;
      await expect(f.run()).rejects.toMatchObject({ phase: 'authentication' });
      const checkpoint = f.checkpoint()!;
      Object.assign(
        checkpoint.profiles.find((row) => row.profileId === f.passiveId)!,
        patch
      );
      f.replaceCheckpoint(reviewWorkloadCheckpointSchema.parse(checkpoint));
      f.control.failAfterInitialCheckpoint = false;
      await expect(f.run()).rejects.toMatchObject({ phase: 'input' });
      expect(f.requests).toEqual([]);
      expect(f.mutations).toEqual([]);
      expect(f.checkpoint()!.profiles.find((row) => row.profileId === f.passiveId)![field]).toEqual(
        checkpoint.profiles.find((row) => row.profileId === f.passiveId)![field]
      );
    }
  );

  it.each(['missingSkill', 'exemptSpeech', 'wrongAiModel', 'wrongTtsModel'] as const)(
    'still refuses %s for the single active owner before uploading speech',
    async (failure) => {
      const f = passiveFixture();
      f.control[failure] = true;
      await expect(f.run()).rejects.toBeInstanceOf(ReviewWorkloadError);
      expect(f.mutations.every((mutation) => !mutation.path.includes('/speaking/'))).toBe(true);
      expect(f.remote.get(f.passiveId)!.course).toBeNull();
    }
  );
});
