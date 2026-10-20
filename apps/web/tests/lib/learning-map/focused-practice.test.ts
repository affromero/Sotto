// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Job } from 'bullmq';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillRequirements,
  learningSelectionPreviewSchema,
  practicePreparingSchema,
  type LearningSelectionRequest,
  type LearningObjective,
} from '@sotto/shared';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { POST as start } from '@/app/api/v1/courses/[courseId]/practice/route';
import { POST as preview } from '@/app/api/v1/courses/[courseId]/learning-map/selection/route';
import { createInitialCourse } from '@/lib/placement-course';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { focusedPracticeRequirements } from '@/lib/learning-map/selection';
import { readPracticePreparation, requestPracticePreparation } from '@/lib/practice/preparation';
import {
  practiceGenerationSchema,
  practicePreparationSchema,
} from '@/lib/practice/preparation-state';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { getServerInfra } from '@/lib/server-config';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { processPracticePreparation } from '@/workers/practice/practice-preparation.worker';
import { resumePractice } from '@/lib/practice/resume';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(`${process.cwd()}/package.json`)('openai') };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('repeatable focused practice with immutable owned difficulty', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let course: Awaited<ReturnType<typeof createInitialCourse>>;
  const catalog = getLanguageCatalog('de');
  const objectives = catalog.nodes.filter(
    (node): node is LearningObjective =>
      node.kind === 'OBJECTIVE' && node.branch === 'GRAMMAR' && node.level === 'A1'
  );
  const selection = (extra: Partial<LearningSelectionRequest> = {}): LearningSelectionRequest => ({
    catalogVersion: catalog.version,
    nodeIds: [objectives[0]!.id],
    level: 'A1',
    ...extra,
  });
  const execution = () => ({
    userId: identity.ownerId,
    authorize: async () => ({ userId: identity.ownerId }),
  });
  beforeAll(async () => {
    instance = await createSharedTestInstance('focused_practice');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'openai', 'synthetic-focused-practice-key');
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: {
        preferredAiProvider: 'openai',
        preferredAiModel: getAiProviderMeta('openai').defaultModel,
      },
    });
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Focused practice fixture' },
      update: {},
    });
    course = await sottoTransaction(instance.database, (database) =>
      createInitialCourse(
        database,
        {
          userId: identity.ownerId,
          native: 'en',
          target: 'de',
          curriculumId: curriculum.id,
          level: 'A2',
          source: 'MANUAL',
        },
        execution()
      )
    );
    vi.stubGlobal('fetch', async () => {
      throw new Error('Focused admission and preview must not dispatch paid provider work.');
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  const params = () => ({ params: Promise.resolve({ courseId: course.id }) });
  function request(body: unknown, token = identity.ownerToken, origin = 'http://localhost:3000') {
    return new NextRequest(`http://localhost:3000/api/v1/courses/${course.id}/practice`, {
      method: 'POST',
      headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  async function admit(
    body: {
      kind?: string;
      requestId?: string;
      learningSelection?: LearningSelectionRequest;
      focusTargetId?: string;
    } = {}
  ) {
    const requestId = body.requestId ?? randomUUID();
    const response = await start(
      request({ kind: 'GRAMMAR', learningSelection: selection(), ...body, requestId }),
      params()
    );
    expect(response.status).toBe(202);
    const progress = practicePreparingSchema.parse(await response.json());
    expect(progress.preparationStatus).toBe('QUEUED');
    return { requestId, progress };
  }
  const saved = (sessionId: string) =>
    sottoTransaction(instance.database, (database) => readPracticePreparation(database, sessionId));

  it('previews concrete lower-level objectives and formats without pinning review requirements', async () => {
    const response = await preview(request(selection()), params());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const result = learningSelectionPreviewSchema.parse(await response.json());
    expect(result.selection.objectives.map((value) => value.id)).toEqual([objectives[0]!.id]);
    expect(result.selection.level).toBe('A1');
    expect(result.availableKinds).toEqual(['FULL', 'GRAMMAR', 'WRITING']);
    expect(result.requirementId).toBeNull();
    expect(
      await instance.database.learningLevelBinding.count({
        where: { courseId: course.id, level: 'A1' },
      })
    ).toBe(0);
    expect(await instance.database.practiceSession.count()).toBe(0);
  });

  it('pins A1 grammar-only practice with no vocabulary and preserves the A2 course and active lower class', async () => {
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_order: { curriculumId: course.curriculumId, order: 9991 } },
      create: {
        curriculumId: course.curriculumId,
        order: 9991,
        slug: 'lower-active-focused-fixture',
        title: 'Active A1 lesson',
        objective: 'Use a simple verb.',
        level: 'A1',
        grammarPoints: [],
        vocabThemes: [],
        targetVocab: [],
      },
      update: {},
    });
    const active = await instance.database.courseClass.create({
      data: { courseId: course.id, lessonId: lesson.id, order: 9991, status: 'IN_PROGRESS' },
    });
    await instance.database.learnerGrammar.create({
      data: {
        courseId: course.id,
        topicKey: 'unrelated-due-topic',
        title: 'Unrelated review',
        cefrLevel: 'A2',
        dueAt: new Date(0),
      },
    });
    const { progress } = await admit();
    const work = await saved(progress.sessionId);
    expect(work.generation.practiceLevel).toBe('A1');
    expect(work.session.practiceLevel).toBe('A1');
    expect(work.generation.course.currentLevel).toBe('A2');
    expect(work.generation.requirements.level).toBe('A1');
    expect(work.generation.seed?.objective).toContain(objectives[0]!.title);
    expect(work.generation.seed?.grammarPoints).toEqual(objectives[0]!.grammarKeys);
    expect(work.generation.seed?.grammarPoints).not.toContain('unrelated-due-topic');
    expect(work.generation.seed?.targetVocab).toEqual([]);
    expect(work.generation.learningSelection?.objectives.map((value) => value.id)).toEqual([
      objectives[0]!.id,
    ]);
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: course.id } })
    ).toMatchObject({ currentLevel: 'A2', startLevel: 'A2', placementSource: 'MANUAL' });
    expect(
      await instance.database.courseClass.findUnique({ where: { id: active.id } })
    ).toMatchObject({ status: 'IN_PROGRESS' });
    expect(
      await instance.database.learningLevelBinding.count({ where: { courseId: course.id } })
    ).toBe(2);
    expect(
      await instance.database.learningObservation.count({ where: { courseId: course.id } })
    ).toBe(0);
  });

  it('replays the entire normalized selection and creates a fresh variation for a new request', async () => {
    const first = await admit({
      learningSelection: selection({
        nodeIds: [objectives[1]!.id, objectives[0]!.id, objectives[1]!.id],
      }),
    });
    const replay = await admit({
      requestId: first.requestId,
      learningSelection: selection({ nodeIds: [objectives[0]!.id, objectives[1]!.id] }),
    });
    expect(replay.progress.sessionId).toBe(first.progress.sessionId);
    const second = await admit({
      learningSelection: selection({ nodeIds: [objectives[0]!.id, objectives[1]!.id] }),
    });
    const [left, right] = await Promise.all([
      saved(first.progress.sessionId),
      saved(second.progress.sessionId),
    ]);
    expect(left.generation.seedToken).not.toBe(right.generation.seedToken);
    expect(left.generation.learningSelection).toEqual(right.generation.learningSelection);
    expect(await instance.database.practiceSession.count()).toBe(2);
  });

  it('rejects changed objective, level, revision, source and lexical focus for an admitted identity', async () => {
    const first = await admit();
    for (const changed of [
      selection({ nodeIds: [objectives[1]!.id] }),
      selection({ level: 'A2' }),
      selection({ catalogVersion: catalog.version + 1 }),
      selection({ materialFocusId: 'foreign-source' }),
    ]) {
      const response = await start(
        request({ kind: 'GRAMMAR', requestId: first.requestId, learningSelection: changed }),
        params()
      );
      expect(response.status).toBe(409);
    }
    expect(
      (
        await start(
          request({
            kind: 'GRAMMAR',
            requestId: first.requestId,
            learningSelection: selection(),
            focusTargetId: 'another-focus',
          }),
          params()
        )
      ).status
    ).toBe(409);
    expect(await instance.database.practiceSession.count()).toBe(1);
  });

  it('deduplicates concurrent identical admissions and conflicts on competing different selections', async () => {
    const requestId = randomUUID();
    const results = await Promise.all(
      [0, 1].map(() =>
        requestPracticePreparation(course.id, 'GRAMMAR', execution(), {
          requestId,
          learningSelection: selection(),
        })
      )
    );
    expect(new Set(results.map((value) => value.id)).size).toBe(1);
    const competing = randomUUID();
    const responses = await Promise.all(
      [selection(), selection({ nodeIds: [objectives[1]!.id] })].map((learningSelection) =>
        start(request({ kind: 'GRAMMAR', requestId: competing, learningSelection }), params())
      )
    );
    expect(responses.map((value) => value.status).sort()).toEqual([202, 409]);
    expect(await instance.database.practiceSession.count()).toBe(2);
  });

  it('allows confident objectives to be practised again without requiring due work', async () => {
    const { progress } = await admit();
    await instance.database.learnerObjectiveState.create({
      data: {
        courseId: course.id,
        objectiveId: objectives[0]!.id,
        criterionVersion: objectives[0]!.criterionVersion,
        policyVersion: objectives[0]!.policyVersion,
        level: 'A1',
        skill: 'GRAMMAR',
        mastery: 0.99,
        assessedTasks: 12,
        assessedSessions: 4,
        dueAt: new Date(Date.now() + 86400000),
      },
    });
    const repeat = await admit();
    expect((await saved(repeat.progress.sessionId)).generation.learningSelection).toEqual(
      (await saved(progress.sessionId)).generation.learningSelection
    );
    expect(
      await instance.database.learnerObjectiveState.findFirstOrThrow({
        where: { courseId: course.id },
      })
    ).toMatchObject({ mastery: 0.99, assessedSessions: 4 });
  });

  it('keeps future bands preview-only and rejects unsupported formats or unowned sources before admission', async () => {
    const future = catalog.nodes.find((node) => node.kind === 'OBJECTIVE' && node.level === 'B1')!;
    const response = await start(
      request({
        kind: 'GRAMMAR',
        learningSelection: selection({ nodeIds: [future.id], level: 'B1' }),
      }),
      params()
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'Reach this level to practise its objectives.',
    });
    expect(
      (await preview(request(selection({ nodeIds: [future.id], level: 'B1' })), params())).status
    ).toBe(409);
    expect(
      (await start(request({ kind: 'READING', learningSelection: selection() }), params())).status
    ).toBe(422);
    expect(
      (
        await start(
          request({
            kind: 'GRAMMAR',
            learningSelection: selection({ nodeIds: [], materialFocusId: randomUUID() }),
          }),
          params()
        )
      ).status
    ).toBe(404);
    expect(await instance.database.practiceSession.count()).toBe(0);
  });

  it('requires the owner and browser origin while rejecting malformed UTF8 and private snapshot injection', async () => {
    const foreign = await identity.household('Focused foreign learner');
    expect(
      (
        await start(
          request({ kind: 'GRAMMAR', learningSelection: selection() }, foreign.token),
          params()
        )
      ).status
    ).toBe(404);
    expect(
      (
        await start(
          request(
            { kind: 'GRAMMAR', learningSelection: selection() },
            identity.ownerToken,
            'https://other.invalid'
          ),
          params()
        )
      ).status
    ).toBe(403);
    const invalid = request({
      kind: 'GRAMMAR',
      learningSelection: { ...selection(), sourceFocus: { approved: true } },
    });
    expect((await start(invalid, params())).status).toBe(400);
    const bytes = new NextRequest(`http://localhost:3000/api/v1/courses/${course.id}/practice`, {
      method: 'POST',
      headers: {
        cookie: `sotto_session=${identity.ownerToken}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: new Uint8Array([123, 0xff, 125]),
    });
    expect((await start(bytes, params())).status).toBe(400);
    expect(await instance.database.practiceSession.count()).toBe(0);
  });

  it('preserves legacy queued identity without inventing difficulty or changing its fingerprint', async () => {
    const operation = await requestPracticePreparation(course.id, 'VOCAB', execution(), {
      requestId: randomUUID(),
    });
    const row = await instance.database.practiceSession.findUniqueOrThrow({
      where: { id: operation.sessionId },
    });
    const generation = practiceGenerationSchema.parse(row.generationSpec);
    const {
      schemaVersion,
      practiceLevel,
      learningRequest,
      learningSelection,
      levelCoverage,
      ...legacy
    } = generation;
    expect([
      schemaVersion,
      practiceLevel,
      learningRequest,
      learningSelection,
      levelCoverage,
    ]).toHaveLength(5);
    const {
      generationVersion,
      practiceLevel: operationLevel,
      learningRequest: operationRequest,
      ...previous
    } = practicePreparationSchema.parse(row.generationState);
    expect(generationVersion).toBe(2);
    expect(operationLevel).toBe('A2');
    expect(operationRequest).toBeNull();
    const inputFingerprint = createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
    await instance.database.practiceSession.update({
      where: { id: row.id },
      data: {
        practiceLevel: null,
        learningSelection: Prisma.JsonNull,
        generationSpec: legacy,
        generationState: { ...previous, inputFingerprint },
      },
    });
    const reread = await saved(row.id);
    expect(reread.generation).not.toHaveProperty('schemaVersion');
    expect(reread.generation).not.toHaveProperty('practiceLevel');
    expect(reread.operation.inputFingerprint).toBe(inputFingerprint);
    expect(reread.session.practiceLevel).toBeNull();
  });

  it('rejects tampered stored difficulty and preserves pinned oral exemptions without waiving required speech', async () => {
    const { progress } = await admit();
    await instance.database.practiceSession.update({
      where: { id: progress.sessionId },
      data: { practiceLevel: 'B1' },
    });
    await expect(saved(progress.sessionId)).rejects.toThrow('stored practice difficulty');
    const base = { nativeLang: 'en', targetLang: 'de', level: 'A1' as const };
    const exempt = createSkillRequirements({
      ...base,
      scope: 'CLASS',
      ttsProvider: null,
      sttProvider: null,
    });
    const configured = createSkillRequirements({
      ...base,
      scope: 'FULL',
      ttsProvider: 'local',
      sttProvider: 'local',
    });
    expect(focusedPracticeRequirements(configured, exempt).skills.SPEAKING.state).toBe(
      'EXEMPT_NO_PROVIDER'
    );
    const required = createSkillRequirements({
      ...base,
      scope: 'CLASS',
      ttsProvider: 'local',
      sttProvider: 'local',
    });
    const absent = createSkillRequirements({
      ...base,
      scope: 'FULL',
      ttsProvider: null,
      sttProvider: null,
    });
    expect(() => focusedPracticeRequirements(absent, required)).toThrow(
      'Restore the configured speech provider'
    );
  });

  it.each(['GRAMMAR', 'SPEAKING'] as const)(
    'generates and resumes canonical A1 %s for an A2 learner without leaking private assessments or demoting the course',
    async (kind) => {
      vi.unstubAllGlobals();
      const requests: string[] = [];
      const failures: string[] = [];
      const questions = [
        { question: 'Ich ____ heute müde.', options: ['bin', 'bist', 'seid', 'sind'] },
        { question: 'Du ____ heute Hunger.', options: ['hast', 'habe', 'hat', 'haben'] },
        { question: 'Lena ____ Ärztin.', options: ['ist', 'bin', 'bist', 'seid'] },
        { question: 'Wir ____ jetzt Zeit.', options: ['haben', 'habe', 'hast', 'hat'] },
        { question: 'Ihr ____ pünktlich.', options: ['seid', 'sind', 'ist', 'bin'] },
      ];
      const server = createServer(async (request, response) => {
        try {
          if (request.url !== '/v1/chat/completions')
            throw new Error('Unexpected local fixture endpoint.');
          let bytes = '';
          for await (const part of request) bytes += part.toString();
          const payload = JSON.parse(bytes) as {
            messages: { role: string; content: string }[];
            response_format?: { json_schema?: { name?: string } };
          };
          const schema = payload.response_format?.json_schema?.name ?? '';
          requests.push(schema);
          const user = payload.messages.at(-1)?.content ?? '';
          let input: {
            items?: { index: number }[];
            questions?: { index: number; question: string; options: string[] }[];
            inputSha256?: string;
            scope?: { criteria: { objectiveId: string }[] };
            tasks?: { question?: string; task?: string }[];
            selectedObjective?: string;
            privateSourceContext?: string;
          } = {};
          try {
            input = JSON.parse(user);
          } catch {
            /* The generation prompt is plain text. */
          }
          let output: unknown;
          if (schema === 'class_section_questions') {
            expect(payload.messages[0]!.content).toContain('A1');
            output = {
              passage: '',
              questions: questions.map((question) => ({
                ...question,
                correctIndex: 0,
                explanation: 'Use the present form required by the subject.',
                passageRef: '',
                taskContext: 'Ergänze das passende Verb im Präsens.',
              })),
            };
          } else if (schema === 'independent_communicative_speaking_tasks') {
            expect(input.selectedObjective).toContain(
              catalog.nodes.find(
                (node) =>
                  node.kind === 'OBJECTIVE' && node.level === 'A1' && node.branch === 'SITUATIONS'
              )!.title
            );
            expect(input.privateSourceContext).toContain(
              'Specific source heading: reciprocal introductions'
            );
            output = {
              prompts: [
                'a new language club',
                'a first class',
                'a new colleague at lunch',
                'a visitor at your school',
              ].map((role) => ({
                task: `You meet someone at ${role}. Introduce yourself, say where you come from and ask about the other person.`,
                guidance:
                  'Respond in German using your own name and country. Ask one relevant question.',
              })),
            };
          } else if (schema === 'class_teaching_critic')
            output = { items: input.items!.map(({ index }) => ({ index, findings: [] })) };
          else if (schema === 'class_teaching_adjudicator')
            output = {
              items: input.items!.map(({ index }) => ({
                index,
                newFindings: [],
                criticDecisions: [],
              })),
            };
          else if (schema === 'class_section_quality')
            output = {
              passageFindings: [],
              issues: [],
              questions: input.questions!.map((value) => ({
                index: value.index,
                acceptableOptionIndices: [
                  value.options.indexOf(questions[value.index]!.options[0]!),
                ],
                issues: [],
              })),
            };
          else if (schema === 'exact_objective_assessment_review')
            output = {
              inputSha256: input.inputSha256,
              items: input.tasks!.map((task, index) => ({
                index,
                objectiveId: input.scope!.criteria[0]!.objectiveId,
                elicitationQuote: task.question ?? task.task,
                rationale:
                  'The independent task directly elicits the exact finite form or required introduction and reciprocal question.',
              })),
            };
          else if (input.items)
            output = {
              items: input.items.map(({ index }) => ({
                index,
                acceptable: true,
                issues: [],
                feedback: [],
              })),
            };
          else throw new Error(`Unexpected local generation request: ${schema}`);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              id: 'synthetic-focus-response',
              object: 'chat.completion',
              created: 1,
              model: 'synthetic-focus',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: JSON.stringify(output) },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
            })
          );
        } catch (error) {
          failures.push(String(error));
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: String(error) } }));
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing local fixture endpoint.');
      const nativeFetch = globalThis.fetch;
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === `http://127.0.0.1:${address.port}`) return nativeFetch(input, init);
        if (url.hostname === 'api.openai.com' && url.pathname === '/v1/moderations')
          return Response.json({
            id: 'synthetic-moderation',
            model: 'synthetic-moderation',
            results: [{ flagged: false, categories: {}, category_scores: {} }],
          });
        throw new Error(
          `External provider dispatch is prohibited in this fixture: ${url.origin}${url.pathname}`
        );
      });
      try {
        await instance.configureInfrastructure({
          ...(await getServerInfra()),
          aiProvider: 'local',
          aiModel: 'local:synthetic-focus',
          aiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
          ttsProvider: kind === 'SPEAKING' ? 'local' : null,
          ttsBaseUrl: `http://127.0.0.1:${address.port}`,
          sttProvider: kind === 'SPEAKING' ? 'local' : null,
          sttBaseUrl: `http://127.0.0.1:${address.port}`,
          sttModel: kind === 'SPEAKING' ? 'synthetic-speech' : null,
        });
        await instance.database.user.update({
          where: { id: identity.ownerId },
          data: { preferredAiProvider: 'local', preferredAiModel: 'local:synthetic-focus' },
        });
        await instance.database.courseNote.create({
          data: { courseId: course.id, body: 'Specific source heading: reciprocal introductions' },
        });
        const selected =
          kind === 'GRAMMAR'
            ? selection()
            : selection({
                nodeIds: [
                  catalog.nodes.find(
                    (node) =>
                      node.kind === 'OBJECTIVE' &&
                      node.level === 'A1' &&
                      node.branch === 'SITUATIONS'
                  )!.id,
                ],
              });
        const operation = await requestPracticePreparation(course.id, kind, execution(), {
          requestId: randomUUID(),
          learningSelection: selected,
        });
        const record = await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(operation.id)
        );
        if (!record) throw new Error('Missing durable practice outbox.');
        const job = {
          id: operation.id,
          name: 'practice-preparation.v1',
          data: { operationId: operation.id, fingerprint: record.fingerprint },
        } as Job<unknown>;
        await processPracticePreparation(job);
        const work = await saved(operation.sessionId);
        expect(
          work.operation.status,
          JSON.stringify({ failures, requests, operation: work.operation })
        ).toBe('COMPLETED');
        expect(work.session.status).toBe('ACTIVE');
        const resumed = await resumePractice(operation.sessionId, identity.ownerId);
        expect(resumed).toMatchObject({
          practiceLevel: 'A1',
          learningSelection: { level: 'A1', objectives: [{ id: selected.nodeIds[0] }] },
        });
        if (kind === 'GRAMMAR') {
          if (resumed.status !== 'ready') throw new Error('Expected published grammar practice.');
          expect(resumed.items).toHaveLength(5);
          expect(JSON.stringify(resumed.items)).not.toMatch(
            /correctIndex|learningAssessment|elicitationQuote/
          );
        } else {
          if (resumed.status !== 'ready_speaking')
            throw new Error('Expected published communicative practice.');
          expect(resumed.prompts).toHaveLength(4);
          expect(
            resumed.prompts.every(
              (prompt) => prompt.taskMode === 'COMMUNICATIVE' && prompt.referenceTtsUrl === null
            )
          ).toBe(true);
          expect(resumed.skillRequirements?.referenceAudioRequired).toBe(true);
          expect(JSON.stringify(resumed.prompts)).not.toMatch(
            /learningObjectives|elicitationQuote|modelAnswer/
          );
          expect(requests).toContain('independent_communicative_speaking_tasks');
        }
        expect(
          await instance.database.course.findUniqueOrThrow({ where: { id: course.id } })
        ).toMatchObject({ currentLevel: 'A2', startLevel: 'A2' });
        const before = requests.length;
        await processPracticePreparation(job);
        expect(requests).toHaveLength(before);
        expect(requests).toContain('exact_objective_assessment_review');
        expect(failures).toEqual([]);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    }
  );
});
