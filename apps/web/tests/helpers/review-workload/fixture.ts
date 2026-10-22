import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSkillRequirements } from '@sotto/shared';
import {
  runReviewWorkloads,
  type ReviewWorkloadInput,
  type ReviewWorkloadCheckpoint,
} from '../../../../../scripts/deploy/review/runtime/workload';

export function audio(seconds = 1) {
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

export function fixture(options: { pendingGenerationPolls?: number } = {}) {
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
  const pendingPolls = new Map(
    input.profiles.map((profile) => [profile.id, options.pendingGenerationPolls ?? 0])
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
    assert.equal(url.origin, 'http://127.0.0.1:43123');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('Origin'), 'https://demo.sotto.fm');
    assert.equal(headers.has('Host'), false);
    const path = url.pathname + url.search;
    const method = options.method ?? 'GET';
    requests.push(`${method} ${path}`);
    const body: unknown =
      typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    if (path === '/api/v1/access/household') {
      assert.deepEqual(body, { password: input.householdPassword });
      selected = '';
      return reply(
        { principal: null, expiresAt: Date.now() + 60000, sessionId: 'fixture-session' },
        200,
        { 'Set-Cookie': 'sotto_session=private-cookie; Secure; HttpOnly; Path=/' }
      );
    }
    assert.equal(headers.get('Cookie'), 'sotto_session=private-cookie');
    if (path === '/api/v1/profiles')
      return reply({ profiles: input.profiles.map((profile) => ({ id: profile.id })) });
    if (path === '/api/v1/access/select-profile') {
      selected = (body as { id: string }).id;
      return reply({ ok: true });
    }
    if (!path.startsWith('/api/v1/access/'))
      assert.equal(headers.get('X-Sotto-Expected-Profile-Id'), selected);
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
      assert.equal(progress?.courseIntent, true);
      assert.equal(state.course, null);
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
      assert.equal(progress?.preparationIntent, true);
      assert.equal(progress?.courseId, state.course);
      assert.deepEqual(body, {});
      assert.equal(state.operation, null);
      mutations.push({ path, profile: selected, body });
      state.operation = randomUUID();
      if (control.losePreparationReply) throw new Error('system boundary lost response');
      return reply({ started: true, status: 'QUEUED', operationId: state.operation }, 202);
    }
    if (path === `${course}/preparation`) {
      if (control.failActivity) throw new Error('system boundary unavailable');
      const remaining = pendingPolls.get(selected)!;
      const pending = state.status === 'COMPLETED' && remaining > 0;
      if (pending) pendingPolls.set(selected, remaining - 1);
      return reply({
        operationId: control.wrongOperation ? randomUUID() : state.operation,
        status: pending ? 'RUNNING' : state.status,
        aiProvider: 'codex',
        aiModel: control.wrongAiModel ? 'codex:other' : 'codex',
        maxProviderRequests: null,
        audioRequiresReview: false,
        providerRequestsCompleted: 2,
        providerRequestInFlight: false,
      });
    }
    if (path === `${course}/generation` && method === 'DELETE') {
      assert.equal(progress?.cancelIntent, true);
      assert.equal(progress?.operationId, state.operation);
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
      assert.equal(progress?.uploadIntent, true);
      assert.equal(progress?.reference?.promptId, prompt);
      assert(body instanceof FormData);
      const file = (body as FormData).get('audio') as File;
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), control.audioBytes);
      assert(file.name.includes('synthetic-reference'));
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
