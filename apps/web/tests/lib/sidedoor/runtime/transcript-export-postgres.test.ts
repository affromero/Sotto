// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  LocalStorageWriter,
  StorageCleanupJournal,
  prepareStorageCleanup,
} from 'thesidedoor-core/storage';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import {
  admitTranscriptExport,
  readTranscriptExport,
} from '@/lib/sidedoor/storage/publication/transcript-export';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { verifyTranscriptPublication } from '@/lib/sidedoor/storage/publication/transcript-publication';
import { readEpisodeTranscript } from '@/lib/episodes/episode-transcript';
import { processPdfGeneration } from '@/workers/pdf-generation.worker';
import { GET, POST } from '@/app/api/v1/episodes/[episodeId]/export/route';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
import { relocateStorageFixture } from '../../../helpers/runtime/relocate-storage';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
suite('request-admitted transcript exports', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('transcript_export');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    identity = await instance.reset();
    directory = await mkdtemp(join(tmpdir(), 'sotto-transcript-'));
    await instance.configureInfrastructure({
      storageProvider: 'local',
      localStorageRoot: directory,
    });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await instance?.close();
  });

  async function source(visibility: 'PRIVATE' | 'UNLISTED' = 'PRIVATE') {
    return instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Imported lesson',
        topic: 'Language',
        language: 'es',
        status: 'READY',
        visibility,
        segments: {
          create: [{ order: 0, speaker: 'HOST', text: 'The original transcript', startTime: 0 }],
        },
      },
    });
  }
  async function caller(token = identity.ownerToken) {
    const request = new Request('http://localhost/api/v1/episodes/example/export', {
      method: 'POST',
      headers: { cookie: `${SHARED_SESSION_COOKIE}=${token}` },
    });
    const admission = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!admission || admission.kind !== 'content')
      throw new Error('Fixture requires content admission');
    return { request, admission: admission as AuthenticatedRequest };
  }
  async function admit(episodeId: string, token?: string) {
    const original = await caller(token);
    const result = await sottoTransaction(instance.database, (tx) =>
      admitTranscriptExport(tx, {
        ...original,
        episodeId,
        operationId: randomUUID(),
      })
    );
    if (result.kind !== 'admitted') throw new Error('Fixture requires a new export');
    const { record } = result;
    const queued = {
      id: record.job.id,
      name: 'pdf-generation.v2',
      data: {
        operationId: record.job.id,
        fingerprint: record.fingerprint,
      },
    };
    return { record, queued };
  }
  async function run(queued: Awaited<ReturnType<typeof admit>>['queued']) {
    await processPdfGeneration({ ...queued, updateProgress: async () => {} });
  }
  it('publishes an imported transcript through canonical storage and reuses it for a concurrent request', async () => {
    const episode = await source('UNLISTED');
    const viewer = await identity.household('Viewer');
    const first = await admit(episode.id, viewer.token);
    const second = await admit(episode.id);
    await run(first.queued);
    const published = await instance.database.episode.findUniqueOrThrow({
      where: { id: episode.id },
    });
    expect(published.pdfUrl).toBeTruthy();
    expect(published.transcriptPublication).toMatchObject({
      operationId: first.record.job.id,
      reference: published.pdfUrl,
    });
    const path = published.pdfUrl!.replace('/api/v1/storage/', '');
    expect(await readFile(join(directory, path), 'utf8')).toContain('The original transcript');
    const scope = first.record.job.scopes.find((item) => item.subjectId === `profile:${viewer.id}`);
    if (!scope) throw new Error('Expected viewer scope');
    await sottoTransaction(instance.database, async (tx) => {
      await new StorageCleanupJournal(
        { query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values) },
        'postgres',
        SIDEDOOR_STATE_ID
      ).createJob(prepareStorageCleanup({ namespace: SIDEDOOR_STATE_ID, ...scope }));
      await sottoJobOutbox(tx).erase(first.record.job.id, first.record.fingerprint, scope);
      await tx.user.delete({ where: { id: viewer.id } });
    });
    await run(second.queued);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).pdfUrl
    ).toBe(published.pdfUrl);
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).receipt(first.record.job.id)
        )
      )?.status
    ).toBe('erased');
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).receipt(second.record.job.id)
        )
      )?.status
    ).toBe('complete');
  });
  it('rejects the removed raw PDF payload before any storage work', async () => {
    await expect(
      processPdfGeneration({ name: 'generate_pdf', data: { episodeId: 'old' } } as Job<unknown>)
    ).rejects.toThrow('requires a canonical Sidedoor job reference');
  });
  it.each(['relocation', 'ordinary replacement', 'changed transcript'] as const)(
    'verifies transcript reuse after %s without rewriting publication evidence',
    async (mode) => {
      const episode = await source();
      const first = await admit(episode.id);
      const pending = await admit(episode.id);
      await run(first.queued);
      const published = await instance.database.episode.findUniqueOrThrow({
        where: { id: episode.id },
      });
      await relocateStorageFixture({
        database: instance.database,
        directory,
        reference: published.pdfUrl!,
        consumers: [`episode:${episode.id}:transcript`],
        recordProof: mode !== 'ordinary replacement',
        publish: (tx, reference) =>
          tx.episode.update({ where: { id: episode.id }, data: { pdfUrl: reference } }),
      });
      if (mode === 'changed transcript')
        await instance.database.episode.update({
          where: { id: episode.id },
          data: { title: 'Changed title' },
        });
      expect(
        await sottoTransaction(instance.database, async (tx) =>
          verifyTranscriptPublication(tx, episode.id, await readEpisodeTranscript(tx, episode.id))
        )
      ).toBe(mode === 'relocation');
      if (mode === 'relocation') await run(pending.queued);
      else
        await expect(run(pending.queued)).rejects.toThrow(
          mode === 'changed transcript' ? 'inputs changed' : 'cannot be verified'
        );
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } }))
          .transcriptPublication
      ).toEqual(published.transcriptPublication);
    }
  );
  it('serves existing export URLs through actual GET and POST with canonical authentication', async () => {
    const episode = await source();
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { pdfUrl: '/existing/transcript.md' },
    });
    const params = { params: Promise.resolve({ episodeId: episode.id }) };
    for (const handler of [GET, POST]) {
      const request = new NextRequest('http://localhost/api/v1/episodes/export', {
        headers: { cookie: `${SHARED_SESSION_COOKIE}=${identity.ownerToken}` },
      });
      const response = await handler(request, params);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toEqual({ status: 'ready', pdfUrl: '/existing/transcript.md' });
      expect((await handler(new NextRequest(request.url), params)).status).toBe(401);
    }
  });
  it('lets overlapping export jobs complete with one published reference', async () => {
    const episode = await source();
    const first = await admit(episode.id);
    const second = await admit(episode.id);
    await Promise.all([run(first.queued), run(second.queued)]);
    const published = await instance.database.episode.findUniqueOrThrow({
      where: { id: episode.id },
    });
    expect(published.pdfUrl).toBeTruthy();
    for (const { record } of [first, second])
      expect(
        (
          await sottoTransaction(instance.database, (tx) =>
            sottoJobOutbox(tx).receipt(record.job.id)
          )
        )?.status
      ).toBe('complete');
  });
  it('rejects publication when an unlisted episode becomes private during upload', async () => {
    const episode = await source('UNLISTED');
    const viewer = await identity.household('Viewer');
    const { queued, record } = await admit(episode.id, viewer.token);
    const write = LocalStorageWriter.prototype.writeImmutable;
    vi.spyOn(LocalStorageWriter.prototype, 'writeImmutable').mockImplementation(async function (
      this: LocalStorageWriter,
      ...args
    ) {
      await write.apply(this, args);
      await instance.database.episode.update({
        where: { id: episode.id },
        data: { visibility: 'PRIVATE' },
      });
    });
    await expect(run(queued)).rejects.toThrow('Episode not found');
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).pdfUrl
    ).toBeNull();
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(record.job.id)))
        ?.status
    ).toBe('pending');
  });
  it('honors cancellation before reusing another export publication', async () => {
    const episode = await source();
    const first = await admit(episode.id);
    const second = await admit(episode.id);
    await run(first.queued);
    const reason = new Error('Export stopped');
    await expect(
      processPdfGeneration(
        { ...second.queued, updateProgress: async () => {} },
        AbortSignal.abort(reason)
      )
    ).rejects.toBe(reason);
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).receipt(second.record.job.id)
        )
      )?.status
    ).toBe('pending');
  });
  it('admits an imported READY episode without fabricating stitching history', async () => {
    const episode = await source();
    expect(episode.lastCompletedStitchKey).toBeNull();
    const { queued } = await admit(episode.id);
    const work = await sottoTransaction(instance.database, (tx) =>
      readTranscriptExport(tx, queued)
    );
    expect(work.complete).toBe(false);
    if (work.complete) throw new Error('Expected pending work');
    expect(work.episode.transcript.segments[0].text).toBe('The original transcript');
  });
  it('delegates unlisted export without assigning the viewer ownership of the artifact', async () => {
    const viewer = await identity.household('Viewer');
    const episode = await source('UNLISTED');
    const { queued } = await admit(episode.id, viewer.token);
    const work = await sottoTransaction(instance.database, (tx) =>
      readTranscriptExport(tx, queued)
    );
    if (work.complete) throw new Error('Expected pending work');
    expect(work.payload.storage.userId).toBe(identity.ownerId);
    expect(
      work.payload.storage.scopes.some((scope) => scope.subjectId === `profile:${viewer.id}`)
    ).toBe(false);
    expect(work.scopes.some((scope) => scope.subjectId === `profile:${viewer.id}`)).toBe(true);
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { visibility: 'PRIVATE' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) => readTranscriptExport(tx, queued))
    ).rejects.toThrow('Episode not found');
  });
  it('denies a private episode to another authenticated profile', async () => {
    const viewer = await identity.household('Viewer');
    const episode = await source();
    await expect(admit(episode.id, viewer.token)).rejects.toThrow('Episode not found');
  });
  it('rejects changed transcript content before rendering', async () => {
    const episode = await source();
    const { queued } = await admit(episode.id);
    await instance.database.segment.updateMany({
      where: { episodeId: episode.id },
      data: { text: 'Changed text' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) => readTranscriptExport(tx, queued))
    ).rejects.toThrow('inputs changed');
  });
  it('rejects a substituted queue reference without changing the admitted job', async () => {
    const episode = await source();
    const { queued, record } = await admit(episode.id);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        readTranscriptExport(tx, {
          ...queued,
          data: { ...queued.data, fingerprint: '0'.repeat(64) },
        })
      )
    ).rejects.toThrow('does not match durable work');
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(record.job.id)))
        ?.complete
    ).toBe(false);
  });
  it('returns an existing export immediately under the original request authority', async () => {
    const episode = await source();
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { pdfUrl: '/existing/transcript.md' },
    });
    const original = await caller();
    expect(
      await sottoTransaction(instance.database, (tx) =>
        admitTranscriptExport(tx, {
          ...original,
          episodeId: episode.id,
          operationId: randomUUID(),
        })
      )
    ).toEqual({ kind: 'ready', pdfUrl: '/existing/transcript.md' });
  });
  it('finishes the admitted delegation after logout but rejects new admission with the old session', async () => {
    const episode = await source();
    const original = await caller();
    const { queued } = await admit(episode.id);
    await identity.access.logout(identity.ownerToken);
    expect(
      (await sottoTransaction(instance.database, (tx) => readTranscriptExport(tx, queued))).complete
    ).toBe(false);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitTranscriptExport(tx, {
          ...original,
          episodeId: episode.id,
          operationId: randomUUID(),
        })
      )
    ).rejects.toThrow('unauthorized');
  });
  it.each(['without publication', 'after relocation'] as const)(
    'cancels erased viewer work %s without adding viewer ownership',
    async (mode) => {
      const viewer = await identity.household('Viewer');
      const episode = await source('UNLISTED');
      const { queued, record } = await admit(episode.id, viewer.token);
      if (mode === 'after relocation') {
        await run((await admit(episode.id)).queued);
        const published = await instance.database.episode.findUniqueOrThrow({
          where: { id: episode.id },
        });
        await relocateStorageFixture({
          database: instance.database,
          directory,
          reference: published.pdfUrl!,
          consumers: [`episode:${episode.id}:transcript`],
          publish: (tx, reference) =>
            tx.episode.update({ where: { id: episode.id }, data: { pdfUrl: reference } }),
        });
      }
      const scope = record.job.scopes.find((item) => item.subjectId === `profile:${viewer.id}`);
      if (!scope) throw new Error('Expected viewer delegation scope');
      await sottoTransaction(instance.database, async (tx) => {
        const journal = new StorageCleanupJournal(
          {
            query: (sql, values) => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          },
          'postgres',
          SIDEDOOR_STATE_ID
        );
        await journal.createJob(prepareStorageCleanup({ namespace: SIDEDOOR_STATE_ID, ...scope }));
        await tx.user.delete({ where: { id: viewer.id } });
      });
      expect(
        await sottoTransaction(instance.database, (tx) => readTranscriptExport(tx, queued))
      ).toEqual({ complete: true });
      expect(
        (
          await sottoTransaction(instance.database, (tx) =>
            sottoJobOutbox(tx).receipt(record.job.id)
          )
        )?.status
      ).toBe('complete');
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).userId
      ).toBe(identity.ownerId);
    }
  );
});
