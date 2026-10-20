import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { it, expect } from 'vitest';
import type { MaterialAnalysis } from '@/generated/prisma/client';
import { processMaterialAnalysis } from '@/lib/course-materials/analysis/processing';
import { settleFailedAnalysisJob } from '@/lib/course-materials/jobs/analysis-failure';
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
  admitted: () => Promise<{ analysisId: string }>;
  delivered: (id: string) => Promise<Job<unknown>>;
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
  saved: (id: string) => Promise<MaterialAnalysis>;
  requests: readonly unknown[];
  setMode: (mode: 'COMPLETE' | 'INVALID' | 'UNKNOWN') => void;
}
const receiptSchema = z.object({ analysisId: z.uuid(), status: z.string() });
export function registerMaterialRetryAliasCase(getFixture: () => Fixture) {
  it('requires exact parent executor drain and admits only one concurrent explicit retry', async () => {
    const { instance, admitted, delivered, retryInput, retryRequest, saved, requests } =
      getFixture();
    const receipt = await admitted();
    await delivered(receipt.analysisId);
    const parentId = durableQueueOperationId(
      'material-analysis',
      `material-analysis-${receipt.analysisId}-1`
    );
    const operation = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(parentId)
    );
    if (!operation) throw new Error('Missing exact original operation.');
    const lease = {
      id: randomUUID(),
      parentId,
      fingerprint: operation.fingerprint,
      executorId: randomUUID(),
    };
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).begin(lease)
    );
    await sottoTransaction(instance.database, async (database) => {
      await database.materialAnalysis.update({
        where: { id: receipt.analysisId },
        data: { status: 'FAILED' },
      });
      await sottoJobOutbox(database).complete(parentId, operation.fingerprint);
    });
    expect(
      (await retryRequest(receipt.analysisId, await retryInput(receipt.analysisId))).status
    ).toBe(409);
    expect(await instance.database.materialAnalysis.count()).toBe(1);
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).settle(lease)
    );
    const [left, right] = await Promise.all([
      retryRequest(receipt.analysisId, await retryInput(receipt.analysisId)),
      retryRequest(receipt.analysisId, await retryInput(receipt.analysisId)),
    ]);
    expect([left.status, right.status]).toEqual([202, 202]);
    const child = receiptSchema.parse(await (left.status === 202 ? left : right).json());
    getFixture().setMode('COMPLETE');
    await processMaterialAnalysis(await delivered(child.analysisId));
    expect((await saved(child.analysisId)).status).toBe('COMPLETE');
    expect(requests).toHaveLength(1);
    expect(await instance.database.materialAnalysis.count()).toBe(2);
  });

  it('reopens an unknown child with new request aliases while preserving observed parent and owned-source fences', async () => {
    const fixture = getFixture();
    const { instance, identity, admitted, delivered, retryInput, retryRequest, saved, requests } =
      fixture;
    fixture.setMode('INVALID');
    const parentReceipt = await admitted();
    await processMaterialAnalysis(await delivered(parentReceipt.analysisId));
    const original = await saved(parentReceipt.analysisId);
    const body = await retryInput(original.id);
    const first = await retryRequest(original.id, body);
    expect(first.status).toBe(202);
    const child = receiptSchema.parse(await first.json());
    fixture.setMode('UNKNOWN');
    const job = await delivered(child.analysisId);
    await expect(processMaterialAnalysis(job)).rejects.toThrow('unknown outcome');
    await sottoTransaction(instance.database, (database) =>
      settleFailedAnalysisJob(database, job, 'material-analysis')
    );
    expect((await saved(child.analysisId)).status).toBe('RECOVERY_REQUIRED');
    const units = await instance.database.materialAnalysisUnit.count();
    const lostCheckpoint = { ...body, requestId: randomUUID() };
    const reopened = await retryRequest(original.id, lostCheckpoint);
    expect(reopened.status).toBe(200);
    expect(receiptSchema.parse(await reopened.json())).toEqual({
      analysisId: child.analysisId,
      status: 'RECOVERY_REQUIRED',
    });
    expect((await retryRequest(original.id, lostCheckpoint)).status).toBe(200);
    expect(
      (
        await retryRequest(original.id, {
          ...lostCheckpoint,
          requestId: randomUUID(),
          analysisRevision: body.analysisRevision + 1,
        })
      ).status
    ).toBe(409);
    const foreign = await identity.household('Foreign retry alias owner');
    expect(
      (await retryRequest(original.id, { ...body, requestId: randomUUID() }, foreign.token)).status
    ).toBe(404);
    expect(await instance.database.materialAnalysis.count()).toBe(2);
    expect(await instance.database.materialAnalysisUnit.count()).toBe(units);
    expect(requests).toHaveLength(2);
    expect(await saved(original.id)).toEqual(original);
    await instance.database.course.update({
      where: { id: original.intendedCourseId! },
      data: { targetLang: 'fr' },
    });
    expect((await retryRequest(original.id, lostCheckpoint)).status).toBe(409);
    expect((await retryRequest(original.id, { ...body, requestId: randomUUID() })).status).toBe(
      409
    );
    expect(requests).toHaveLength(2);
  });
}
