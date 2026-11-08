// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import type { PrismaClient } from '@/generated/prisma/client';
import { prerequisiteProviderBudget } from '@/lib/classes/help/content/prerequisite-directions';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { createAIProvider } from '@/lib/providers/ai';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/redis', () => ({
  cache: { get: async () => null, set: async () => undefined },
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: async () => undefined }));

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('prerequisite provider budget', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('prerequisite_budget');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  it.each([
    { providerId: 'openai', retry: false },
    { providerId: 'openai', retry: true },
    { providerId: 'anthropic', retry: false },
    { providerId: 'anthropic', retry: true },
  ] as const)(
    'accounts for $providerId moderation and model retry: $retry',
    async ({ providerId, retry }) => {
      const curriculum = await instance.database.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
        create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
        update: {},
      });
      const course = await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'es',
          targetLang: 'ru',
        },
      });
      const operation = { id: randomUUID(), courseId: course.id, userId: identity.ownerId };
      const binding = await sottoTransaction(instance.database, async (database) => {
        const ownership = await captureCourseStorage(database, course.id);
        const subject = ownership.scopes.find(
          (scope) => scope.subjectId === `profile:${identity.ownerId}`
        )!;
        const resource = ownership.scopes.find(
          (scope) => scope.subjectId === `course:${course.id}`
        )!;
        const spec = {
          id: operation.id,
          revision: randomUUID(),
          instanceId: ownership.instanceId,
          subject: { id: subject.subjectId, generation: subject.generation },
          resource: { id: resource.subjectId, generation: resource.generation },
          operationId: operation.id,
          action: 'prerequisite-parent-provider-request',
          expiresAt: Date.now() + 60_000,
          maxRequests: prerequisiteProviderBudget(3),
        };
        const grant = learningPreparationGrant(database, operation, 'prerequisite');
        await grant.create(spec);
        const captured = delegationGrantBinding(spec);
        await grant.admit(captured, { id: randomUUID(), fingerprint: 'a'.repeat(64) });
        return captured;
      });
      const request = learningPreparationProviderRequest(
        {
          selection: { provider: providerId, model: 'fixture' },
          admit: (database, attempt) =>
            learningPreparationGrant(database, operation, 'prerequisite').admit(binding, attempt),
          settle: (database, attempt, outcome) =>
            learningPreparationGrant(database, operation, 'prerequisite').settle(
              binding,
              attempt,
              outcome
            ),
        },
        new AbortController().signal,
        () => {
          throw new Error('Unexpected unknown provider outcome');
        }
      );
      let failOnce = retry;
      const guardedFetch: typeof fetch = async (input, init) => {
        const captured = new Request(input, init);
        return request(captured, async () => {
          if (captured.url.endsWith('/moderations'))
            return Response.json({
              results: [{ categories: {}, category_scores: {}, flagged: false }],
            });
          if (failOnce) {
            failOnce = false;
            return Response.json({ error: { message: 'Rate limited' } }, { status: 429 });
          }
          if (providerId === 'anthropic')
            return Response.json({
              id: 'fixture',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: '{}' }],
              model: 'claude-sonnet-4-6',
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            });
          return Response.json({
            id: 'fixture',
            choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          });
        });
      };
      const provider = createAIProvider(providerId);
      for (let index = 0; index < 8; index++) {
        await provider.generateResponse(
          'Explain directions.',
          [{ role: 'user', content: `Task ${index}` }],
          {
            apiKeyOverride: 'test-key',
            model: providerId === 'anthropic' ? 'claude-sonnet-4-6' : 'fixture-model',
            fetch: guardedFetch,
            moderation: { fetch: guardedFetch },
          }
        );
      }
      const grant = await sottoTransaction(instance.database, (database) =>
        learningPreparationGrant(database, operation, 'prerequisite').read(binding)
      );
      const successes = providerId === 'anthropic' ? 24 : 16;
      expect(grant.attempts).toHaveLength(1 + successes + Number(retry));
      expect(grant.attempts.filter((attempt) => attempt.outcome === 'succeeded')).toHaveLength(
        successes
      );
      expect(grant.attempts.filter((attempt) => attempt.outcome === 'failed')).toHaveLength(
        retry ? 1 : 0
      );
      expect(prerequisiteProviderBudget(3) - grant.attempts.length).toBe(
        28 - successes - Number(retry)
      );
    }
  );
});
