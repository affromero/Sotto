// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  admitDurableQueueBatch,
  durableEnvelopeSchema,
  durableQueueOperationId,
  validateDurableAuthority,
  type DurableAuthority,
} from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/sidedoor/jobs/core/job-delivery', async (original) => ({
  ...(await original<typeof import('@/lib/sidedoor/jobs/core/job-delivery')>()),
  deliverSottoJob: async () => undefined,
}));

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const digest = 'a'.repeat(64);
const replacementDigest = 'b'.repeat(64);
// Delivery is the system boundary. Admission and its persistent outbox are real.
const queue = { name: 'material-finalization' } as Queue;

suite('durable material ownership and publication', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;

  beforeAll(async () => {
    instance = await createSharedTestInstance('material_authority');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  async function material(published = true) {
    return instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        name: 'Private source.pdf',
        mimeType: 'application/pdf',
        byteSize: 42,
        extractedText: '',
        originalUrl: published ? 'materials/private/original.pdf' : null,
        originalSha256: published ? digest : null,
        processingStatus: published ? 'QUEUED' : 'AWAITING_UPLOAD',
      },
    });
  }

  async function finalizer() {
    const original = await material(false);
    const jobId = randomUUID();
    const operationId = durableQueueOperationId(queue.name, jobId);
    const batch = await instance.database.materialUploadBatch.create({
      data: {
        userId: identity.ownerId,
        requestId: randomUUID(),
        fingerprint: 'c'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const upload = await instance.database.materialUpload.create({
      data: {
        batchId: batch.id,
        materialId: original.id,
        clientId: randomUUID(),
        expectedSha256: digest,
        status: 'FINALIZING',
        finalizationOperationId: operationId,
        expiresAt: batch.expiresAt,
      },
    });
    const payload = {
      materialId: original.id,
      userId: identity.ownerId,
      processingRevision: original.processingRevision,
      uploadId: upload.id,
    };
    return { original, batch, upload, jobId, operationId, payload };
  }

  async function admit(payload: Record<string, unknown>, jobId = randomUUID()) {
    await admitDurableQueueBatch({
      authorize: async () => ({ userId: identity.ownerId }),
      prepare: async () => [{ queue, type: 'material-fixture', payload, jobId }],
    });
    const record = await sottoTransaction(instance.database, (tx) =>
      sottoJobOutbox(tx).read(durableQueueOperationId(queue.name, jobId))
    );
    if (!record) throw new Error('Material admission receipt is missing');
    return {
      record,
      authority: durableEnvelopeSchema.parse(record.job.payload).authority,
    };
  }

  const validate = (authority: DurableAuthority) =>
    sottoTransaction(instance.database, (tx) => validateDurableAuthority(tx, authority));

  it('binds original work to the material, owner, digest and processing generation', async () => {
    const original = await material();
    const { authority, record } = await admit({
      materialId: original.id,
      userId: identity.ownerId,
      processingRevision: original.processingRevision,
      inputSha256: digest,
    });
    expect(authority).toMatchObject({
      kind: 'material',
      materialId: original.id,
      userId: identity.ownerId,
      materialCreatedAt: original.createdAt.getTime(),
      processingRevision: original.processingRevision,
      inputSha256: digest,
      upload: null,
    });
    expect(record.job.scopes).toContainEqual({
      subjectId: `material:${original.id}`,
      generation: original.createdAt.getTime(),
    });
    await expect(validate(authority)).resolves.toEqual({
      userId: identity.ownerId,
    });
  });

  it('rejects another learner as the recipient of an owned material', async () => {
    const original = await material();
    const other = await identity.household('Other learner');
    await expect(
      admit({
        materialId: original.id,
        userId: other.id,
        processingRevision: original.processingRevision,
        inputSha256: digest,
      })
    ).rejects.toThrow('Durable material owner changed');
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete(null)))
        .jobs
    ).toEqual([]);
  });

  it.each([
    { inputSha256: replacementDigest, processingRevision: 1 },
    { inputSha256: digest, processingRevision: 2 },
    { inputSha256: 'invalid', processingRevision: 1 },
  ])('rejects material work whose captured input differs: %j', async (selection) => {
    const original = await material();
    await expect(admit({ materialId: original.id, ...selection })).rejects.toThrow();
  });

  it('requires an original digest outside the admitted upload finalizer', async () => {
    const original = await material();
    await expect(
      admit({
        materialId: original.id,
        processingRevision: original.processingRevision,
      })
    ).rejects.toThrow('requires a bound original or its finalizer');
  });

  it('rejects a malformed recipient even when an earlier child captured the same material', async () => {
    const original = await material();
    const payload = {
      materialId: original.id,
      processingRevision: original.processingRevision,
      inputSha256: digest,
    };
    await expect(
      admitDurableQueueBatch({
        authorize: async () => ({ userId: identity.ownerId }),
        prepare: async () => [
          { queue, type: 'material-fixture', payload, jobId: randomUUID() },
          {
            queue,
            type: 'material-fixture',
            payload: { ...payload, userId: null },
            jobId: randomUUID(),
          },
        ],
      })
    ).rejects.toThrow();
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete(null)))
        .jobs
    ).toEqual([]);
  });

  it('rejects processing an unpublished original even if its requested digest is known', async () => {
    const original = await material(false);
    await expect(
      admit({
        materialId: original.id,
        processingRevision: original.processingRevision,
        inputSha256: digest,
      })
    ).rejects.toThrow('Durable material original changed');
  });

  it('retains finalizer authority through publication, revision changes and transfer expiry', async () => {
    const fixture = await finalizer();
    const { authority, record } = await admit(fixture.payload, fixture.jobId);
    expect(authority).toMatchObject({
      kind: 'material',
      inputSha256: null,
      upload: {
        id: fixture.upload.id,
        finalizationOperationId: fixture.operationId,
      },
    });
    expect(record.job.scopes).toContainEqual({
      subjectId: `material-upload:${fixture.upload.id}`,
      generation: fixture.upload.createdAt.getTime(),
    });
    await instance.database.$transaction([
      instance.database.courseMaterial.update({
        where: { id: fixture.original.id },
        data: {
          originalUrl: 'materials/private/original.pdf',
          originalSha256: digest,
          processingStatus: 'QUEUED',
        },
      }),
      instance.database.materialUpload.update({
        where: { id: fixture.upload.id },
        data: {
          status: 'COMPLETE',
          revision: { increment: 1 },
          completedAt: new Date(),
          expiresAt: new Date(Date.now() - 60_000),
        },
      }),
    ]);
    await expect(validate(authority)).resolves.toEqual({
      userId: identity.ownerId,
    });
    const replay = await admit(fixture.payload, fixture.jobId);
    expect(replay.record.fingerprint).toBe(record.fingerprint);
  });

  it('rejects finalization through a different durable operation', async () => {
    const fixture = await finalizer();
    await expect(admit(fixture.payload)).rejects.toThrow(
      'requires a bound original or its finalizer'
    );
  });

  it.each(['CANCELLED', 'EXPIRED', 'FAILED', 'UPLOADING'])(
    'revokes finalizer authority when the upload becomes %s',
    async (status) => {
      const fixture = await finalizer();
      const { authority } = await admit(fixture.payload, fixture.jobId);
      await instance.database.materialUpload.update({
        where: { id: fixture.upload.id },
        data: { status },
      });
      await expect(validate(authority)).rejects.toThrow('Durable material upload changed');
    }
  );

  it('rejects an upload that is rebound to another finalizer', async () => {
    const fixture = await finalizer();
    const { authority } = await admit(fixture.payload, fixture.jobId);
    await instance.database.materialUpload.update({
      where: { id: fixture.upload.id },
      data: { finalizationOperationId: randomUUID() },
    });
    await expect(validate(authority)).rejects.toThrow('Durable material upload changed');
  });

  it('rejects changing the checksum promised by an admitted finalizer', async () => {
    const fixture = await finalizer();
    const { authority } = await admit(fixture.payload, fixture.jobId);
    await instance.database.materialUpload.update({
      where: { id: fixture.upload.id },
      data: { expectedSha256: replacementDigest },
    });
    await expect(validate(authority)).rejects.toThrow('Durable material upload changed');
  });

  it('rejects borrowing an upload from a different material', async () => {
    const fixture = await finalizer();
    const other = await material();
    await expect(
      admit({
        materialId: other.id,
        processingRevision: other.processingRevision,
        inputSha256: digest,
        uploadId: fixture.upload.id,
      })
    ).rejects.toThrow('Durable material upload changed');
  });

  it('rejects upload ownership changes even when the material owner stays the same', async () => {
    const fixture = await finalizer();
    const { authority } = await admit(fixture.payload, fixture.jobId);
    const other = await identity.household('Other learner');
    await instance.database.materialUploadBatch.update({
      where: { id: fixture.batch.id },
      data: { userId: other.id },
    });
    await expect(validate(authority)).rejects.toThrow('Durable material upload changed');
  });

  it.each([
    { originalUrl: null, originalSha256: digest },
    { originalUrl: 'materials/private/original.pdf', originalSha256: null },
    {
      originalUrl: 'materials/private/original.pdf',
      originalSha256: replacementDigest,
    },
  ])('rejects an incomplete or wrong original publication: %j', async (publication) => {
    const fixture = await finalizer();
    const { authority } = await admit(fixture.payload, fixture.jobId);
    await instance.database.$transaction([
      instance.database.courseMaterial.update({
        where: { id: fixture.original.id },
        data: publication,
      }),
      instance.database.materialUpload.update({
        where: { id: fixture.upload.id },
        data: { status: 'COMPLETE', completedAt: new Date() },
      }),
    ]);
    await expect(validate(authority)).rejects.toThrow('publication is incomplete');
  });

  it.each(['original', 'processing revision', 'creation generation', 'owner', 'deletion'])(
    'revokes existing processing authority after material %s changes',
    async (change) => {
      const original = await material();
      const { authority } = await admit({
        materialId: original.id,
        processingRevision: original.processingRevision,
        inputSha256: digest,
      });
      if (change === 'deletion') {
        await instance.database.courseMaterial.delete({
          where: { id: original.id },
        });
      } else {
        const other = change === 'owner' ? await identity.household('Other learner') : null;
        await instance.database.courseMaterial.update({
          where: { id: original.id },
          data: {
            ...(change === 'original' ? { originalSha256: replacementDigest } : {}),
            ...(change === 'processing revision' ? { processingRevision: { increment: 1 } } : {}),
            ...(change === 'creation generation'
              ? { createdAt: new Date(original.createdAt.getTime() + 1) }
              : {}),
            ...(other ? { userId: other.id } : {}),
          },
        });
      }
      await expect(validate(authority)).rejects.toThrow('Durable material');
    }
  );

  it('validates complete captured scope identity rather than only the instance ID', async () => {
    const original = await material();
    const { authority } = await admit({
      materialId: original.id,
      processingRevision: original.processingRevision,
      inputSha256: digest,
    });
    if (authority.kind !== 'material') throw new Error('Expected material authority');
    await expect(
      validate({
        ...authority,
        scopes: authority.scopes.map((scope) => ({
          ...scope,
          generation: scope.generation + 1,
        })),
      })
    ).rejects.toThrow('Durable material storage scopes changed');
  });

  it('keeps legacy profile, instance and episode envelope shapes readable', () => {
    const envelopes = [
      {
        kind: 'profile',
        userId: 'legacy-profile',
        createdAt: 1,
        instanceId: randomUUID(),
      },
      { kind: 'instance', instanceId: randomUUID() },
      {
        kind: 'episode',
        episodeId: 'legacy-episode',
        ownerUserId: 'legacy-profile',
        userId: 'legacy-profile',
        pipelineGeneration: null,
        snapshot: {},
      },
    ];
    for (const authority of envelopes)
      expect(
        durableEnvelopeSchema.safeParse({
          type: 'legacy',
          payload: {},
          authority,
        }).success
      ).toBe(true);
  });
});
