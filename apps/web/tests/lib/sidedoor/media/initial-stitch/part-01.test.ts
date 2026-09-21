// @vitest-environment node
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { createInitialStitchKey } from '@/lib/audio/stitch-identity';
import { invalidateServerInfra } from '@/lib/server-config';
import {
  requireOriginalSottoAdmission,
  resolveSottoRequest,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  admitInitialStitch,
  commitInitialStitch,
  prepareInitialStitch,
  prepareInitialStitchIdentities,
  requireInitialStitchAttempt,
  verifyCurrentInitialStitch,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import { completeInitialStitchFailure } from '@/lib/sidedoor/jobs/initial/initial-stitch-failure';
import {
  captureInitialStitchInputs,
  validateInitialStitchInputs,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-inputs';
import {
  readInitialStitchOutcome,
  writeInitialStitchOutcome,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import { readStitchingArtifact } from '@/lib/sidedoor/jobs/stitch/stitching-artifact';
import { readStitchingParent } from '@/lib/sidedoor/jobs/stitch/stitching-parent';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareJob, type OutboxJob } from 'thesidedoor-core/runtime/outbox';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRegenerationSource } from '../../../../helpers/runtime/regeneration-source';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('initial stitching admission with PostgreSQL and attributed storage', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('initial_stitch');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    directory = await mkdtemp(join(tmpdir(), 'sotto-initial-stitch-'));
    await instance.configureInfrastructure({
      storageProvider: 'local',
      localStorageRoot: directory,
    });
    invalidateServerInfra();
    vi.stubEnv('DATABASE_URL', process.env.SIDEDOOR_TEST_DATABASE_URL!);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await instance?.close();
    boundary.database = null;
  });

  async function source(attributed = true, audio = Buffer.from('audio')) {
    const { episode } = await createRegenerationSource(
      instance.database,
      identity.ownerId,
      directory,
      audio,
      false,
      attributed
    );
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { status: 'GENERATING_AUDIO', audioGenerationKey: 'generation-one' },
    });
    const request = new Request('http://localhost', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const original = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!original || original.kind !== 'content')
      throw new Error('Expected fixture content identity');
    const authorize = async (tx: Prisma.TransactionClient) => {
      await requireOriginalSottoAdmission(tx, request, original);
      return { userId: original.userId };
    };
    return { episodeId: episode.id, authorize };
  }

  it.each(['concurrent', 'rollback', 'superseded'] as const)(
    'settles terminal processing failure with %s delivery',
    async (scenario) => {
      const input = await source();
      const inputs = await sottoTransaction(instance.database, (tx) =>
        captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
      );
      const prepared = prepareInitialStitch(inputs, 'stock');
      const parent = await sottoTransaction(instance.database, (tx) =>
        commitInitialStitch(tx, input.authorize, inputs, 'stock', prepared, 'GENERATING_AUDIO')
      );
      const identity = { operationId: parent.job.id, fingerprint: parent.fingerprint };
      const settle = () =>
        sottoTransaction(instance.database, (tx) => completeInitialStitchFailure(tx, identity));
      if (scenario === 'superseded') {
        await instance.database.episode.update({
          where: { id: input.episodeId },
          data: { audioGenerationKey: 'new-generation' },
        });
        await expect(settle()).rejects.toThrow('The audio generation changed');
        expect(
          (
            await sottoTransaction(instance.database, (tx) =>
              sottoJobOutbox(tx).read(parent.job.id)
            )
          )?.complete
        ).toBe(false);
        return;
      }
      if (scenario === 'rollback') {
        await expect(
          sottoTransaction(instance.database, async (tx) => {
            await completeInitialStitchFailure(tx, identity);
            throw new Error('Settlement transaction rejected');
          })
        ).rejects.toThrow('Settlement transaction rejected');
        expect(
          (await instance.database.episode.findUniqueOrThrow({ where: { id: input.episodeId } }))
            .status
        ).toBe('STITCHING');
        expect(
          (
            await sottoTransaction(instance.database, (tx) =>
              sottoJobOutbox(tx).read(parent.job.id)
            )
          )?.complete
        ).toBe(false);
      }
      const settled = await Promise.all([settle(), settle()]);
      expect(settled[0]).toEqual(settled[1]);
      expect(settled[0]).toMatchObject({
        kind: 'complete',
        outcome: { kind: 'PROCESSING_FAILED', failureCode: 'audio_stitching_failed' },
      });
      expect(
        await instance.database.episode.findUniqueOrThrow({ where: { id: input.episodeId } })
      ).toMatchObject({ status: 'FAILED', failedAtStatus: 'STITCHING', errorId: parent.job.id });
      expect(
        await instance.database.episodeVersion.count({ where: { episodeId: input.episodeId } })
      ).toBe(0);
      expect(
        await instance.database.pipelineEvent.count({
          where: { episodeId: input.episodeId, type: 'error' },
        })
      ).toBe(1);
      const replay = await sottoTransaction(instance.database, (tx) =>
        verifyCurrentInitialStitch(tx, input.authorize, input.episodeId, 'generation-one')
      );
      expect(replay.record.complete).toBe(true);
    }
  );

  it('recovery cannot create a missing stitching attempt', async () => {
    const input = await source();
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyCurrentInitialStitch(tx, input.authorize, input.episodeId, 'generation-one')
      )
    ).rejects.toThrow('The initial stitching attempt is missing');
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: input.episodeId } })).status
    ).toBe('GENERATING_AUDIO');
  });

  it('concurrent producers retain the winning stitching payload and output identities', async () => {
    const input = await source();
    const first = prepareInitialStitchIdentities();
    const second = prepareInitialStitchIdentities();
    const admit = (identities: ReturnType<typeof prepareInitialStitchIdentities>) =>
      sottoTransaction(instance.database, (tx) =>
        admitInitialStitch(tx, {
          ...input,
          generationKey: 'generation-one',
          soundPolicy: 'stock',
          identities,
          fromPhase: 'GENERATING_AUDIO',
        })
      );
    const results = await Promise.all([admit(first), admit(second)]);
    expect(results.map((result) => result.kind).sort()).toEqual(['admitted', 'existing']);
    if (results[0]!.kind === 'waiting' || results[1]!.kind === 'waiting')
      throw new Error('Completed segments must admit stitching');
    expect(results[0]!.record).toEqual(results[1]!.record);
    const stored = initialStitchPayloadSchema.parse(results[0]!.record.job.payload);
    const winner = results[0]!.record.job.id === first.operationId ? first : second;
    expect(stored.outputs).toEqual(winner.outputs);
    const replay = await admit(prepareInitialStitchIdentities());
    expect(replay.kind).toBe('existing');
    if (replay.kind !== 'waiting') expect(replay.record).toEqual(results[0]!.record);
    const recovered = await sottoTransaction(instance.database, (tx) =>
      verifyCurrentInitialStitch(tx, input.authorize, input.episodeId, 'generation-one')
    );
    expect(recovered.record).toEqual(results[0]!.record);
  });

  it('waits for segment audio without changing phase or allocating an attempt', async () => {
    const input = await source();
    await instance.database.segment.updateMany({
      where: { episodeId: input.episodeId },
      data: { audioUrl: null },
    });
    const identities = prepareInitialStitchIdentities();
    const result = await sottoTransaction(instance.database, (tx) =>
      admitInitialStitch(tx, {
        ...input,
        generationKey: 'generation-one',
        soundPolicy: 'stock',
        identities,
        fromPhase: 'GENERATING_AUDIO',
      })
    );
    expect(result).toEqual({ kind: 'waiting' });
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: input.episodeId } })).status
    ).toBe('GENERATING_AUDIO');
    expect(
      await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).read(identities.operationId)
      )
    ).toBeNull();
  });

  it('an ordinary segment retry cannot restart a failed episode', async () => {
    const input = await source();
    const identities = prepareInitialStitchIdentities();
    await instance.database.episode.update({
      where: { id: input.episodeId },
      data: { status: 'FAILED' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitInitialStitch(tx, {
          ...input,
          generationKey: 'generation-one',
          soundPolicy: 'stock',
          identities,
          fromPhase: 'GENERATING_AUDIO',
        })
      )
    ).rejects.toThrow('The stitching phase changed');
  });

  it('captures ordered content and registry identities and survives only the phase transition', async () => {
    const input = await source();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
    );
    expect(captured.segments.map((segment) => segment.text)).toEqual(['Before', 'After']);
    expect(captured.storageInputs.map((asset) => asset.consumer)).toEqual(
      captured.segments.map((segment) => `segment:${segment.id}:audio`)
    );
    expect(captured.storage.userId).toBe(identity.ownerId);
    await instance.database.episode.update({
      where: { id: input.episodeId },
      data: { status: 'STITCHING' },
    });
    await sottoTransaction(instance.database, (tx) =>
      validateInitialStitchInputs(tx, input.authorize, captured, 'STITCHING')
    );
  });

  it.each(['generation', 'text', 'duration', 'missing-audio', 'owner', 'revocation'] as const)(
    'rejects changed %s before work can use captured inputs',
    async (change) => {
      const input = await source();
      const captured = await sottoTransaction(instance.database, (tx) =>
        captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
      );
      if (change === 'revocation') await identity.access.logout(identity.ownerToken);
      else if (change === 'generation')
        await instance.database.episode.update({
          where: { id: input.episodeId },
          data: { audioGenerationKey: 'generation-two' },
        });
      else if (change === 'owner')
        await instance.database.episode.update({
          where: { id: input.episodeId },
          data: { userId: (await identity.household('Other')).id },
        });
      else
        await instance.database.segment.update({
          where: { id: captured.segments[0]!.id },
          data:
            change === 'text'
              ? { text: 'Changed' }
              : change === 'duration'
                ? { duration: 99 }
                : { audioUrl: null },
        });
      await expect(
        sottoTransaction(instance.database, (tx) =>
          validateInitialStitchInputs(tx, input.authorize, captured, 'GENERATING_AUDIO')
        )
      ).rejects.toThrow();
    }
  );

  it('rejects an unattributed audio URL instead of accepting it as a durable input', async () => {
    const input = await source(false);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
      )
    ).rejects.toThrow('attribution');
  });

  it('commits one durable attempt and the phase together and reuses an identical submission', async () => {
    const input = await source();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
    );
    const job = prepareInitialStitch(captured, 'stock');
    const record = await sottoTransaction(instance.database, (tx) =>
      commitInitialStitch(tx, input.authorize, captured, 'stock', job, 'GENERATING_AUDIO')
    );
    expect(record.job.handler).toBe('audio-stitching');
    expect(record.job.version).toBe(2);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: input.episodeId } })).status
    ).toBe('STITCHING');
    const replay = await sottoTransaction(instance.database, (tx) =>
      commitInitialStitch(
        tx,
        input.authorize,
        captured,
        'stock',
        JSON.parse(JSON.stringify(job)),
        'GENERATING_AUDIO'
      )
    );
    expect(replay.fingerprint).toBe(record.fingerprint);
    expect(initialStitchPayloadSchema.parse(replay.job.payload).outputs).toEqual(
      initialStitchPayloadSchema.parse(job.payload).outputs
    );
    await sottoTransaction(instance.database, (tx) =>
      requireInitialStitchAttempt(tx, input.episodeId, job.id, record.fingerprint)
    );
  });

  async function publishFixture(
    tx: Prisma.TransactionClient,
    parent: OutboxJob,
    kind: 'READY' | 'DURATION_FAILED'
  ) {
    const { inputs, outputs } = initialStitchPayloadSchema.parse(parent.job.payload);
    const version = inputs.previousAudio.currentVersion + (inputs.previousAudio.audioUrl ? 1 : 0);
    const stitchKey = createInitialStitchKey(parent.fingerprint);
    const audioUrl = 'https://fixture.invalid/produced.mp3';
    const definitions =
      kind === 'READY'
        ? [
            {
              key: 'readyNotification' as const,
              handler: 'notifications',
              payload: {
                userId: inputs.storage.userId,
                type: 'EPISODE_READY',
                title: 'Ready',
                message: 'Lesson ready',
                data: { episodeId: inputs.episodeId },
              },
            },
            {
              key: 'readyStatus' as const,
              handler: 'episode-status',
              payload: { episodeId: inputs.episodeId, status: 'READY' },
            },
            {
              key: 'pdf' as const,
              handler: 'pdf-generation',
              payload: {
                episodeId: inputs.episodeId,
                userId: inputs.storage.userId,
                episodeVersion: version,
                stitchKey,
              },
            },
            {
              key: 'waveform' as const,
              handler: 'waveform-generation',
              payload: {
                episodeId: inputs.episodeId,
                userId: inputs.storage.userId,
                episodeVersion: version,
                stitchKey,
              },
            },
          ]
        : [
            {
              key: 'failedNotification' as const,
              handler: 'notifications',
              payload: {
                userId: inputs.storage.userId,
                type: 'EPISODE_FAILED',
                title: 'Failed',
                message: 'Duration exceeded',
                data: { episodeId: inputs.episodeId },
              },
            },
            {
              key: 'failedStatus' as const,
              handler: 'episode-status',
              payload: { episodeId: inputs.episodeId, status: 'FAILED' },
            },
          ];
    const children = new Map<string, OutboxJob>();
    for (const definition of definitions) {
      const child = await sottoJobOutbox(tx).enqueue(
        prepareJob({
          id: outputs[definition.key],
          namespace: parent.job.namespace,
          handler: definition.handler,
          version: 1,
          payload: z.json().parse({
            ...definition.payload,
            parentOperationId: parent.job.id,
            parentFingerprint: parent.fingerprint,
            storage: inputs.storage,
            contributorId: inputs.storage.userId,
          }),
          scopes: inputs.storage.scopes,
          delivery: { attempts: 3, priority: 0, availableAt: 0 },
        })
      );
      children.set(definition.key, child);
    }
    await sottoJobOutbox(tx).complete(parent.job.id, parent.fingerprint);
    if (kind === 'READY')
      await tx.episodeVersion.create({
        data: {
          id: outputs.versionId,
          episodeId: inputs.episodeId,
          version,
          audioUrl,
          duration: 10,
          changeType: 'initial',
        },
      });
    const effects = [...children.values()].map((child) => ({
      id: child.job.id,
      fingerprint: child.fingerprint,
    }));
    await writeInitialStitchOutcome(
      tx,
      { id: parent.job.id, fingerprint: parent.fingerprint },
      kind === 'READY'
        ? { kind, stitchKey, versionId: outputs.versionId, version, audioUrl, effects }
        : { kind, stitchKey, durationSeconds: 5000, limitSeconds: 3000, effects }
    );
    return children;
  }

  it.each(['READY', 'DURATION_FAILED'] as const)(
    'binds %s children to their saved identity and committed outcome',
    async (kind) => {
      const input = await source();
      await sottoTransaction(instance.database, async (tx) => {
        const captured = await captureInitialStitchInputs(
          tx,
          input.authorize,
          input.episodeId,
          'generation-one'
        );
        const job = prepareInitialStitch(captured, 'stock');
        const parent = await sottoJobOutbox(tx).enqueue(job);
        const children = await publishFixture(tx, parent, kind);
        const { outputs } = initialStitchPayloadSchema.parse(job.payload);
        const identity = { id: job.id, fingerprint: parent.fingerprint };
        for (const effect of [
          'readyNotification',
          'failedNotification',
          'readyStatus',
          'failedStatus',
          'pdf',
          'waveform',
        ] as const) {
          const child = children.get(effect);
          const work = {
            operationId: outputs[effect],
            fingerprint: child?.fingerprint ?? 'a'.repeat(64),
            scopes: captured.storage.scopes,
          };
          if (!child) {
            await expect(readStitchingParent(tx, work, identity, effect)).rejects.toThrow(
              'committed outcome'
            );
            continue;
          }
          const admitted = await readStitchingParent(tx, work, identity, effect);
          expect(admitted?.source).toEqual({
            episodeId: input.episodeId,
            contributorId: captured.storage.userId,
            storage: captured.storage,
          });
          await expect(
            readStitchingParent(tx, { ...work, operationId: randomUUID() }, identity, effect)
          ).rejects.toThrow('child identity');
          await expect(
            readStitchingParent(tx, { ...work, fingerprint: 'f'.repeat(64) }, identity, effect)
          ).rejects.toThrow('committed outcome');
        }
        const work = {
          operationId: outputs.pdf,
          fingerprint: 'a'.repeat(64),
          scopes: captured.storage.scopes,
        };
        await expect(
          readStitchingParent(tx, work, { ...identity, fingerprint: 'b'.repeat(64) }, 'pdf')
        ).rejects.toThrow();
        await expect(
          readStitchingParent(tx, { ...work, scopes: [] }, identity, 'pdf')
        ).rejects.toThrow();
      });
    }
  );

  it.each(['pdf-generation', 'waveform-generation'] as const)(
    'admits %s from an initial parent with no interaction',
    async (handler) => {
      const input = await source();
      await sottoTransaction(instance.database, async (tx) => {
        const inputs = await captureInitialStitchInputs(
          tx,
          input.authorize,
          input.episodeId,
          'generation-one'
        );
        const parent = await sottoJobOutbox(tx).enqueue(prepareInitialStitch(inputs, 'stock'));
        const children = await publishFixture(tx, parent, 'READY');
        const { outputs } = initialStitchPayloadSchema.parse(parent.job.payload);
        const child = children.get(handler === 'pdf-generation' ? 'pdf' : 'waveform')!;
        const work = await readStitchingArtifact(
          tx,
          {
            id: child.job.id,
            name: `${handler}.v1`,
            data: { operationId: child.job.id, fingerprint: child.fingerprint },
          },
          handler
        );
        expect(work).toMatchObject({ complete: false, parentInteractionId: null });
        await tx.episodeVersion.update({
          where: { id: outputs.versionId },
          data: { id: randomUUID() },
        });
        await expect(
          readStitchingArtifact(
            tx,
            {
              id: child.job.id,
              name: `${handler}.v1`,
              data: { operationId: child.job.id, fingerprint: child.fingerprint },
            },
            handler
          )
        ).rejects.toThrow('admitted output');
      });
    }
  );

  it('does not accept cancellation-only completion as a successful initial stitch', async () => {
    const input = await source();
    await sottoTransaction(instance.database, async (tx) => {
      const captured = await captureInitialStitchInputs(
        tx,
        input.authorize,
        input.episodeId,
        'generation-one'
      );
      const parent = await sottoJobOutbox(tx).enqueue(prepareInitialStitch(captured, 'none'));
      await sottoJobOutbox(tx).complete(parent.job.id, parent.fingerprint);
      const { outputs } = initialStitchPayloadSchema.parse(parent.job.payload);
      await expect(
        readStitchingParent(
          tx,
          {
            operationId: outputs.readyStatus,
            fingerprint: 'a'.repeat(64),
            scopes: parent.job.scopes,
          },
          { id: parent.job.id, fingerprint: parent.fingerprint },
          'readyStatus'
        )
      ).rejects.toThrow('Snapshot is missing');
    });
  });

  it('rolls back outcome, version, children and parent completion together', async () => {
    const input = await source();
    const parent = await sottoTransaction(instance.database, async (tx) => {
      const captured = await captureInitialStitchInputs(
        tx,
        input.authorize,
        input.episodeId,
        'generation-one'
      );
      return sottoJobOutbox(tx).enqueue(prepareInitialStitch(captured, 'none'));
    });
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        await publishFixture(tx, parent, 'READY');
        throw new Error('Publication transaction failed');
      })
    ).rejects.toThrow('Publication transaction failed');
    await sottoTransaction(instance.database, async (tx) => {
      expect((await sottoJobOutbox(tx).read(parent.job.id))?.complete).toBe(false);
      await expect(readInitialStitchOutcome(tx, parent)).rejects.toThrow('Snapshot is missing');
      const { outputs } = initialStitchPayloadSchema.parse(parent.job.payload);
      expect(await tx.episodeVersion.findUnique({ where: { id: outputs.versionId } })).toBeNull();
      expect(await sottoJobOutbox(tx).read(outputs.pdf)).toBeNull();
      await publishFixture(tx, parent, 'READY');
      const completed = (await sottoJobOutbox(tx).read(parent.job.id))!;
      const outcome = await readInitialStitchOutcome(tx, completed);
      await expect(
        writeInitialStitchOutcome(
          tx,
          { id: parent.job.id, fingerprint: parent.fingerprint },
          outcome
        )
      ).rejects.toThrow('already exists');
      expect(await readInitialStitchOutcome(tx, completed)).toEqual(outcome);
    });
  });
});
