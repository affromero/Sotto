// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSkillRequirements } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../helpers/setup/shared-instance';
import {
  reconcileWritingResponse,
  writingExecutionSchema,
} from '@/lib/learning/writing/writing-execution';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { setSiteConfig } from '@/lib/site-config';
import { POST } from '@/app/api/v1/classes/[classId]/writing/[promptId]/route';

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
    await sottoTransaction(instance.database, (database) =>
      reconcileWritingResponse(database, response.id)
    );
    expect(
      writingExecutionSchema.parse(
        (await instance.database.writingResponse.findUniqueOrThrow({ where: { id: response.id } }))
          .gradingState
      ).status
    ).toBe('UNRESOLVED');
    vi.stubGlobal('fetch', async () => {
      throw new Error('Recovery must not replay paid work');
    });
    expect((await POST(req('Sí, gracias.'), params())).status).toBe(409);
    expect(await instance.database.writingResponse.count({ where: { promptId } })).toBe(1);
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
