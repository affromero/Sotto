// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';
import { createRegenerationSource } from '../../helpers/runtime/regeneration-source';
import { POST } from '@/app/api/v1/episodes/[episodeId]/interact/[interactionId]/incorporate/route';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { invalidateServerInfra } from '@/lib/server-config';
import { setSiteConfig } from '@/lib/site-config';
import { startSottoJobReconciliation } from '@/lib/sidedoor/jobs/core/job-reconciliation';
import { processSegmentRegeneration } from '@/workers/segment-regeneration.worker';
import { processAudioStitching } from '@/workers/audio-stitching.worker';
import {
  createWorker,
  withDispatchQueue,
  segmentRegenerationQueue,
  audioStitchingQueue,
  notificationQueue,
  pdfGenerationQueue,
  waveformGenerationQueue,
  episodeStatusQueue,
} from '@/lib/queue';
import { closeRedis } from '@/lib/redis';

const binding = vi.hoisted(() => {
  const configured = process.env.SIDEDOOR_TEST_REDIS_URL;
  if (configured) {
    const url = new URL(configured);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use disposable local Redis database 15');
    vi.stubEnv('REDIS_URL', configured);
  }
  return {
    database: null as PrismaClient | null,
    queuePrefix: `incorporation-${crypto.randomUUID()}`,
  };
});
// Keep real Redis delivery while isolating this worker's queues from other test schemas.
vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  return {
    ...actual,
    Queue: class extends actual.Queue {
      constructor(...args: ConstructorParameters<typeof actual.Queue>) {
        if (!args[1]) throw new Error('Test queue requires explicit connection options');
        super(args[0], { ...args[1], prefix: binding.queuePrefix });
      }
    },
    Worker: class extends actual.Worker {
      constructor(...args: ConstructorParameters<typeof actual.Worker>) {
        if (!args[2]) throw new Error('Test worker requires explicit connection options');
        super(args[0], args[1], { ...args[2], prefix: binding.queuePrefix });
      }
    },
  };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});

const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('incorporation HTTP through automatic durable workers', () => {
  let instance: SharedTestInstance;
  let directory: string;
  const queues = new Map(
    [
      segmentRegenerationQueue,
      audioStitchingQueue,
      notificationQueue,
      pdfGenerationQueue,
      waveformGenerationQueue,
      episodeStatusQueue,
    ].map((queue) => [queue.name, queue])
  );
  beforeAll(async () => {
    instance = await createSharedTestInstance('http_dispatch');
    binding.database = instance.database;
    directory = await mkdtemp(join(tmpdir(), 'sotto-http-dispatch-'));
  });
  afterAll(async () => {
    for (const queue of queues.values()) await queue.close();
    await closeRedis();
    await instance?.close();
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('turns an accepted request into published audio and durable downstream effects', async () => {
    const identity = await instance.reset();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    vi.stubEnv('DATABASE_URL', process.env.SIDEDOOR_TEST_DATABASE_URL!);
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('LOCAL_STORAGE_DIR', directory);
    vi.stubEnv('TTS_BASE_URL', 'http://tts.example.test');
    await setSiteConfig(
      {
        storageProvider: 'local',
        localStorageRoot: directory,
        ttsProvider: 'local',
        ttsBaseUrl: 'http://tts.example.test',
        ttsVoices: 'voice-a,voice-b',
      },
      identity.ownerId
    );
    invalidateServerInfra();
    const sample = join(directory, 'sample.wav');
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-ar',
      '16000',
      '-ac',
      '1',
      sample,
    ]);
    const audio = await readFile(sample);
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init);
      if (request.url === 'https://api.anthropic.com/v1/messages') {
        expect(request.headers.get('x-api-key')).toBe('test-anthropic-key');
        const { model } = (await request.json()) as { model: string };
        expect(model).toBe(getAiProviderMeta('anthropic').defaultModel);
        return Response.json({
          id: 'message',
          type: 'message',
          role: 'assistant',
          model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          content: [{ type: 'text', text: 'An explanation' }],
          usage: {
            input_tokens: 12,
            output_tokens: 4,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        });
      }
      if (request.url !== 'http://tts.example.test/tts')
        throw new Error('Unexpected external request');
      return new Response(new Uint8Array(audio));
    });
    await instance.seedAiCredential(identity.ownerId, 'anthropic', 'test-anthropic-key');
    const source = await createRegenerationSource(
      instance.database,
      identity.ownerId,
      directory,
      audio,
      true
    );
    await instance.database.episode.update({
      where: { id: source.episode.id },
      data: {
        aiModel: getAiProviderMeta('anthropic').defaultModel,
      },
    });
    const segmentWorker = createWorker('segment-regeneration', processSegmentRegeneration, {
      concurrency: 1,
    });
    const stitchWorker = createWorker('audio-stitching', processAudioStitching, { concurrency: 1 });
    const errors: unknown[] = [];
    const loop = startSottoJobReconciliation({
      database: instance.database,
      queues,
      withQueue: withDispatchQueue,
      onResults: (results) => {
        for (const result of results) if (result.status === 'failed') errors.push(result.error);
      },
      onError: (error) => {
        errors.push(error);
        return undefined;
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Automatic stitching did not finish')), 10_000);
      stitchWorker.on('completed', () => resolve());
      segmentWorker.on('failed', (...args) => reject(args[1]));
      stitchWorker.on('failed', (...args) => reject(args[1]));
    });
    const completion = completed.then(
      () => null,
      (error) => error as Error
    );
    try {
      await Promise.all([segmentWorker.waitUntilReady(), stitchWorker.waitUntilReady()]);
      const { episode, interaction } = source;
      const response = await POST(
        new NextRequest(
          `http://localhost:3000/api/v1/episodes/${episode.id}/interact/${interaction.id}/incorporate`,
          {
            method: 'POST',
            headers: {
              origin: 'http://localhost:3000',
              cookie: `sotto_session=${identity.ownerToken}`,
            },
          }
        ),
        { params: Promise.resolve({ episodeId: episode.id, interactionId: interaction.id }) }
      );
      expect(response.status).toBe(202);
      const result = await completion;
      if (result) throw result;
      await loop.stop();
      expect(errors).toEqual([]);
      const current = await instance.database.episode.findUniqueOrThrow({
        where: { id: episode.id },
      });
      expect(current).toMatchObject({ status: 'READY', currentVersion: 2 });
      expect(
        (await readFile(join(directory, current.audioUrl!.replace('/api/v1/storage/', '')))).length
      ).toBeGreaterThan(0);
      expect(await instance.database.segment.count({ where: { episodeId: episode.id } })).toBe(3);
      expect(
        await instance.database.interaction.findUniqueOrThrow({ where: { id: interaction.id } })
      ).toMatchObject({ status: 'INCORPORATED', incorporated: true });
      const effects = await instance.database.$queryRawUnsafe<Array<{ handler: string }>>(
        `SELECT state->'job'->>'handler' AS handler FROM "SidedoorState" WHERE state->>'kind' = 'outbox_job' AND state->>'complete' = 'false'`
      );
      expect(effects.map((effect) => effect.handler).sort()).toEqual([
        'episode-status',
        'notifications',
        'pdf-generation',
        'waveform-generation',
      ]);
    } finally {
      clearTimeout(timer);
      await loop.stop();
      await Promise.all([segmentWorker.close(), stitchWorker.close()]);
      const records = await instance.database.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT state->'job'->>'id' AS id FROM "SidedoorState" WHERE state->>'kind' = 'outbox_job'`
      );
      for (const record of records)
        for (const queue of queues.values()) await (await queue.getJob(record.id))?.remove();
    }
  });
});
