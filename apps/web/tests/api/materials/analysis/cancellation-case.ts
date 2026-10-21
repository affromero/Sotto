import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import type { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { materialAnalysisCancellationResponseSchema } from '@sotto/shared';
import type {
  CourseMaterial,
  MaterialAnalysis,
  MaterialExtractionRun,
} from '@/generated/prisma/client';
import { POST as cancel } from '@/app/api/v1/material-analyses/[analysisId]/cancellation/route';
import { POST as analyze } from '@/app/api/v1/courses/[courseId]/material-analyses/route';
import { processMaterialAnalysis } from '@/lib/course-materials/analysis/processing';
import { settleFailedAnalysisJob } from '@/lib/course-materials/jobs/analysis-failure';
import { createWorker } from '@/lib/queue';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

interface Fixture {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  admitted: (value?: unknown) => Promise<{ analysisId: string }>;
  input: (content?: string) => Record<string, unknown>;
  delivered: (id: string) => Promise<Job<unknown>>;
  request: (path: string, body?: unknown, token?: string, origin?: string) => NextRequest;
  saved: (id: string) => Promise<MaterialAnalysis>;
  retryInput: (
    id: string,
    requestId?: ReturnType<typeof randomUUID>
  ) => Promise<{
    schemaVersion: number;
    requestId: string;
    analysisRevision: number;
    identityDigest: string | null;
    resultDigest: string | null;
  }>;
  retryRequest: (id: string, body: unknown, token?: string) => Promise<Response>;
  requests: readonly unknown[];
  projection: (id: string) => Promise<Response>;
  materialFixture: (
    texts?: string[]
  ) => Promise<{ material: CourseMaterial; run: MaterialExtractionRun }>;
  holdProvider: (pageNumber?: number) => { entered: Promise<void>; release: () => void };
  setMode: (value: 'COMPLETE' | 'INVALID' | 'UNKNOWN') => void;
}
const operationId = (id: string) =>
  durableQueueOperationId('material-analysis', `material-analysis-${id}-1`);
async function cancellation(
  fixture: Fixture,
  id: string,
  body: unknown,
  token?: string,
  origin?: string
) {
  return cancel(fixture.request(`material-analyses/${id}/cancellation`, body, token, origin), {
    params: Promise.resolve({ analysisId: id }),
  });
}
async function read(response: Response) {
  return materialAnalysisCancellationResponseSchema.parse(await response.json());
}
export function registerMaterialCancellationCases(getFixture: () => Fixture) {
  it('cancels before delivery without dispatch and rejects foreign or changed cancellation receipts', async () => {
    const fixture = getFixture();
    const receipt = await fixture.admitted();
    const body = await fixture.retryInput(receipt.analysisId);
    const foreign = await fixture.identity.household('Foreign cancellation learner');
    expect((await cancellation(fixture, receipt.analysisId, body, foreign.token)).status).toBe(404);
    expect(
      (await cancellation(fixture, receipt.analysisId, body, undefined, 'https://foreign.example'))
        .status
    ).toBe(403);
    expect(
      (await cancellation(fixture, receipt.analysisId, { ...body, analysisRevision: 2 })).status
    ).toBe(409);
    const result = await cancellation(fixture, receipt.analysisId, body);
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect((await read(result)).cancellation).toMatchObject({
      state: 'CANCELLED',
      remainingUnits: 0,
      hasMore: false,
      blockers: [],
    });
    expect((await cancellation(fixture, receipt.analysisId, body)).status).toBe(200);
    const operation = await sottoTransaction(fixture.instance.database, (database) =>
      sottoJobOutbox(database).read(operationId(receipt.analysisId))
    );
    expect(operation?.complete).toBe(true);
    expect(
      await fixture.instance.database.materialAnalysisSource.count({
        where: { analysisId: receipt.analysisId },
      })
    ).toBe(1);
    expect(fixture.requests).toHaveLength(0);
    const waiting = await fixture.admitted(fixture.input('Another owned pending source.'));
    const queued = await fixture.delivered(waiting.analysisId);
    expect(
      (
        await cancellation(
          fixture,
          waiting.analysisId,
          await fixture.retryInput(waiting.analysisId)
        )
      ).status
    ).toBe(200);
    await expect(processMaterialAnalysis(queued)).resolves.toBeUndefined();
    expect(fixture.requests).toHaveLength(0);
  });

  it('lets an admitted response settle and stops later chunks without discarding its successful receipt', async () => {
    const fixture = getFixture();
    const receipt = await fixture.admitted(
      fixture.input('Passiv Präsens: Das Essen wird gekocht. '.repeat(500))
    );
    const job = await fixture.delivered(receipt.analysisId);
    const hold = fixture.holdProvider();
    const running = processMaterialAnalysis(job);
    try {
      await hold.entered;
      const body = await fixture.retryInput(receipt.analysisId);
      const pending = await read(await cancellation(fixture, receipt.analysisId, body));
      expect(pending.status).toBe('CANCELLING');
      expect(pending.cancellation.blockers).toContain('PROVIDER_ADMITTED');
      expect(pending.cancellation.blockers).toContain('EXECUTOR_ACTIVE');
      expect(pending.cancellation.hasMore).toBe(false);
      hold.release();
      await running;
      const saved = await fixture.saved(receipt.analysisId);
      expect(saved.status).toBe('CANCELLED');
      expect(saved.resultBytes).toBeNull();
      const units = await fixture.instance.database.materialAnalysisUnit.findMany({
        where: { analysisId: receipt.analysisId },
      });
      expect(units).toHaveLength(1);
      expect(units[0].status).toBe('SUCCEEDED');
      expect(units[0].responseBytes?.length).toBeGreaterThan(0);
      expect(units[0].cancellationVerifiedAt).toBeInstanceOf(Date);
      expect(fixture.requests).toHaveLength(1);
      expect(await fixture.instance.database.learningObservation.count()).toBe(0);
      const before = await fixture.instance.database.materialAnalysisUnit.findMany({
        where: { analysisId: receipt.analysisId },
      });
      expect(
        (await read(await cancellation(fixture, receipt.analysisId, body))).cancellation.state
      ).toBe('CANCELLED');
      expect(
        await fixture.instance.database.materialAnalysisUnit.findMany({
          where: { analysisId: receipt.analysisId },
        })
      ).toEqual(before);
    } finally {
      hold.release();
      await running;
    }
  });

  it('keeps unknown provider outcomes fenced through cancellation, reconciliation and explicit retry', async () => {
    const fixture = getFixture();
    fixture.setMode('UNKNOWN');
    const receipt = await fixture.admitted();
    const job = await fixture.delivered(receipt.analysisId);
    await expect(processMaterialAnalysis(job)).rejects.toThrow('unknown outcome');
    const unit = await fixture.instance.database.materialAnalysisUnit.findFirstOrThrow({
      where: { analysisId: receipt.analysisId },
    });
    const body = await fixture.retryInput(receipt.analysisId);
    const pending = await read(await cancellation(fixture, receipt.analysisId, body));
    expect(pending.cancellation).toMatchObject({
      state: 'PENDING',
      hasMore: false,
      operatorRecoveryUrl: null,
    });
    expect(pending.cancellation.blockers).toContain('PROVIDER_UNKNOWN');
    await sottoTransaction(fixture.instance.database, (database) =>
      settleFailedAnalysisJob(database, job, 'material-analysis')
    );
    expect((await fixture.saved(receipt.analysisId)).status).toBe('CANCELLING');
    const courseId = (await fixture.saved(receipt.analysisId)).intendedCourseId!;
    expect(
      (
        await analyze(fixture.request(`courses/${courseId}/material-analyses`, fixture.input()), {
          params: Promise.resolve({ courseId }),
        })
      ).status
    ).toBe(409);
    expect(
      (await cancellation(fixture, receipt.analysisId, { ...body, requestId: randomUUID() })).status
    ).toBe(202);
    expect(
      (await fixture.retryRequest(receipt.analysisId, await fixture.retryInput(receipt.analysisId)))
        .status
    ).toBe(409);
    expect(
      await fixture.instance.database.materialAnalysisUnit.findUniqueOrThrow({
        where: { id: unit.id },
      })
    ).toEqual(unit);
    expect(await fixture.instance.database.materialAnalysis.count()).toBe(1);
    expect(fixture.requests).toHaveLength(1);
  });

  it('requires exact executor cleanup proof before completing a cancellation with no provider call', async () => {
    const fixture = getFixture();
    const receipt = await fixture.admitted();
    await fixture.delivered(receipt.analysisId);
    const parentId = operationId(receipt.analysisId);
    const operation = await sottoTransaction(fixture.instance.database, (database) =>
      sottoJobOutbox(database).read(parentId)
    );
    if (!operation) throw new Error('Missing exact cancellation operation.');
    const lease = {
      id: randomUUID(),
      parentId,
      fingerprint: operation.fingerprint,
      executorId: randomUUID(),
    };
    await sottoTransaction(fixture.instance.database, async (database) => {
      const journal = sottoJobExecutions(database);
      await journal.begin(lease);
      await journal.markCleanupUnconfirmed(lease);
    });
    const body = await fixture.retryInput(receipt.analysisId);
    const pending = await read(await cancellation(fixture, receipt.analysisId, body));
    expect(pending.cancellation).toMatchObject({
      state: 'PENDING',
      hasMore: false,
      blockers: ['CLEANUP_UNCONFIRMED'],
    });
    await sottoTransaction(fixture.instance.database, (database) =>
      sottoJobExecutions(database).settle(lease)
    );
    expect(
      (await read(await cancellation(fixture, receipt.analysisId, body))).cancellation.state
    ).toBe('CANCELLED');
    expect(fixture.requests).toHaveLength(0);
  });

  it('preserves immutable complete results when cancellation arrives after publication', async () => {
    const fixture = getFixture();
    const receipt = await fixture.admitted();
    await processMaterialAnalysis(await fixture.delivered(receipt.analysisId));
    const before = await fixture.saved(receipt.analysisId);
    const units = await fixture.instance.database.materialAnalysisUnit.findMany({
      where: { analysisId: receipt.analysisId },
    });
    const result = await read(
      await cancellation(fixture, receipt.analysisId, await fixture.retryInput(receipt.analysisId))
    );
    expect(result.cancellation.state).toBe('NOT_NEEDED');
    expect(await fixture.saved(receipt.analysisId)).toEqual(before);
    expect(
      await fixture.instance.database.materialAnalysisUnit.findMany({
        where: { analysisId: receipt.analysisId },
      })
    ).toEqual(units);
    expect(fixture.requests).toHaveLength(1);
  });

  it('pages known cancellation proof and consolidates saved successes offline through an explicit retry', async () => {
    const fixture = getFixture();
    const { material } = await fixture.materialFixture(
      Array.from(
        { length: 65 },
        (_, index) => `Passiv Präsens, page ${index + 1}: Das Essen wird gekocht.`
      )
    );
    const receipt = await fixture.admitted({ ...fixture.input(''), materialIds: [material.id] });
    await fixture.delivered(receipt.analysisId);
    const hold = fixture.holdProvider(65);
    const worker = createWorker('material-analysis', processMaterialAnalysis, { concurrency: 1 });
    try {
      await hold.entered;
      const body = await fixture.retryInput(receipt.analysisId);
      expect(
        (await read(await cancellation(fixture, receipt.analysisId, body))).cancellation.hasMore
      ).toBe(false);
      hold.release();
      await vi.waitFor(
        async () =>
          expect(
            await fixture.instance.database.materialAnalysisUnit.count({
              where: { analysisId: receipt.analysisId, cancellationVerifiedAt: { not: null } },
            })
          ).toBe(64),
        { timeout: 45000, interval: 100 }
      );
      expect((await fixture.saved(receipt.analysisId)).status).toBe('CANCELLING');
      const complete = await read(await cancellation(fixture, receipt.analysisId, body));
      expect(complete.cancellation).toMatchObject({
        state: 'CANCELLED',
        verifiedUnits: 65,
        remainingUnits: 0,
        hasMore: false,
      });
      const parent = await fixture.saved(receipt.analysisId);
      const retried = await fixture.retryRequest(
        receipt.analysisId,
        await fixture.retryInput(receipt.analysisId)
      );
      expect(retried.status).toBe(202);
      const child = await readAnalysisId(retried);
      const nativeUnits = await fixture.instance.database.materialAnalysisUnit.findMany({
        where: { analysisId: receipt.analysisId },
        orderBy: { id: 'asc' },
      });
      const childBody = await fixture.retryInput(child);
      const continuation = await read(await cancellation(fixture, child, childBody));
      expect(continuation.cancellation).toMatchObject({
        state: 'PENDING',
        verifiedUnits: 64,
        remainingUnits: 1,
        hasMore: true,
        blockers: ['VERIFICATION_PENDING'],
      });
      expect((await read(await cancellation(fixture, child, childBody))).cancellation.state).toBe(
        'CANCELLED'
      );
      expect(
        await fixture.instance.database.materialAnalysisUnit.findMany({
          where: { analysisId: receipt.analysisId },
          orderBy: { id: 'asc' },
        })
      ).toEqual(nativeUnits);
      const cancelledChild = await fixture.saved(child);
      const replay = await fixture.retryRequest(child, await fixture.retryInput(child));
      expect(replay.status).toBe(202);
      const grandchild = await readAnalysisId(replay);
      await fixture.delivered(grandchild);
      await vi.waitFor(
        async () => expect((await fixture.saved(grandchild)).status).toBe('PARTIAL'),
        {
          timeout: 45000,
          interval: 100,
        }
      );
      expect(await fixture.saved(receipt.analysisId)).toEqual(parent);
      expect(await fixture.saved(child)).toEqual(cancelledChild);
      expect(fixture.requests).toHaveLength(65);
      const inherited = await fixture.instance.database.materialAnalysisUnit.findMany({
        where: { analysisId: grandchild },
      });
      expect(inherited).toHaveLength(65);
      expect(
        inherited.every(
          (unit) => unit.grant === null && unit.reuse !== null && unit.attemptId === null
        )
      ).toBe(true);
    } finally {
      hold.release();
      await worker.close();
    }
  }, 120000);
}
async function readAnalysisId(response: Response) {
  const result = (await response.json()) as { analysisId: string };
  return result.analysisId;
}
