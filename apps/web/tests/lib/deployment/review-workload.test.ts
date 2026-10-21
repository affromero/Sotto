// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import {
  runReviewWorkloads,
  ReviewWorkloadError,
  REVIEW_WORKLOAD_TIMEOUT_MS,
  reviewWorkloadCheckpointSchema,
  type ReviewWorkloadInput,
  type ReviewWorkloadCheckpoint,
} from '../../../../../scripts/deploy/review/runtime/workload';

function audio(seconds = 1) {
  const bytes = Buffer.alloc(44 + 32000 * seconds);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let sample = 0; sample < 16000 * seconds; sample++)
    bytes.writeInt16LE(Math.round(Math.sin((sample * Math.PI) / 18) * 3000), 44 + sample * 2);
  return bytes;
}

function fixture() {
  const preferences: ReviewWorkloadInput['profiles'][number]['preferences'] = {
    preferredAiModel: null,
    preferredTtsProvider: null,
    preferredTtsModel: null,
    preferredSttModel: null,
  };
  const selection = {
    aiProvider: 'codex' as const,
    aiModel: 'codex',
    ttsProvider: 'openai',
    ttsModel: 'fixture-tts',
    sttProvider: 'openai',
    sttModel: 'fixture-stt',
  };
  const input: ReviewWorkloadInput = {
    endpoint: 'http://127.0.0.1:43123/',
    householdPassword: 'private-fixture-password',
    expectedOwnerId: 'owner',
    expectedAutomaticModels: {
      model: selection,
      platform: { aiProvider: 'codex', aiModel: 'codex' },
      includedModels: null,
      includedTtsModels: null,
      includedSttModels: null,
    },
    profiles: ['owner', 'member'].map((id) => ({
      id,
      preferences: { ...preferences },
      selection: { ...selection },
      existingCourseIds: [`original-${id}`],
      fixture: {
        native: id === 'owner' ? 'en' : 'es',
        target: id === 'owner' ? 'de' : 'en',
        curriculumId: `curriculum-${id}`,
      },
    })),
  };
  type Remote = {
    preferences: typeof preferences;
    originalCourses: { id: string; nativeLang: string; targetLang: string }[];
    course: string | null;
    operation: string | null;
    recording: string | null;
    status: 'COMPLETED' | 'RUNNING' | 'CANCELLED';
  };
  const remote = new Map(
    input.profiles.map((profile) => [
      profile.id,
      {
        preferences: { ...preferences },
        originalCourses: [{ id: `original-${profile.id}`, nativeLang: 'en', targetLang: 'es' }],
        course: null,
        operation: null,
        recording: null,
        status: 'COMPLETED',
      } as Remote,
    ])
  );
  const mutations: { path: string; profile: string; body: unknown }[] = [];
  const requests: string[] = [];
  let selected = '';
  let durable: ReviewWorkloadCheckpoint | null = null;
  const control = {
    fenceHeld: true,
    checkpointWritable: true,
    failAfterInitialCheckpoint: false,
    ownerAuthorized: true,
    abortOnCourseIntent: false,
    loseCourseReply: false,
    losePreparationReply: false,
    loseUploadReply: false,
    loseCancelReply: false,
    failActivity: false,
    wrongActor: false,
    changedPreferences: false,
    changedModels: false,
    occupiedPair: false,
    wrongCurriculum: false,
    wrongOperation: false,
    wrongAiModel: false,
    wrongTtsModel: false,
    missingOwnedEpisode: false,
    exemptSpeech: false,
    missingSkill: false,
    missingAudio: false,
    foreignAudio: false,
    redirectedAudio: false,
    failedRecording: false,
    emptyTranscript: false,
    unknownRecording: false,
    audioBytes: audio(),
  };
  const controller = new AbortController();
  const reply = (value: unknown, status = 200, headers?: HeadersInit) =>
    Response.json(value, { status, headers });
  const fetcher: typeof fetch = async (resource, options = {}) => {
    const url = new URL(String(resource));
    expect(url.origin).toBe('http://127.0.0.1:43123');
    expect(options.redirect).toBe('error');
    expect(options.cache).toBe('no-store');
    const headers = new Headers(options.headers);
    expect(headers.get('Origin')).toBe('https://demo.sotto.fm');
    expect(headers.has('Host')).toBe(false);
    const path = url.pathname + url.search;
    const method = options.method ?? 'GET';
    requests.push(`${method} ${path}`);
    const body: unknown =
      typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    if (path === '/api/v1/access/household') {
      expect(body).toEqual({ password: input.householdPassword });
      selected = '';
      return reply(
        { principal: null, expiresAt: Date.now() + 60000, sessionId: 'fixture-session' },
        200,
        { 'Set-Cookie': 'sotto_session=private-cookie; Secure; HttpOnly; Path=/' }
      );
    }
    expect(headers.get('Cookie')).toBe('sotto_session=private-cookie');
    if (path === '/api/v1/profiles')
      return reply({ profiles: input.profiles.map((profile) => ({ id: profile.id })) });
    if (path === '/api/v1/access/select-profile') {
      selected = (body as { id: string }).id;
      return reply({ ok: true });
    }
    if (!path.startsWith('/api/v1/access/'))
      expect(headers.get('X-Sotto-Expected-Profile-Id')).toBe(selected);
    if (path === '/api/v1/episodes')
      return reply(
        control.missingOwnedEpisode
          ? []
          : [
              {
                id: `episode-${selected}`,
                userId: selected,
                ttsProvider: 'openai',
                ttsModel: control.wrongTtsModel ? 'another-model' : 'fixture-tts',
              },
            ]
      );
    if (path === '/api/v1/users/me')
      return reply({
        id: control.wrongActor ? 'another' : selected,
        ...remote.get(selected)!.preferences,
        ...(control.changedPreferences ? { preferredAiModel: 'changed' } : {}),
      });
    if (path === '/api/v1/access/authorize-owner')
      return reply(
        { ok: selected === 'owner' && control.ownerAuthorized },
        control.ownerAuthorized ? 200 : 403
      );
    if (path === '/api/v1/admin/auto-models')
      return reply(
        control.changedModels
          ? {
              ...input.expectedAutomaticModels,
              platform: { aiProvider: 'codex', aiModel: 'codex:changed' },
            }
          : input.expectedAutomaticModels
      );
    const profile = input.profiles.find((item) => item.id === selected)!;
    const state = remote.get(selected)!;
    const progress = durable?.profiles.find((item) => item.profileId === selected);
    if (path === '/api/v1/courses' && method === 'GET') {
      const courses = [...state.originalCourses];
      if (state.course || control.occupiedPair) {
        if (!profile.fixture) throw new Error('Passive profile received fixture work');
        if (state.course)
          courses.push({
            id: state.course,
            nativeLang: profile.fixture.native,
            targetLang: profile.fixture.target,
          });
        if (control.occupiedPair)
          courses.push({
            id: 'unexpected-existing-course',
            nativeLang: profile.fixture.native,
            targetLang: profile.fixture.target,
          });
      }
      return reply({ courses });
    }
    if (!profile.fixture) throw new Error('Passive profile received fixture work');
    if (path === '/api/v1/courses' && method === 'POST') {
      expect(progress?.courseIntent).toBe(true);
      expect(state.course).toBeNull();
      mutations.push({ path, profile: selected, body });
      state.course = `fixture-course-${selected}`;
      if (control.loseCourseReply) throw new Error('system boundary lost response');
      return reply(
        {
          course: {
            id: state.course,
            userId: selected,
            nativeLang: profile.fixture.native,
            targetLang: profile.fixture.target,
            currentLevel: 'A1',
            curriculumId: control.wrongCurriculum
              ? 'unexpected-curriculum'
              : profile.fixture.curriculumId,
          },
        },
        201
      );
    }
    const course = `/api/v1/courses/${state.course}`;
    const cls = `class-${selected}`;
    const prompt = `prompt-${selected}-0`;
    const reference = `/api/v1/storage/speaking-ref/${prompt}/fixture.wav`;
    if (path === `${course}/next-class?background=1`) {
      expect(progress?.preparationIntent).toBe(true);
      expect(progress?.courseId).toBe(state.course);
      expect(body).toEqual({});
      expect(state.operation).toBeNull();
      mutations.push({ path, profile: selected, body });
      state.operation = randomUUID();
      if (control.losePreparationReply) throw new Error('system boundary lost response');
      return reply({ started: true, status: 'QUEUED', operationId: state.operation }, 202);
    }
    if (path === `${course}/preparation`) {
      if (control.failActivity) throw new Error('system boundary unavailable');
      return reply({
        operationId: control.wrongOperation ? randomUUID() : state.operation,
        status: state.status,
        aiProvider: 'codex',
        aiModel: control.wrongAiModel ? 'codex:other' : 'codex',
        maxProviderRequests: null,
        audioRequiresReview: false,
        providerRequestsCompleted: 2,
        providerRequestInFlight: false,
      });
    }
    if (path === `${course}/generation` && method === 'DELETE') {
      expect(progress?.cancelIntent).toBe(true);
      expect(progress?.operationId).toBe(state.operation);
      mutations.push({ path, profile: selected, body });
      state.status = 'CANCELLED';
      if (control.loseCancelReply) throw new Error('system boundary lost response');
      return reply({ operationId: state.operation, cancelled: true, cancelling: false });
    }
    if (path === `${course}/generation`)
      return reply({ operationId: state.operation, classId: cls });
    if (path === `/api/v1/classes/${cls}`) {
      const requirements = createSkillRequirements({
        scope: 'CLASS',
        nativeLang: profile.fixture.native,
        targetLang: profile.fixture.target,
        level: 'A1',
        ttsProvider: control.exemptSpeech ? null : 'openai',
        sttProvider: control.exemptSpeech ? null : 'openai',
      });
      return reply({
        id: cls,
        courseId: state.course,
        attempt: 1,
        status: 'AVAILABLE',
        lesson: { title: 'A newly generated lesson', level: 'A1' },
        skillRequirements: requirements,
        sections: ['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']
          .filter((skill) => !control.missingSkill || skill !== 'WRITING')
          .map((skill) => ({
            id: `section-${selected}-${skill}`,
            skill,
            status: 'READY',
            questions: ['GRAMMAR', 'READING', 'LISTENING'].includes(skill)
              ? Array.from({ length: skill === 'LISTENING' ? 4 : 5 }, (_, i) => ({
                  id: `q-${i}`,
                  question: 'Generated question',
                }))
              : [],
            prompts:
              skill === 'SPEAKING'
                ? Array.from({ length: 4 }, (_, i) => ({
                    id: `prompt-${selected}-${i}`,
                    targetPhrase: 'A generated utterance',
                    referenceTtsUrl: control.missingAudio
                      ? null
                      : control.foreignAudio
                        ? 'https://outside.example/clip.wav'
                        : `/api/v1/storage/speaking-ref/prompt-${selected}-${i}/fixture.wav`,
                  }))
                : [],
            writingPrompts:
              skill === 'WRITING'
                ? Array.from({ length: 3 }, (_, i) => ({
                    id: `writing-${i}`,
                    task: 'Write a greeting.',
                  }))
                : [],
            episode:
              skill === 'LISTENING'
                ? {
                    id: `episode-${selected}`,
                    status: 'READY',
                    audioUrl: '/api/v1/storage/listening/fixture.mp3',
                  }
                : null,
          })),
      });
    }
    if (path === `/api/v1/episodes/episode-${selected}`)
      return reply({
        id: `episode-${selected}`,
        userId: selected,
        source: 'CLASS',
        visibility: 'PRIVATE',
        status: 'READY',
        language: profile.fixture.target,
        audioUrl: '/api/v1/storage/listening/fixture.mp3',
      });
    if (path === reference) {
      const response = new Response(Uint8Array.from(control.audioBytes));
      if (control.redirectedAudio) Object.defineProperty(response, 'redirected', { value: true });
      return response;
    }
    const recording = `/api/v1/classes/${cls}/speaking/${prompt}`;
    if (path === recording) {
      expect(progress?.uploadIntent).toBe(true);
      expect(progress?.reference?.promptId).toBe(prompt);
      expect(body).toBeInstanceOf(FormData);
      const file = (body as FormData).get('audio') as File;
      expect(Buffer.from(await file.arrayBuffer())).toEqual(control.audioBytes);
      expect(file.name).toContain('synthetic-reference');
      mutations.push({ path, profile: selected, body: 'synthetic audio' });
      state.recording = `recording-${selected}`;
      if (control.loseUploadReply) throw new Error('system boundary lost response');
      return reply({ recordingId: state.recording, status: 'PENDING' }, 201);
    }
    if (path === `${recording}?recordingId=${state.recording}`)
      return control.unknownRecording
        ? reply({}, 404)
        : reply({
            status: control.failedRecording ? 'FAILED' : 'SCORED',
            transcript: control.emptyTranscript ? '' : 'A generated utterance',
            overallScore: 0.83,
            feedback: 'The synthetic utterance was assessed.',
          });
    throw new Error('Unexpected fixture boundary request');
  };
  const boundary = {
    signal: controller.signal,
    fetch: fetcher,
    assertFence: async () => {
      if (!control.fenceHeld) throw new Error('fence lost');
    },
    persistCheckpoint: async (next: ReviewWorkloadCheckpoint) => {
      if (!control.checkpointWritable) throw new Error('checkpoint write unavailable');
      durable = structuredClone(next);
      if (control.failAfterInitialCheckpoint) throw new Error('initial checkpoint captured');
      if (control.abortOnCourseIntent && next.profiles[0].courseIntent)
        controller.abort(new Error('parent abort'));
    },
  };
  const run = () => runReviewWorkloads(input, durable, boundary);
  return {
    input,
    control,
    controller,
    boundary,
    run,
    mutations,
    requests,
    remote,
    checkpoint: () => structuredClone(durable),
    replaceCheckpoint: (value: ReviewWorkloadCheckpoint) => {
      durable = structuredClone(value);
    },
  };
}

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
