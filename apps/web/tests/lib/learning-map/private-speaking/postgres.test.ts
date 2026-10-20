// @vitest-environment node
import { createServer } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
import { getServerInfra } from '@/lib/server-config';
import { composePrivateSourceSpeaking } from '@/lib/learning-map/evidence/private-speaking/compose';
import { gradePrivateSourceSpeaking } from '@/lib/learning-map/evidence/private-speaking/grade';
import { recordPracticeAssessmentObservations } from '@/lib/learning-map/evidence/session';
import { privateSpeakingFixture } from './fixtures';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(`${process.cwd()}/package.json`)('openai') };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('owned private source elicitation and semantic feedback', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('private_speaking');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    identity = await instance.reset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  it('independently reviews the exact private intent, grades original speech and publishes zero canonical observations', async () => {
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Private speaking fixture' },
      update: {},
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'en',
        targetLang: 'de',
        startLevel: 'A2',
        currentLevel: 'A2',
      },
    });
    const { selection, assessment } = privateSpeakingFixture(identity.ownerId, course.id);
    const schemas: string[] = [];
    const failures: string[] = [];
    let reviewValid = true;
    const server = createServer(async (request, response) => {
      try {
        let bytes = '';
        for await (const part of request) bytes += part.toString();
        const payload = JSON.parse(bytes) as {
          messages: { role: string; content: string }[];
          response_format: { json_schema: { name: string } };
        };
        const schema = payload.response_format.json_schema.name;
        schemas.push(schema);
        const data = JSON.parse(payload.messages.at(-1)!.content);
        let output: unknown;
        if (schema === 'private_source_speaking_tasks') {
          expect(data.objective).toContain('specific future change with werden');
          expect(data.context).toContain('source heading: changes in plans');
          output = {
            prompts: Array.from({ length: 4 }, (_, index) => ({
              task: `${assessment.task.kind === 'COMMUNICATIVE_SPEAKING' ? assessment.task.task : ''} Scenario ${index + 1}.`,
              guidance: 'Respond independently in German. Explain your changed plan and a reason.',
              rubric: assessment.rubric,
            })),
          };
        } else if (schema === 'private_source_speaking_review') {
          expect(data.intent.objective).toContain('specific future change with werden');
          output = {
            reviews: data.prompts.map(
              (prompt: { task: string; rubric: string }, index: number) => ({
                index,
                valid: reviewValid,
                elicitationQuote: 'Use werden to explain the change.',
                rubricQuote: prompt.rubric,
                sourceQuote: 'specific future change with werden',
                rationale:
                  'The independent task and rubric require the exact private grammar function and communicative goal.',
              })
            ),
          };
        } else if (schema === 'qualified_productive_criterion_finding') {
          expect(data.criterion.assessment).toEqual(assessment.rubric);
          expect(data.criterion).not.toHaveProperty('objectiveId');
          output = {
            finding: {
              schemaVersion: 1,
              taskFingerprint: data.taskFingerprint,
              responseSha256: data.responseSha256,
              assessed: true,
              quality: 0.7,
              quotes: ['werde im Mai umziehen'],
              rationale:
                'The learner independently describes the concrete change using the requested function.',
            },
            feedback: 'Add another relevant detail about the new plan.',
          };
        } else throw new Error(`Unexpected private speaking provider schema ${schema}`);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'synthetic-private',
            object: 'chat.completion',
            model: 'synthetic-private-model',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: JSON.stringify(output) },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          })
        );
      } catch (error) {
        failures.push(String(error));
        response.writeHead(500);
        response.end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local provider port.');
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === '127.0.0.1' && url.port === String(address.port))
        return originalFetch(input, init);
      throw new Error('External private speaking provider dispatch is prohibited.');
    });
    try {
      await instance.configureInfrastructure({
        ...(await getServerInfra()),
        aiProvider: 'local',
        aiModel: 'local:synthetic-private',
        aiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      });
      await instance.database.user.update({
        where: { id: identity.ownerId },
        data: { preferredAiProvider: 'local', preferredAiModel: 'local:synthetic-private' },
      });
      const execution = {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      };
      const input = {
        courseId: course.id,
        userId: identity.ownerId,
        execution,
        requirements: createSkillRequirements({
          scope: 'SPEAKING',
          nativeLang: 'en',
          targetLang: 'de',
          level: 'A2',
          ttsProvider: 'local',
          sttProvider: 'local',
        }),
        learningSelection: selection,
        objective: 'Practise the specific future change with werden.',
        context: 'Private source heading: changes in plans.',
        count: 4,
      };
      const prompts = await composePrivateSourceSpeaking(input);
      expect(prompts).toHaveLength(4);
      expect(
        prompts.every(
          (prompt) => prompt.referenceTtsAudio === null && prompt.taskMode === 'COMMUNICATIVE'
        )
      ).toBe(true);
      expect(JSON.stringify(prompts)).not.toMatch(/objectiveId|detailsBase64|sourceContext/);
      const text = 'Ich werde im Mai umziehen, weil ich dort arbeite.';
      const feedback = await gradePrivateSourceSpeaking({
        userId: identity.ownerId,
        execution,
        assessment: prompts[0]!.learningObjectives,
        text,
      });
      expect(feedback.finding.quality).toBe(0.7);
      expect(feedback.feedback).toContain('relevant detail');
      await sottoTransaction(instance.database, (database) =>
        recordPracticeAssessmentObservations(database, {
          courseId: course.id,
          userId: identity.ownerId,
          sessionId: 'private-independent',
          episodeId: null,
          items: [],
          answers: [],
          writingPrompts: [],
          prompts: prompts.map((prompt, index) => ({
            id: `p${index}`,
            ...prompt,
            recordings: [
              {
                attempt: 1,
                status: 'SCORED',
                transcript: text,
                objectiveEvidence: feedback.finding,
              },
            ],
          })),
        })
      );
      expect(
        await instance.database.learningObservation.count({ where: { courseId: course.id } })
      ).toBe(0);
      const before = schemas.length;
      await expect(composePrivateSourceSpeaking({ ...input, userId: 'foreign' })).rejects.toThrow(
        'owned course'
      );
      expect(schemas).toHaveLength(before);
      reviewValid = false;
      await expect(composePrivateSourceSpeaking(input)).rejects.toThrow('review did not support');
      expect(failures).toEqual([]);
      expect(schemas).toEqual([
        'private_source_speaking_tasks',
        'private_source_speaking_review',
        'qualified_productive_criterion_finding',
        'private_source_speaking_tasks',
        'private_source_speaking_review',
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
