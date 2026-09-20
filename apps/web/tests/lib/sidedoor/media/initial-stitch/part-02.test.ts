// @vitest-environment node
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { createInitialStitchKey } from '@/lib/audio/stitch-identity';
import { captureSottoCredentialProbe } from '@/lib/providers/shared/credential-validation';
import { invalidateServerInfra } from '@/lib/server-config';
import {
  requireOriginalSottoAdmission,
  resolveSottoRequest,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import {
  commitInitialStitch,
  prepareInitialStitch,
  requireInitialStitchAttempt,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import {
  captureInitialStitchInputs,
  validateCompletedInitialStitchInputs,
  validateInitialStitchInputs,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-inputs';
import {
  readInitialStitchOutcome,
  writeInitialStitchOutcome,
} from '@/lib/sidedoor/jobs/initial/initial-stitch-outcome';
import { readStitchingParent } from '@/lib/sidedoor/jobs/stitch/stitching-parent';
import { processAudioStitching } from '@/workers/audio-stitching.worker';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareJob, type OutboxJob } from 'thesidedoor-core/runtime/outbox';
import { StorageCleanupJournal, prepareStorageCleanup } from 'thesidedoor-core/storage';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRegenerationSource } from '../../../../helpers/runtime/regeneration-source';
import { relocateStorageFixture } from '../../../../helpers/runtime/relocate-storage';
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

  it.each([false, true])(
    'cancels an initial child after snapshot erasure, parent erased=%s',
    async (eraseParent) => {
      const input = await source();
      await sottoTransaction(instance.database, async (tx) => {
        const captured = await captureInitialStitchInputs(
          tx,
          input.authorize,
          input.episodeId,
          'generation-one'
        );
        const parent = await sottoJobOutbox(tx).enqueue(prepareInitialStitch(captured, 'none'));
        const children = await publishFixture(tx, parent, 'READY');
        const child = children.get('pdf')!;
        const scope = captured.storage.scopes.find(
          (item) => item.subjectId === `profile:${identity.ownerId}`
        )!;
        const cleanup = new StorageCleanupJournal(
          { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
          'postgres',
          parent.job.namespace
        );
        await cleanup.createJob(
          prepareStorageCleanup({ namespace: parent.job.namespace, ...scope })
        );
        await sottoJobSnapshot(tx).eraseNext(parent.job.id, parent.fingerprint);
        if (eraseParent) await sottoJobOutbox(tx).erase(parent.job.id, parent.fingerprint, scope);
        expect(
          await readStitchingParent(
            tx,
            { operationId: child.job.id, fingerprint: child.fingerprint, scopes: child.job.scopes },
            { id: parent.job.id, fingerprint: parent.fingerprint },
            'pdf'
          )
        ).toBeNull();
        expect((await sottoJobOutbox(tx).read(child.job.id))?.complete).toBe(true);
      });
    }
  );

  it.each([
    'unchanged',
    'generation',
    'revoked',
    'version',
    'relocated',
    'partial-reference',
    'split-assets',
    'segment-regenerated',
    'wrong-source-asset',
  ] as const)(
    'verifies a completed producer replay with %s authority and publication',
    async (change) => {
      const input = await source(
        true,
        await readFile(join(process.cwd(), 'src/assets/sfx/intro-warm.mp3'))
      );
      const prepared = await sottoTransaction(instance.database, async (tx) => {
        const inputs = await captureInitialStitchInputs(
          tx,
          input.authorize,
          input.episodeId,
          'generation-one'
        );
        const job = prepareInitialStitch(inputs, 'none');
        const record = await commitInitialStitch(
          tx,
          input.authorize,
          inputs,
          'none',
          job,
          'GENERATING_AUDIO'
        );
        return { inputs, job, record };
      });
      const { inputs, job, record } = prepared;
      const { outputs } = initialStitchPayloadSchema.parse(job.payload);
      await processAudioStitching({
        id: job.id,
        name: 'audio-stitching.v2',
        data: { operationId: job.id, fingerprint: record.fingerprint },
        updateProgress: async () => undefined,
      });
      const original = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).listIncomplete()
      );
      if (
        [
          'relocated',
          'partial-reference',
          'split-assets',
          'segment-regenerated',
          'wrong-source-asset',
        ].includes(change)
      ) {
        const episode = await instance.database.episode.findUniqueOrThrow({
          where: { id: inputs.episodeId },
        });
        const moved = await relocateStorageFixture({
          database: instance.database,
          directory,
          reference: episode.audioUrl!,
          consumers: [
            `episode:${inputs.episodeId}:audio`,
            `episode-version:${outputs.versionId}:audio`,
          ],
          publish: async (tx, reference) => {
            await tx.episode.update({
              where: { id: inputs.episodeId },
              data: { audioUrl: reference },
            });
            if (change !== 'partial-reference')
              await tx.episodeVersion.update({
                where: { id: outputs.versionId },
                data: { audioUrl: reference },
              });
          },
        });
        if (change === 'split-assets')
          await relocateStorageFixture({
            database: instance.database,
            directory,
            reference: moved,
            consumers: [`episode-version:${outputs.versionId}:audio`],
            recordProof: false,
            publish: (tx, reference) =>
              tx.episodeVersion.update({
                where: { id: outputs.versionId },
                data: { audioUrl: reference },
              }),
          });
        for (const segment of inputs.segments)
          await relocateStorageFixture({
            database: instance.database,
            directory,
            reference: segment.audioUrl!,
            consumers: [`segment:${segment.id}:audio`],
            recordProof: change !== 'segment-regenerated',
            publish: (tx, reference) =>
              tx.segment.update({ where: { id: segment.id }, data: { audioUrl: reference } }),
          });
        if (change === 'wrong-source-asset') {
          const altered = structuredClone(inputs);
          altered.storageInputs[0]!.assetId = '0'.repeat(64);
          const completed = await sottoTransaction(instance.database, (tx) =>
            sottoJobOutbox(tx).read(job.id)
          );
          const outcome = await sottoTransaction(instance.database, (tx) =>
            readInitialStitchOutcome(tx, completed!)
          );
          if (outcome.kind !== 'READY') throw new Error('Expected completed audio');
          await expect(
            sottoTransaction(instance.database, (tx) =>
              validateCompletedInitialStitchInputs(
                tx,
                input.authorize,
                altered,
                {
                  audioUrl: outcome.audioUrl,
                  currentVersion: outcome.version,
                  lastCompletedStitchKey: outcome.stitchKey,
                },
                'READY'
              )
            )
          ).rejects.toThrow('superseded');
        }
      }
      if (change === 'generation')
        await instance.database.episode.update({
          where: { id: inputs.episodeId },
          data: { audioGenerationKey: 'next-generation' },
        });
      if (change === 'revoked') await identity.access.logout(identity.ownerToken);
      if (change === 'version')
        await instance.database.episodeVersion.update({
          where: { id: outputs.versionId },
          data: { id: randomUUID() },
        });
      const replay = sottoTransaction(instance.database, (tx) =>
        commitInitialStitch(
          tx,
          input.authorize,
          inputs,
          'none',
          JSON.parse(JSON.stringify(job)),
          'GENERATING_AUDIO'
        )
      );
      if (['unchanged', 'relocated', 'wrong-source-asset'].includes(change))
        expect((await replay).complete).toBe(true);
      else await expect(replay).rejects.toThrow();
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete())
      ).toEqual(original);
      expect(
        await instance.database.episodeVersion.count({ where: { episodeId: inputs.episodeId } })
      ).toBe(1);
    }
  );

  it('replays a committed duration failure without admitting another stitch', async () => {
    const input = await source();
    const submitted = await sottoTransaction(instance.database, async (tx) => {
      const inputs = await captureInitialStitchInputs(
        tx,
        input.authorize,
        input.episodeId,
        'generation-one'
      );
      const job = prepareInitialStitch(inputs, 'none');
      const parent = await commitInitialStitch(
        tx,
        input.authorize,
        inputs,
        'none',
        job,
        'GENERATING_AUDIO'
      );
      await publishFixture(tx, parent, 'DURATION_FAILED');
      await tx.episode.update({
        where: { id: input.episodeId },
        data: { status: 'FAILED', failedAtStatus: 'STITCHING' },
      });
      return { inputs, job };
    });
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          commitInitialStitch(
            tx,
            input.authorize,
            submitted.inputs,
            'none',
            submitted.job,
            'GENERATING_AUDIO'
          )
        )
      ).complete
    ).toBe(true);
    expect(
      await instance.database.episodeVersion.count({ where: { episodeId: input.episodeId } })
    ).toBe(0);
  });

  it.each([
    'none',
    'stock',
    'premium',
    'disabled',
    'revoked',
    'revoked-last',
    'failed',
    'rate-limited',
    'truncated',
    'accepted',
    'server-failed',
    'invalid-audio',
    'malformed',
    'reactions-only',
  ] as const)('executes the initial sound policy with %s configuration', async (scenario) => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    const audio = await readFile(join(process.cwd(), 'src/assets/sfx/intro-warm.mp3'));
    const input = await source(true, audio);
    await instance.database.script.create({
      data: {
        episodeId: input.episodeId,
        markdown: 'Lesson',
        turns: [
          { speaker: 'HOST', text: 'Hello [applause]' },
          { speaker: 'EXPERT', text: 'Welcome' },
        ],
        soundCues:
          scenario === 'reactions-only'
            ? []
            : [
                {
                  type: 'intro',
                  prompt: 'Warm intro',
                  durationSeconds: scenario === 'malformed' ? -1 : 2,
                  insertAfterTurn: 0,
                },
                {
                  type: 'transition',
                  prompt: 'Gentle transition',
                  durationSeconds: 2,
                  insertAfterTurn: 1,
                },
              ],
      },
    });
    if (!['none', 'stock', 'reactions-only'].includes(scenario))
      await sottoTransaction(instance.database, async (tx) => {
        const storage = await sottoCredentialStorage(tx, 'tts', 'elevenlabs');
        const owner = await captureSottoCredentialOwner(tx, identity.ownerId);
        const values = { apiKey: 'personal-sfx-key' };
        const probe = captureSottoCredentialProbe('tts', 'elevenlabs', values);
        if (probe.kind === 'unsupported') throw new Error('Expected ElevenLabs fixture support');
        const slot = { ...storage.slot, owner };
        const head = await storage.owned.head(slot);
        await storage.owned.replace(
          storage.owned.prepareReplacement(slot, {
            expectedHeadRevision: head.revision,
            credentialRevision: randomUUID(),
            values,
            binding: probe.binding,
            availability: scenario === 'disabled' ? 'disabled' : 'enabled',
            label: 'Personal effects',
            metadata: { createdAt: 1, updatedAt: 1, lastUsedAt: null },
          })
        );
      });
    const policy = scenario === 'none' ? 'none' : scenario === 'stock' ? 'stock' : 'elevenlabs';
    const parent = await sottoTransaction(instance.database, async (tx) => {
      const inputs = await captureInitialStitchInputs(
        tx,
        input.authorize,
        input.episodeId,
        'generation-one'
      );
      return commitInitialStitch(
        tx,
        input.authorize,
        inputs,
        policy,
        prepareInitialStitch(inputs, policy),
        'GENERATING_AUDIO'
      );
    });
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(request, init));
      if (scenario === 'revoked' || (scenario === 'revoked-last' && requests.length === 2))
        await sottoTransaction(instance.database, async (tx) => {
          const storage = await sottoCredentialStorage(tx, 'tts', 'elevenlabs');
          const slot = {
            ...storage.slot,
            owner: await captureSottoCredentialOwner(tx, identity.ownerId),
          };
          const head = await storage.owned.head(slot);
          await storage.owned.remove(slot, head.revision, randomUUID());
        });
      if (scenario === 'failed') return new Response('Sound generation rejected', { status: 401 });
      if (scenario === 'rate-limited') return new Response('Rate limit exceeded', { status: 429 });
      if (scenario === 'server-failed') return new Response('Internal error', { status: 503 });
      if (scenario === 'accepted')
        return new Response('{"jobId":"still-running"}', { status: 202 });
      if (scenario === 'invalid-audio') return new Response('{"jobId":"still-running"}');
      if (scenario === 'truncated')
        return new Response(
          new ReadableStream({
            start(stream) {
              stream.error(new Error('Response truncated'));
            },
          }),
          { status: 401 }
        );
      return new Response(new Uint8Array(audio));
    });
    const execution = processAudioStitching({
      id: parent.job.id,
      name: 'audio-stitching.v2',
      data: { operationId: parent.job.id, fingerprint: parent.fingerprint },
      updateProgress: async () => undefined,
    });
    if (
      [
        'disabled',
        'revoked',
        'revoked-last',
        'failed',
        'rate-limited',
        'truncated',
        'accepted',
        'server-failed',
        'invalid-audio',
        'malformed',
      ].includes(scenario)
    ) {
      await expect(execution).rejects.toThrow();
      expect(
        await instance.database.episodeVersion.count({ where: { episodeId: input.episodeId } })
      ).toBe(0);
      expect(
        (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(parent.job.id)))
          ?.complete
      ).toBe(false);
    } else {
      await execution;
      const completed = (await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).read(parent.job.id)
      ))!;
      expect(
        await sottoTransaction(instance.database, (tx) => readInitialStitchOutcome(tx, completed))
      ).toMatchObject({ kind: 'READY' });
      expect(
        await instance.database.episodeVersion.count({ where: { episodeId: input.episodeId } })
      ).toBe(1);
      if (scenario === 'stock') {
        const fingerprint = await instance.database.audioFingerprint.findUniqueOrThrow({
          where: { episodeId: input.episodeId },
        });
        expect(fingerprint.fingerprint.length).toBeGreaterThan(0);
      }
    }
    expect(requests).toHaveLength(
      ['premium', 'revoked-last'].includes(scenario)
        ? 2
        : [
              'revoked',
              'failed',
              'rate-limited',
              'truncated',
              'accepted',
              'server-failed',
              'invalid-audio',
            ].includes(scenario)
          ? 1
          : 0
    );
    const scope = parent.job.scopes.find(
      (item) => item.subjectId === `episode:${input.episodeId}`
    )!;
    const unresolved = await sottoTransaction(instance.database, (tx) =>
      sottoJobExecutions(tx).listUnresolved(scope)
    );
    if (['truncated', 'accepted', 'server-failed', 'invalid-audio'].includes(scenario))
      expect(unresolved.executions).toMatchObject([{ status: 'cleanup-unconfirmed' }]);
    else expect(unresolved.executions).toEqual([]);
    expect(
      requests.every(
        (request) =>
          request.url === 'https://api.elevenlabs.io/v1/sound-generation' &&
          request.headers.get('xi-api-key') === 'personal-sfx-key'
      )
    ).toBe(true);
  });

  it('rejects an unsupported sound policy before preparing durable work', async () => {
    const input = await source();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
    );
    expect(() =>
      Reflect.apply(prepareInitialStitch, undefined, [captured, 'automatic-fallback'])
    ).toThrow();
  });

  it('rejects duplicate output identities and changed identities on an existing operation', async () => {
    const input = await source();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
    );
    const job = prepareInitialStitch(captured, 'stock');
    const { outputs } = initialStitchPayloadSchema.parse(job.payload);
    expect(() =>
      prepareInitialStitch(captured, 'stock', job.id, { ...outputs, pdf: outputs.waveform })
    ).toThrow();
    expect(() =>
      prepareInitialStitch(captured, 'stock', job.id, { ...outputs, versionId: job.id })
    ).toThrow();
    await sottoTransaction(instance.database, (tx) =>
      commitInitialStitch(tx, input.authorize, captured, 'stock', job, 'GENERATING_AUDIO')
    );
    const changed = prepareInitialStitch(captured, 'stock', job.id, {
      ...outputs,
      pdf: randomUUID(),
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        commitInitialStitch(tx, input.authorize, captured, 'stock', changed, 'GENERATING_AUDIO')
      )
    ).rejects.toThrow('different inputs');
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(job.id)))?.job
    ).toEqual(job);
  });

  it('rolls back queue admission, attempt identity and phase if its application transaction fails', async () => {
    const input = await source();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
    );
    const job = prepareInitialStitch(captured, 'none');
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        await commitInitialStitch(tx, input.authorize, captured, 'none', job, 'GENERATING_AUDIO');
        throw new Error('Application commit failed');
      })
    ).rejects.toThrow('Application commit failed');
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(job.id))
    ).toBeNull();
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: input.episodeId } })).status
    ).toBe('GENERATING_AUDIO');
    const submitted = await sottoTransaction(instance.database, (tx) =>
      commitInitialStitch(tx, input.authorize, captured, 'none', job, 'GENERATING_AUDIO')
    );
    await sottoTransaction(instance.database, (tx) =>
      requireInitialStitchAttempt(tx, input.episodeId, job.id, submitted.fingerprint)
    );
  });

  it('fences a failed attempt after a fresh authorized resume even when its content is identical', async () => {
    const input = await source();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
    );
    const first = prepareInitialStitch(captured, 'stock');
    const old = await sottoTransaction(instance.database, (tx) =>
      commitInitialStitch(tx, input.authorize, captured, 'stock', first, 'GENERATING_AUDIO')
    );
    await instance.database.episode.update({
      where: { id: input.episodeId },
      data: { status: 'FAILED' },
    });
    const next = prepareInitialStitch(captured, 'stock');
    const resumed = await sottoTransaction(instance.database, (tx) =>
      commitInitialStitch(tx, input.authorize, captured, 'stock', next, 'FAILED')
    );
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requireInitialStitchAttempt(tx, input.episodeId, first.id, old.fingerprint)
      )
    ).rejects.toThrow('attempt changed');
    await sottoTransaction(instance.database, (tx) =>
      requireInitialStitchAttempt(tx, input.episodeId, next.id, resumed.fingerprint)
    );
    await expect(
      sottoTransaction(instance.database, (tx) =>
        commitInitialStitch(tx, input.authorize, captured, 'stock', first, 'FAILED')
      )
    ).rejects.toThrow('attempt changed');
  });

  it('rejects an altered prepared job and a revoked submitter without enqueuing work', async () => {
    const input = await source();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
    );
    const job = prepareInitialStitch(captured, 'stock');
    await expect(
      sottoTransaction(instance.database, (tx) =>
        commitInitialStitch(tx, input.authorize, captured, 'none', job, 'GENERATING_AUDIO')
      )
    ).rejects.toThrow('does not match');
    await identity.access.logout(identity.ownerToken);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        commitInitialStitch(tx, input.authorize, captured, 'stock', job, 'GENERATING_AUDIO')
      )
    ).rejects.toThrow();
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(job.id))
    ).toBeNull();
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: input.episodeId } })).status
    ).toBe('GENERATING_AUDIO');
  });

  it('rejects a failed attempt even when its captured content is unchanged', async () => {
    const input = await source();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
    );
    await instance.database.episode.update({
      where: { id: input.episodeId },
      data: { status: 'FAILED' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        validateInitialStitchInputs(tx, input.authorize, captured, 'STITCHING')
      )
    ).rejects.toThrow('phase changed');
  });

  it('keeps the comparison snapshot when its caller mutates it during admission', async () => {
    const input = await source();
    const captured = await sottoTransaction(instance.database, (tx) =>
      captureInitialStitchInputs(tx, input.authorize, input.episodeId, 'generation-one')
    );
    await expect(
      sottoTransaction(instance.database, (tx) =>
        validateInitialStitchInputs(
          tx,
          async (database) => {
            const admitted = await input.authorize(database);
            captured.segments[0]!.text = 'Changed during admission';
            await database.segment.update({
              where: { id: captured.segments[0]!.id },
              data: { text: captured.segments[0]!.text },
            });
            return admitted;
          },
          captured,
          'GENERATING_AUDIO'
        )
      )
    ).rejects.toThrow('captured stitching inputs changed');
    expect(
      (
        await instance.database.segment.findUniqueOrThrow({
          where: { id: captured.segments[0]!.id },
        })
      ).text
    ).toBe('Before');
  });

  it('stops capture when the original authority cancels the operation', async () => {
    const input = await source();
    const controller = new AbortController();
    const reason = new Error('Generation cancelled');
    await expect(
      sottoTransaction(instance.database, (tx) =>
        captureInitialStitchInputs(
          tx,
          async (database) => {
            const admitted = await input.authorize(database);
            controller.abort(reason);
            return admitted;
          },
          input.episodeId,
          'generation-one',
          controller.signal
        )
      )
    ).rejects.toBe(reason);
  });
});
