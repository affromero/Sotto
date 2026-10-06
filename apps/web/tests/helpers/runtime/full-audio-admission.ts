import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import {
  audioGenerationQueue,
  createQueue,
  createWorker,
  type GenerateAudioPayload,
} from '@/lib/queue';
import { processAudioGeneration } from '@/workers/audio-generation.worker';
import { setSiteConfig } from '@/lib/site-config';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { getSttProviderMeta } from '@/lib/providers/stt-registry';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  resolveSottoRequest,
  requireOriginalSottoAdmission,
} from '@/lib/sidedoor/access/core/request-identity';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { admitDurableQueueJob } from '@/lib/sidedoor/jobs/core/durable-queue';
import {
  registerPreparationAudio,
  validatePreparationAudio,
} from '@/lib/classes/preparation-audio';
import {
  requestPracticePreparation,
  readPracticePreparation,
  practicePreparationGrant,
} from '@/lib/practice/preparation';
import type { SharedTestInstance, SharedTestIdentity } from '../setup/shared-instance';

/** Exercise the production worker envelope and encrypted FULL speech authorization. */
export async function publishesFullPracticeAudio(options: {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  directory: string;
  audio: Buffer;
  episodes: string[];
  useDatabase: (database: PrismaClient) => void;
  queuedStitches: (episodeId: string) => Promise<unknown[]>;
}) {
  const { instance, identity, directory, audio } = options;
  const database = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: process.env.SIDEDOOR_TEST_DATABASE_URL!,
        max: 10,
        connectionTimeoutMillis: 30_000,
        options: `-c search_path=${instance.schema},public`,
      },
      { schema: instance.schema }
    ),
  });
  options.useDatabase(database);
  vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
  const requests: Array<{ text: string; voice: string }> = [];
  let activeRequests = 0;
  let peakRequests = 0;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url !== 'https://api.cartesia.ai/tts/bytes')
      throw new Error(`Unexpected provider request: ${request.url}`);
    const body = (await request.json()) as { transcript: string; voice: { id: string } };
    requests.push({ text: body.transcript, voice: body.voice.id });
    activeRequests++;
    peakRequests = Math.max(peakRequests, activeRequests);
    try {
      await delay(100, undefined, { signal: request.signal });
      return new Response(new Uint8Array(audio), { headers: { 'content-type': 'audio/wav' } });
    } finally {
      activeRequests--;
    }
  });
  let worker: ReturnType<typeof createWorker<GenerateAudioPayload>> | undefined;
  const parentQueue = createQueue('practice-preparation');
  const jobs: Array<Awaited<ReturnType<typeof audioGenerationQueue.add>>> = [];
  let parentJob: Awaited<ReturnType<typeof audioGenerationQueue.add>> | undefined;
  try {
    await setSiteConfig(
      {
        aiProvider: 'local',
        aiModel: 'audio-fixture',
        aiBaseUrl: 'http://ai.example.test/v1',
        ttsProvider: 'cartesia',
        sttProvider: 'openai',
      },
      identity.ownerId
    );
    await instance.seedProfileCredential(identity.ownerId, 'tts', 'cartesia', {
      apiKey: 'private-cartesia-audio-fixture',
    });
    await instance.seedProfileCredential(identity.ownerId, 'stt', 'openai', {
      apiKey: 'private-stt-audio-fixture',
    });
    const ttsModel = getProviderMeta('cartesia').defaultModel;
    await database.user.update({
      where: { id: identity.ownerId },
      data: {
        preferredAiProvider: 'local',
        preferredAiModel: 'local:audio-fixture',
        preferredTtsProvider: 'cartesia',
        preferredTtsModel: `cartesia:${ttsModel}`,
        preferredSttModel: `openai:${getSttProviderMeta('openai').defaultModel}`,
      },
    });
    const curriculum = await database.curriculum.create({
      data: { nativeLang: 'en', targetLang: 'de', title: 'Audio admission' },
    });
    const course = await database.course.create({
      data: {
        userId: identity.ownerId,
        nativeLang: 'en',
        targetLang: 'de',
        currentLevel: 'A2',
        curriculumId: curriculum.id,
      },
    });
    await database.lesson.create({
      data: {
        curriculumId: curriculum.id,
        slug: 'completed-activities',
        order: 1,
        level: 'A2',
        title: 'Recent experiences',
        objective: 'Describe completed activities.',
        grammarPoints: ['present-perfect'],
        targetVocab: [{ lemma: 'besucht', gloss: 'visited' }],
        vocabThemes: ['travel'],
      },
    });
    const request = new Request('http://localhost', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    const original = await sottoTransaction(database, (tx) => resolveSottoRequest(tx, request));
    if (!original || original.kind !== 'content') throw new Error('Missing learner admission');
    const execution = {
      userId: original.userId,
      signal: request.signal,
      authorize: async (tx: Parameters<typeof requireOriginalSottoAdmission>[0]) => {
        await requireOriginalSottoAdmission(tx, request, original);
        return { userId: original.userId };
      },
    };
    const operation = await requestPracticePreparation(course.id, 'FULL', execution);
    const parent = await sottoTransaction(database, (tx) => sottoJobOutbox(tx).read(operation.id));
    parentJob = await parentQueue.getJob(operation.id);
    const episode = await database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Full listening',
        topic: 'Recent experiences',
        status: 'GENERATING_AUDIO',
        audioGenerationKey: randomUUID(),
        language: 'de',
        ttsProvider: 'cartesia',
        ttsModel,
      },
    });
    options.episodes.push(episode.id);
    await database.practiceSession.update({
      where: { id: operation.sessionId },
      data: {
        episodeId: episode.id,
        generationState: { ...operation, status: 'RUNNING' },
      },
    });
    await sottoTransaction(database, async (tx) => {
      await registerPreparationAudio(
        tx,
        operation,
        episode.id,
        episode.audioGenerationKey!,
        'practice'
      );
      const linked = await readPracticePreparation(tx, operation.sessionId);
      await tx.practiceSession.update({
        where: { id: operation.sessionId },
        data: {
          status: 'ACTIVE',
          generationState: { ...linked.operation, status: 'COMPLETED' },
        },
      });
      await practicePreparationGrant(tx, operation).complete(operation.grant);
      await sottoJobOutbox(tx).complete(operation.id, parent!.fingerprint);
    });
    await database.segment.createMany({
      data: Array.from({ length: 26 }, (_, order) => ({
        episodeId: episode.id,
        order,
        speaker: order % 2 ? 'EXPERT' : 'HOST',
        text: `Gestern habe ich ${order + 1} Freunde besucht.`,
      })),
    });
    const segments = await database.segment.findMany({
      where: { episodeId: episode.id },
      orderBy: { order: 'asc' },
    });
    for (const segment of segments)
      jobs.push(
        await admitDurableQueueJob({
          queue: audioGenerationQueue,
          type: 'generate_audio',
          jobId: segment.id,
          attempts: 1,
          payload: {
            episodeId: episode.id,
            audioGenerationKey: episode.audioGenerationKey!,
            segmentId: segment.id,
            segmentVersion: segment.version,
            speaker: segment.speaker,
            text: segment.text,
          },
          authorize: async (tx) => {
            await validatePreparationAudio(tx, episode.id, episode.audioGenerationKey!);
            return { userId: identity.ownerId };
          },
          mutate: async () => {},
        })
      );
    const failures: string[] = [];
    worker = createWorker('audio-generation', processAudioGeneration, { concurrency: 15 });
    worker.on('failed', (job, error) =>
      failures.push(`${job?.id}: ${error.stack ?? error.message}`)
    );
    await worker.waitUntilReady();
    const deadline = Date.now() + 60_000;
    let states: string[] = [];
    do {
      states = await Promise.all(jobs.map((job) => job.getState()));
      if (states.every((state) => state === 'completed' || state === 'failed')) break;
      await delay(50);
    } while (Date.now() < deadline);
    await worker.close();
    worker = undefined;
    expect(failures).toEqual([]);
    expect(states).toEqual(Array.from({ length: 26 }, () => 'completed'));
    const saved = await database.segment.findMany({ where: { episodeId: episode.id } });
    expect(saved.map((segment) => segment.id).sort()).toEqual(
      segments.map((segment) => segment.id).sort()
    );
    expect(saved.every((segment) => !!segment.audioUrl)).toBe(true);
    expect(requests.map((item) => item.text).sort()).toEqual(
      segments.map((segment) => segment.text).sort()
    );
    expect(peakRequests).toBeLessThanOrEqual(2);
    const voices = await database.episodeVoice.findMany({ where: { episodeId: episode.id } });
    expect(voices).toHaveLength(2);
    for (const segment of saved)
      expect(requests.find((item) => item.text === segment.text)?.voice).toBe(
        voices.find((voice) => voice.speaker === segment.speaker)?.voiceId
      );
    expect(await options.queuedStitches(episode.id)).toHaveLength(1);
    for (const job of jobs)
      await sottoTransaction(database, async (tx) => {
        const record = await sottoJobOutbox(tx).read(job.id!);
        expect(record?.complete).toBe(true);
        expect(
          await sottoJobExecutions(tx).blockingStatus(job.id!, record!.fingerprint)
        ).toBeNull();
      });
  } finally {
    await worker?.close();
    for (const job of jobs) await job.remove();
    await parentJob?.remove();
    await parentQueue.close();
    options.useDatabase(instance.database);
    await database.$disconnect();
  }
}
