// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  captureIncorporation,
  commitIncorporation,
  prepareIncorporation,
  requireIncorporationAttempt,
} from '@/lib/sidedoor/jobs/stitch/incorporation';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('incorporation admission and durable enqueue', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('incorporation');
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
  });

  async function fixture() {
    const episode = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Lesson',
        topic: 'Spanish',
        status: 'READY',
        ttsProvider: 'local',
        ttsModel: 'selected-local-model',
        segments: {
          create: {
            order: 0,
            text: 'An explanation',
            speaker: 'HOST',
            startTime: 0,
            duration: 10,
            audioUrl: '/uploads/original.mp3',
          },
        },
      },
    });
    const interaction = await instance.database.interaction.create({
      data: {
        userId: identity.ownerId,
        episodeId: episode.id,
        question: 'Why?',
        answer: 'Because.',
        timestamp: 4,
        status: 'ANSWERED',
      },
    });
    const request = new Request('http://localhost/incorporate', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const admission = await sottoTransaction(instance.database, (tx) =>
      captureIncorporation(tx, request, episode.id, interaction.id)
    );
    const job = prepareIncorporation(admission, 'A generated explanation');
    const commit = () =>
      sottoTransaction(instance.database, (tx) => commitIncorporation(tx, request, admission, job));
    return { episode, interaction, request, admission, job, commit };
  }
  async function expectUnchanged(item: Awaited<ReturnType<typeof fixture>>) {
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })
    ).toMatchObject({ status: 'READY' });
    expect(
      await instance.database.interaction.findUniqueOrThrow({ where: { id: item.interaction.id } })
    ).toMatchObject({ status: 'ANSWERED', incorporated: false });
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete())
    ).toMatchObject({ jobs: [] });
  }
  it('leaves source status unchanged during generation and commits both transitions with recoverable work', async () => {
    const item = await fixture();
    await expectUnchanged(item);
    const record = await item.commit();
    expect(record.job.payload).toMatchObject({
      episodeId: item.episode.id,
      interactionId: item.interaction.id,
      newText: 'A generated explanation',
      speaker: 'HOST',
      insertAfterOrder: 0,
    });
    expect(record.job.scopes).toEqual(item.admission.storage.scopes);
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })
    ).toMatchObject({ status: 'UPDATING' });
    expect(
      await instance.database.interaction.findUniqueOrThrow({ where: { id: item.interaction.id } })
    ).toMatchObject({ status: 'INCORPORATING' });
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listPending())
    ).toMatchObject({ jobs: [{ id: item.job.id, fingerprint: record.fingerprint }] });
  });
  it('rejects revoked original credentials after generation without scheduling work', async () => {
    const item = await fixture();
    await identity.access.logout(identity.ownerToken);
    await expect(item.commit()).rejects.toMatchObject({ code: 'unauthorized' });
    await expectUnchanged(item);
  });
  it("does not admit another learner's private interaction into episode audio", async () => {
    const item = await fixture();
    const other = await identity.household('Another learner');
    await instance.database.interaction.update({
      where: { id: item.interaction.id },
      data: { userId: other.id, visibility: 'PRIVATE' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        captureIncorporation(tx, item.request, item.episode.id, item.interaction.id)
      )
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expectUnchanged(item);
    await instance.database.interaction.update({
      where: { id: item.interaction.id },
      data: { visibility: 'PUBLIC' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        captureIncorporation(tx, item.request, item.episode.id, item.interaction.id)
      )
    ).resolves.toMatchObject({ inputs: { userId: other.id } });
  });
  it.each([
    'text',
    'timing',
    'audio',
    'voice',
    'provider',
    'answer',
    'question',
    'timestamp',
    'episode-version',
  ])('rejects a concurrent %s change and preserves its source state', async (change) => {
    const item = await fixture();
    if (change === 'episode-version')
      await instance.database.episode.update({
        where: { id: item.episode.id },
        data: { audioUrl: '/api/v1/storage/newer.mp3', currentVersion: { increment: 1 } },
      });
    if (change === 'text')
      await instance.database.segment.updateMany({
        where: { episodeId: item.episode.id },
        data: { text: 'Changed explanation' },
      });
    if (change === 'timing')
      await instance.database.segment.updateMany({
        where: { episodeId: item.episode.id },
        data: { duration: 15 },
      });
    if (change === 'audio')
      await instance.database.segment.updateMany({
        where: { episodeId: item.episode.id },
        data: { audioUrl: '/uploads/replaced.mp3' },
      });
    if (change === 'voice')
      await instance.database.episodeVoice.create({
        data: {
          episodeId: item.episode.id,
          speaker: 'HOST',
          voiceId: 'different',
          provider: 'local',
        },
      });
    if (change === 'provider')
      await instance.database.episode.update({
        where: { id: item.episode.id },
        data: { ttsProvider: 'openai' },
      });
    if (change === 'answer')
      await instance.database.interaction.update({
        where: { id: item.interaction.id },
        data: { answer: 'Different answer' },
      });
    if (change === 'question')
      await instance.database.interaction.update({
        where: { id: item.interaction.id },
        data: { question: 'Another question' },
      });
    if (change === 'timestamp')
      await instance.database.interaction.update({
        where: { id: item.interaction.id },
        data: { timestamp: 12 },
      });
    await expect(item.commit()).rejects.toMatchObject({ status: 409 });
    await expectUnchanged(item);
  });
  it('rejects resolution during generation while allowing unrelated feedback', async () => {
    const item = await fixture();
    await instance.database.interaction.update({
      where: { id: item.interaction.id },
      data: { status: 'RESOLVED' },
    });
    await expect(item.commit()).rejects.toMatchObject({ status: 409 });
    await instance.database.interaction.update({
      where: { id: item.interaction.id },
      data: { status: 'ANSWERED', helpful: true },
    });
    await expect(item.commit()).resolves.toMatchObject({ complete: false });
  });
  it('rolls back the outbox and first status transition if the episode transition fails', async () => {
    const item = await fixture();
    await instance.database.$executeRawUnsafe(
      `ALTER TABLE "Episode" ADD CONSTRAINT reject_incorporation CHECK (status != 'UPDATING')`
    );
    try {
      await expect(item.commit()).rejects.toThrow();
      await expectUnchanged(item);
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "Episode" DROP CONSTRAINT reject_incorporation'
      );
    }
    await expect(item.commit()).resolves.toMatchObject({ complete: false });
  });
  it('admits only one of two concurrent incorporation requests', async () => {
    const item = await fixture();
    const second = prepareIncorporation(item.admission, 'Another generated explanation');
    const results = await Promise.allSettled([
      item.commit(),
      sottoTransaction(instance.database, (tx) =>
        commitIncorporation(tx, item.request, item.admission, second)
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete())).jobs
    ).toHaveLength(1);
  });
  it('rejects a prior attempt even when a later request has identical inputs and phase', async () => {
    const item = await fixture();
    const first = await item.commit();
    await sottoTransaction(instance.database, (tx) =>
      requireIncorporationAttempt(tx, item.interaction.id, first.job.id, first.fingerprint)
    );
    await instance.database.episode.update({
      where: { id: item.episode.id },
      data: { status: 'READY' },
    });
    await instance.database.interaction.update({
      where: { id: item.interaction.id },
      data: { status: 'ANSWERED' },
    });
    const next = prepareIncorporation(item.admission, 'A generated explanation');
    const second = await sottoTransaction(instance.database, (tx) =>
      commitIncorporation(tx, item.request, item.admission, next)
    );
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requireIncorporationAttempt(tx, item.interaction.id, first.job.id, first.fingerprint)
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requireIncorporationAttempt(tx, item.interaction.id, second.job.id, second.fingerprint)
      )
    ).resolves.toBeUndefined();
  });
  it.each(['pending', 'delivered', 'complete'])(
    'cannot reuse a %s operation to restart source transitions',
    async (state) => {
      const item = await fixture();
      const record = await item.commit();
      if (state === 'delivered')
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).acknowledgeDelivery(record.job.id, record.fingerprint)
        );
      if (state === 'complete')
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).complete(record.job.id, record.fingerprint)
        );
      await instance.database.episode.update({
        where: { id: item.episode.id },
        data: { status: 'READY' },
      });
      await instance.database.interaction.update({
        where: { id: item.interaction.id },
        data: { status: 'ANSWERED' },
      });
      await expect(item.commit()).rejects.toMatchObject({ status: 409 });
      expect(
        await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })
      ).toMatchObject({ status: 'READY' });
      expect(
        await instance.database.interaction.findUniqueOrThrow({
          where: { id: item.interaction.id },
        })
      ).toMatchObject({ status: 'ANSWERED' });
    }
  );
});
