// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  resolveSottoRequest,
  requireOriginalSottoAdmission,
} from '@/lib/sidedoor/access/core/request-identity';
import { requestPracticePreparation, practicePreparationGrant } from '@/lib/practice/preparation';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../helpers/setup/shared-instance';
const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Bounded preparation response receipts', () => {
  let instance: SharedTestInstance;
  let directory: string;
  let execution: SottoProviderExecution;
  let courseId: string;
  beforeAll(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    directory = await mkdtemp(join(tmpdir(), 'sotto-preparation-receipt-'));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    instance = await createSharedTestInstance('preparation_receipt');
    boundary.database = instance.database;
    const identity = await instance.reset();
    await instance.seedAiCredential(identity.ownerId, 'openai', 'private-receipt-fixture-key');
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: {
        preferredAiProvider: 'openai',
        preferredAiModel: getAiProviderMeta('openai').defaultModel,
      },
    });
    const curriculum = await instance.database.curriculum.create({
      data: { nativeLang: 'en', targetLang: 'de', title: 'Receipt fixture' },
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          nativeLang: 'en',
          targetLang: 'de',
          curriculumId: curriculum.id,
        },
      })
    ).id;
    const request = new Request('http://localhost', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const original = await sottoTransaction(instance.database, (database) =>
      resolveSottoRequest(database, request)
    );
    if (!original || original.kind !== 'content') throw new Error('Missing owned fixture');
    execution = {
      userId: original.userId,
      signal: request.signal,
      authorize: async (database) => {
        await requireOriginalSottoAdmission(database, request, original);
        return { userId: original.userId };
      },
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  it('captures an opted-in bounded response with its successful preparation grant receipt', async () => {
    const operation = await requestPracticePreparation(courseId, 'FULL', execution);
    const responses: string[] = [];
    const request = learningPreparationProviderRequest(
      {
        selection: operation.selection,
        responseReceipt: { maxBytes: 1024 },
        admit: (database, attempt) =>
          practicePreparationGrant(database, operation).admit(operation.grant, attempt),
        settle: async (database, attempt, outcome, receipt) => {
          if (receipt) responses.push(Buffer.from(receipt.bodyBase64, 'base64').toString('utf8'));
          return practicePreparationGrant(database, operation).settle(
            operation.grant,
            attempt,
            outcome
          );
        },
      },
      new AbortController().signal,
      () => {
        throw new Error('The known response must settle.');
      }
    );
    const response = await request(
      new Request('https://provider.test/recognition', { method: 'POST', body: '{}' }),
      async () => new Response('Exact response é 😀', { headers: { 'Content-Type': 'text/plain' } })
    );
    expect(await response.text()).toBe('Exact response é 😀');
    expect(responses).toEqual(['Exact response é 😀']);
    const grant = await sottoTransaction(instance.database, (database) =>
      practicePreparationGrant(database, operation).read(operation.grant)
    );
    expect(grant.attempts.map((attempt) => attempt.outcome)).toEqual(['succeeded']);
  });
});
