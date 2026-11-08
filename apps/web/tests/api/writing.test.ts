// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSkillRequirements } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../helpers/setup/shared-instance';
import {
  admitWritingExecution,
  runWritingExecution,
  writingExecutionSchema,
} from '@/lib/learning/writing/writing-execution';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { setSiteConfig } from '@/lib/site-config';
import { POST } from '@/app/api/v1/classes/[classId]/writing/[promptId]/route';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { sampleTeaching } from '../helpers/learning/class-teaching';
import { submitLearningWriting } from '@/lib/learning/writing/writing-submission';
import { authorizedLearnerExecution } from '../helpers/runtime/provider-execution';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

const GRADE = {
  overallScore: 0.7,
  corrections: [],
  feedback: 'The supplied invitation is answered clearly.',
};
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Class writing HTTP submission against PostgreSQL', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let classId: string;
  let promptId: string;
  let sectionId: string;

  beforeAll(async () => {
    instance = await createSharedTestInstance('writing_routes');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    await setSiteConfig(
      { aiProvider: 'local', aiModel: 'writing-fixture', aiBaseUrl: 'http://localhost:11434/v1' },
      identity.ownerId
    );
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const lesson = await instance.database.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: 'invitations' } },
      create: {
        curriculumId: curriculum.id,
        slug: 'invitations',
        order: 1,
        level: 'A2',
        title: 'Invitations',
        objective: 'Reply to supplied invitations',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
      update: {},
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'en',
        targetLang: 'es',
      },
    });
    classId = (
      await instance.database.courseClass.create({
        data: {
          courseId: course.id,
          lessonId: lesson.id,
          order: 1,
          status: 'AVAILABLE',
          skillRequirements: createSkillRequirements({
            scope: 'CLASS',
            nativeLang: 'en',
            targetLang: 'es',
            level: 'A2',
            ttsProvider: null,
            sttProvider: null,
          }),
        },
      })
    ).id;
    sectionId = (
      await instance.database.classSection.create({
        data: { classId, skill: 'WRITING', status: 'READY', seed: 'invitation', spec: {} },
      })
    ).id;
    promptId = (
      await instance.database.writingPrompt.create({
        data: {
          sectionId,
          order: 1,
          task: 'Accept the supplied invitation: dinner on Thursday at 19:00.',
        },
      })
    ).id;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url !== 'http://localhost:11434/v1/chat/completions')
        throw new Error('Unexpected provider destination');
      return Response.json({
        id: 'writing-grade',
        object: 'chat.completion',
        created: 1,
        model: 'writing-fixture',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(GRADE) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
      });
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  function req(text: string, authenticated = true) {
    return new NextRequest('http://localhost/api/v1/classes/' + classId + '/writing/' + promptId, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { cookie: 'sotto_session=' + identity.ownerToken } : {}),
      },
      body: JSON.stringify({ text }),
    });
  }
  function params(parent = classId, prompt = promptId) {
    return { params: Promise.resolve({ classId: parent, promptId: prompt }) };
  }

  async function firstBeginnerGate() {
    const cls = await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        skillRequirements: createSkillRequirements({
          scope: 'CLASS',
          nativeLang: 'en',
          targetLang: 'es',
          level: 'A1',
          ttsProvider: null,
          sttProvider: null,
        }),
        adaptiveSeed: { teaching: sampleTeaching },
        writingDrafts: { [promptId]: 'A saved draft' },
      },
    });
    const materialHash = await initialA1MaterialHash(instance.database, classId, identity.ownerId);
    const receiptId = randomUUID();
    const gate = {
      version: 1,
      classId,
      courseId: cls.courseId,
      userId: identity.ownerId,
      attempt: 1,
      receiptId,
      materialHash,
    };
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { prerequisiteGate: gate },
    });
    return gate;
  }

  it('requires reviewed beginner teaching for new grading while preserving a saved grade and draft', async () => {
    const gate = await firstBeginnerGate();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const blocked = await POST(req('Sí, gracias.'), params());
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: 'PREREQUISITE_ACK_REQUIRED' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(0);
    await instance.database.writingResponse.create({
      data: {
        promptId,
        sectionId,
        userId: identity.ownerId,
        text: 'Sí, gracias.',
        attempt: 1,
        ...GRADE,
      },
    });
    const replay = await POST(req('Sí, gracias.'), params());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(GRADE);
    expect((await POST(req('Una respuesta nueva.'), params())).status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      (await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } }))
        .writingDrafts
    ).toEqual({ [promptId]: 'A saved draft' });
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        prerequisiteGate: {
          ...gate,
          acknowledgment: {
            userId: identity.ownerId,
            receiptId: gate.receiptId,
            materialHash: gate.materialHash,
          },
        },
      },
    });
    const prompt = await instance.database.writingPrompt.findUniqueOrThrow({
      where: { id: promptId },
    });
    await instance.database.writingPrompt.update({
      where: { id: promptId },
      data: { task: 'A changed writing task.' },
    });
    expect((await POST(req('Una respuesta nueva.'), params())).status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
    await instance.database.writingPrompt.update({
      where: { id: promptId },
      data: { task: prompt.task },
    });
    expect((await POST(req('Una respuesta nueva.'), params())).status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(2);
  });

  it('retains an unresolved beginner grade and does not admit another request', async () => {
    await firstBeginnerGate();
    await instance.database.writingResponse.create({
      data: { promptId, sectionId, userId: identity.ownerId, text: 'Unfinished', attempt: 1 },
    });
    await setSiteConfig({ aiProvider: null, aiModel: null, aiBaseUrl: null }, identity.ownerId);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await POST(req('A new answer'), params());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/pending or.*unknown/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(1);
  });

  it.each(['receipt', 'malformed teaching'] as const)(
    'fences paid writing when %s changes before grade publication',
    async (change) => {
      const gate = await firstBeginnerGate();
      const acknowledge = (receiptId: string) => ({
        ...gate,
        receiptId,
        acknowledgment: { userId: identity.ownerId, receiptId, materialHash: gate.materialHash },
      });
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { prerequisiteGate: acknowledge(gate.receiptId) },
      });
      const originalFetch = globalThis.fetch;
      const dispatched = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let requests = 0;
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        requests += 1;
        dispatched.resolve();
        await release.promise;
        return originalFetch(input, init);
      });
      const grading = POST(req('Sí, gracias.'), params());
      await dispatched.promise;
      try {
        await instance.database.courseClass.update({
          where: { id: classId },
          data:
            change === 'receipt'
              ? { prerequisiteGate: acknowledge(randomUUID()) }
              : { adaptiveSeed: { teaching: { version: 1 } } },
        });
      } finally {
        release.resolve();
      }
      const response = await grading;
      expect(response.status).toBe(change === 'receipt' ? 409 : 500);
      const retained = await instance.database.writingResponse.findFirstOrThrow({
        where: { promptId },
      });
      expect(retained.overallScore).toBeNull();
      expect(writingExecutionSchema.parse(retained.gradingState).status).toBe('UNRESOLVED');
      expect((await POST(req('Sí, gracias.'), params())).status).toBe(409);
      expect(requests).toBe(1);
      expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(1);
    }
  );

  it('does not dispatch when the acknowledged receipt changes after admission', async () => {
    const gate = await firstBeginnerGate();
    const acknowledged = (receiptId: string) => ({
      ...gate,
      receiptId,
      acknowledgment: { userId: identity.ownerId, receiptId, materialHash: gate.materialHash },
    });
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { prerequisiteGate: acknowledged(gate.receiptId) },
    });
    const admitted = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let paused = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const grading = submitLearningWriting({
      kind: 'CLASS',
      parentId: classId,
      promptId,
      userId: identity.ownerId,
      text: 'Sí, gracias.',
      execution: {
        userId: identity.ownerId,
        authorize: async (database) => {
          if (!paused && (await database.writingResponse.findFirst({ where: { promptId } }))) {
            paused = true;
            admitted.resolve();
            await resume.promise;
          }
          return { userId: identity.ownerId };
        },
      },
    });
    await admitted.promise;
    try {
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { prerequisiteGate: acknowledged(randomUUID()) },
      });
    } finally {
      resume.resolve();
    }
    await expect(grading).rejects.toThrow('Execution admission could not be confirmed');
    expect(fetchSpy).not.toHaveBeenCalled();
    const retained = await instance.database.writingResponse.findFirstOrThrow({
      where: { promptId },
    });
    expect(writingExecutionSchema.parse(retained.gradingState).status).toBe('FAILED');
    expect((await POST(req('Sí, gracias.'), params())).status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns feedback and saves the response with its current attempt', async () => {
    const response = await POST(req('Sí, quiero ir.'), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(GRADE);
    expect(await instance.database.writingResponse.findMany({ where: { promptId } })).toMatchObject(
      [{ userId: identity.ownerId, attempt: 1, text: 'Sí, quiero ir.', ...GRADE }]
    );
  });
  it('retains earlier writing when the learner submits a revised response', async () => {
    expect((await POST(req('Sí, quiero ir.'), params())).status).toBe(200);
    expect((await POST(req('Gracias. Puedo llegar a las siete.'), params())).status).toBe(200);
    const responses = await instance.database.writingResponse.findMany({
      where: { promptId },
      orderBy: { createdAt: 'asc' },
    });
    expect(responses.map((response) => response.text)).toEqual([
      'Sí, quiero ir.',
      'Gracias. Puedo llegar a las siete.',
    ]);
    expect(responses.every((response) => response.overallScore === GRADE.overallScore)).toBe(true);
  });
  it('requires authentication before creating a writing response', async () => {
    expect((await POST(req('Sí.', false), params())).status).toBe(401);
    expect(await instance.database.writingResponse.count()).toBe(0);
  });
  it.each(['class', 'prompt'] as const)(
    'rejects a missing or foreign %s without saving work',
    async (missing) => {
      const response = await POST(
        req('Sí.'),
        params(
          missing === 'class' ? 'another-class' : classId,
          missing === 'prompt' ? 'another-prompt' : promptId
        )
      );
      expect(response.status).toBe(404);
      expect(await instance.database.writingResponse.count()).toBe(0);
    }
  );
  it('returns the saved grade after a lost acknowledgement without asking the provider again', async () => {
    await instance.database.writingResponse.create({
      data: {
        promptId,
        sectionId,
        userId: identity.ownerId,
        text: 'Sí, gracias.',
        attempt: 1,
        overallScore: GRADE.overallScore,
        corrections: GRADE.corrections,
        feedback: GRADE.feedback,
      },
    });
    vi.stubGlobal('fetch', async () => {
      throw new Error('A saved grade must not call the provider');
    });
    const response = await POST(req('Sí, gracias.'), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(GRADE);
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(1);
  });

  it.each(['Sí, gracias.', 'A revised answer.'])(
    'does not replay an unresolved writing grade for %s',
    async (text) => {
      await instance.database.writingResponse.create({
        data: {
          promptId,
          sectionId,
          userId: identity.ownerId,
          text: 'Sí, gracias.',
          attempt: 1,
        },
      });
      vi.stubGlobal('fetch', async () => {
        throw new Error('Unresolved work must not call the provider');
      });
      const response = await POST(req(text), params());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/pending or.*unknown/),
      });
      expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(1);
    }
  );

  it('admits one response while grading is active and reuses its grade after publication', async () => {
    const provider = globalThis.fetch;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      started();
      await waiting;
      return provider(input, init);
    });
    const first = POST(req('Sí, gracias.'), params());
    try {
      await dispatched;
      const second = await POST(req('Sí, gracias.'), params());
      expect(second.status).toBe(409);
      expect(
        await instance.database.writingResponse.findMany({ where: { promptId } })
      ).toMatchObject([{ text: 'Sí, gracias.', overallScore: null }]);
    } finally {
      release();
    }
    expect((await first).status).toBe(200);
    const replay = await POST(req('Sí, gracias.'), params());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(GRADE);
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(1);
  });

  it('allows a confirmed invalid grade to be replaced only after its execution drains', async () => {
    const provider = globalThis.fetch;
    vi.stubGlobal('fetch', async () =>
      Response.json({
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"overallScore":-3}' },
            finish_reason: 'stop',
          },
        ],
        model: 'writing-fixture',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    );
    expect((await POST(req('Sí, gracias.'), params())).status).toBe(500);
    const failed = await instance.database.writingResponse.findFirstOrThrow({
      where: { promptId },
    });
    const state = writingExecutionSchema.parse(failed.gradingState);
    expect(state.status).toBe('FAILED');
    expect(failed.overallScore).toBeNull();
    await sottoTransaction(instance.database, async (database) => {
      await sottoJobExecutions(database).requireParentDrained(state.id, state.fingerprint);
      expect(await sottoJobOutbox(database).receipt(state.id)).toMatchObject({
        status: 'complete',
      });
    });
    vi.stubGlobal('fetch', provider);
    expect((await POST(req('Sí, gracias.'), params())).status).toBe(200);
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(2);
  });

  it('fences a successful provider response when grading fails before producing a result', async () => {
    expect((await POST(req('First answer.'), params())).status).toBe(200);
    const previous = await instance.database.writingResponse.findFirstOrThrow({
      where: { promptId },
    });
    const selection = writingExecutionSchema.parse(previous.gradingState).selection;
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const execution = authorizedLearnerExecution(identity.ownerId);
    const admitted = await sottoTransaction(instance.database, async (database) => {
      const response = await database.writingResponse.create({
        data: { promptId, sectionId, userId: identity.ownerId, text: 'Second answer.', attempt: 1 },
      });
      const operation = await admitWritingExecution(database, {
        responseId: response.id,
        courseId: cls.courseId,
        execution,
        selection,
        classAuthorization: null,
      });
      return { response, operation };
    });
    await expect(
      runWritingExecution({
        responseId: admitted.response.id,
        operation: admitted.operation,
        execution,
        validate: async () => {},
        grade: async (providerExecution) => {
          if (!providerExecution.providerRequest) throw new Error('Missing provider boundary');
          await providerExecution.providerRequest(
            new Request('https://provider.example/grade', { method: 'POST', body: '{}' }),
            async () => Response.json({ completed: true })
          );
          throw new Error('The grade could not be assembled.');
        },
        publish: async () => {
          throw new Error('Unexpected publication');
        },
      })
    ).rejects.toThrow('The grade could not be assembled.');
    const retained = await instance.database.writingResponse.findUniqueOrThrow({
      where: { id: admitted.response.id },
    });
    expect(writingExecutionSchema.parse(retained.gradingState).status).toBe('UNRESOLVED');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await POST(req('Second answer.'), params())).status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps unknown provider outcomes fenced without a second paid dispatch', async () => {
    const dispatched: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      dispatched.push(new Request(input, init).url);
      throw new Error('Connection lost after dispatch');
    });
    expect((await POST(req('Sí, gracias.'), params())).status).toBe(500);
    const failed = await instance.database.writingResponse.findFirstOrThrow({
      where: { promptId },
    });
    expect(writingExecutionSchema.parse(failed.gradingState).status).toBe('UNRESOLVED');
    expect((await POST(req('Sí, gracias.'), params())).status).toBe(409);
    expect(dispatched).toHaveLength(1);
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(1);
  });

  it('fences a recovered successful provider request whose grade publication was lost', async () => {
    expect((await POST(req('Sí, gracias.'), params())).status).toBe(200);
    const response = await instance.database.writingResponse.findFirstOrThrow({
      where: { promptId },
    });
    const state = writingExecutionSchema.parse(response.gradingState);
    await instance.database.writingResponse.update({
      where: { id: response.id },
      data: {
        overallScore: null,
        feedback: null,
        corrections: [],
        gradingState: { ...state, status: 'RUNNING', expiresAt: Date.now() - 1 },
      },
    });
    await setSiteConfig({ aiProvider: null, aiModel: null, aiBaseUrl: null }, identity.ownerId);
    vi.stubGlobal('fetch', async () => {
      throw new Error('Recovery must not replay paid work');
    });
    expect((await POST(req('Sí, gracias.'), params())).status).toBe(409);
    expect(
      writingExecutionSchema.parse(
        (await instance.database.writingResponse.findUniqueOrThrow({ where: { id: response.id } }))
          .gradingState
      ).status
    ).toBe('UNRESOLVED');
    expect((await POST(req('Sí, gracias.'), params())).status).toBe(409);
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(1);
  });

  it('commits drained writing recovery before returning a prerequisite conflict', async () => {
    expect((await POST(req('First answer.'), params())).status).toBe(200);
    const previous = await instance.database.writingResponse.findFirstOrThrow({
      where: { promptId },
    });
    const selection = writingExecutionSchema.parse(previous.gradingState).selection;
    await firstBeginnerGate();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const execution = authorizedLearnerExecution(identity.ownerId);
    const pending = await sottoTransaction(instance.database, async (database) => {
      const response = await database.writingResponse.create({
        data: { promptId, sectionId, userId: identity.ownerId, text: 'Saved draft.', attempt: 1 },
      });
      const operation = await admitWritingExecution(database, {
        responseId: response.id,
        courseId: cls.courseId,
        execution,
        selection,
      });
      await database.writingResponse.update({
        where: { id: response.id },
        data: { gradingState: { ...operation, expiresAt: Date.now() - 1 } },
      });
      return response;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await POST(req('Saved draft.'), params());
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: 'PREREQUISITE_ACK_REQUIRED' });
    const recovered = await instance.database.writingResponse.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(writingExecutionSchema.parse(recovered.gradingState).status).toBe('FAILED');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(2);
  });

  it('commits recovery for work discovered between preflight and admission', async () => {
    expect((await POST(req('First answer.'), params())).status).toBe(200);
    const previous = await instance.database.writingResponse.findFirstOrThrow({
      where: { promptId },
    });
    const selection = writingExecutionSchema.parse(previous.gradingState).selection;
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const actor = authorizedLearnerExecution(identity.ownerId);
    let authorizations = 0;
    let injectedId = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      submitLearningWriting({
        kind: 'CLASS',
        parentId: classId,
        promptId,
        userId: identity.ownerId,
        text: 'New answer.',
        execution: {
          userId: identity.ownerId,
          authorize: async (database) => {
            authorizations += 1;
            if (authorizations === 2) {
              const response = await database.writingResponse.create({
                data: {
                  promptId,
                  sectionId,
                  userId: identity.ownerId,
                  text: 'Earlier pending answer.',
                  attempt: 1,
                },
              });
              injectedId = response.id;
              const operation = await admitWritingExecution(database, {
                responseId: response.id,
                courseId: cls.courseId,
                execution: actor,
                selection,
              });
              await learningPreparationGrant(database, operation, 'writing').admit(
                operation.grant,
                {
                  id: randomUUID(),
                  fingerprint: 'a'.repeat(64),
                }
              );
              await database.writingResponse.update({
                where: { id: response.id },
                data: { gradingState: { ...operation, expiresAt: Date.now() - 1 } },
              });
            }
            return { userId: identity.ownerId };
          },
        },
      })
    ).rejects.toThrow(/pending or.*unknown/);
    expect(injectedId).not.toBe('');
    const recovered = await instance.database.writingResponse.findUniqueOrThrow({
      where: { id: injectedId },
    });
    expect(writingExecutionSchema.parse(recovered.gradingState).status).toBe('UNRESOLVED');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(2);
  });

  it('rolls back the pending response when its durable execution admission fails', async () => {
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION reject_writing_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."gradingState" IS NOT NULL THEN RAISE EXCEPTION 'Writing intent unavailable'; END IF; RETURN NEW; END; $$`
    );
    await instance.database.$executeRawUnsafe(
      `CREATE TRIGGER reject_writing_intent BEFORE UPDATE ON "WritingResponse" FOR EACH ROW EXECUTE FUNCTION reject_writing_intent()`
    );
    vi.stubGlobal('fetch', async () => {
      throw new Error('Uncommitted writing must not dispatch');
    });
    try {
      expect((await POST(req('Sí, gracias.'), params())).status).toBe(500);
      expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(0);
    } finally {
      await instance.database.$executeRawUnsafe(
        `DROP TRIGGER reject_writing_intent ON "WritingResponse"`
      );
      await instance.database.$executeRawUnsafe('DROP FUNCTION reject_writing_intent()');
    }
  });

  it('rejects blank writing before generation or persistence', async () => {
    expect((await POST(req('   '), params())).status).toBe(400);
    expect(await instance.database.writingResponse.count()).toBe(0);
  });
  it('preserves earlier grades while starting evidence for a new section attempt', async () => {
    expect((await POST(req('Sí, quiero ir.'), params())).status).toBe(200);
    await instance.database.classSection.update({ where: { id: sectionId }, data: { attempt: 2 } });
    expect((await POST(req('Sí. Llegaré a las siete.'), params())).status).toBe(200);
    expect(
      await instance.database.writingResponse.findMany({
        where: { promptId },
        orderBy: { createdAt: 'asc' },
      })
    ).toMatchObject([
      { attempt: 1, overallScore: 0.7 },
      { attempt: 2, overallScore: 0.7 },
    ]);
  });
});
