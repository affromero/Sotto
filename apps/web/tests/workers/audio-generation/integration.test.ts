// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { processAudioGeneration } from '@/workers/audio-generation.worker';
import { audioGenerationQueue, audioStitchingQueue, type GenerateAudioPayload } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import { invalidateServerInfra } from '@/lib/server-config';
import { setSiteConfig } from '@/lib/site-config';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { initialStitchPayloadSchema } from '@/lib/sidedoor/jobs/initial/initial-stitch-contract';
import { markEpisodeFailed } from '@/lib/pipeline-resume';
import { processAudioStitching } from '@/workers/audio-stitching.worker';
import { verifyCurrentInitialStitch } from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const binding = vi.hoisted(() => {
  const configured = process.env.SIDEDOOR_TEST_REDIS_URL;
  if (configured) {
    const url = new URL(configured);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/15')
      throw new Error('Use isolated Redis 15');
    vi.stubEnv('REDIS_URL', configured);
  }
  return {
    database: null as PrismaClient | null,
    loseSegment: null as string | null,
    afterLostCommit: null as (() => Promise<void>) | null,
    lostHookError: null as unknown,
  };
});
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = new Proxy(prismaTestBoundary(binding), {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== '$transaction') return value;
      return async (...args: unknown[]) => {
        const result: unknown = await Reflect.apply(value, target, args);
        if (binding.loseSegment) {
          const segment = await binding.database!.segment.findUnique({
            where: { id: binding.loseSegment },
            select: { audioUrl: true },
          });
          if (segment?.audioUrl) {
            binding.loseSegment = null;
            try {
              await binding.afterLostCommit?.();
            } catch (error) {
              binding.lostHookError = error;
              throw error;
            }
            throw new Error('Lost response after committed segment publication');
          }
        }
        return result;
      };
    },
  });
  return { prisma: database, prismaUnfiltered: database };
});

const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('audio generation through real transactions, local storage and Redis', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  let duringSpeech: (() => Promise<void>) | null;
  let requests: Array<Record<string, unknown>>;
  let speechStatus: number;
  let episodes: string[];
  const audio = Buffer.alloc(44 + 32000);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(32000, 40);
  beforeAll(async () => {
    instance = await createSharedTestInstance('audio_worker');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'sotto-audio-worker-test-key');
    vi.stubEnv('REDIS_URL', process.env.SIDEDOOR_TEST_REDIS_URL!);
    vi.stubEnv('TTS_BASE_URL', 'http://tts.example.test');
    directory = await mkdtemp(join(tmpdir(), 'sotto-audio-worker-'));
    identity = await instance.reset();
    await setSiteConfig(
      {
        storageProvider: 'local',
        localStorageRoot: directory,
        ttsProvider: 'local',
        ttsBaseUrl: 'http://tts.example.test',
        ttsVoices: 'host-voice,expert-voice',
      },
      identity.ownerId
    );
    invalidateServerInfra();
    duringSpeech = null;
    speechStatus = 200;
    requests = [];
    episodes = [];
    binding.loseSegment = null;
    binding.afterLostCommit = null;
    binding.lostHookError = null;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init);
      if (request.url === 'https://api.elevenlabs.io/v1/user/subscription')
        return new Response('{}', { headers: { 'maximum-concurrent-requests': '5' } });
      if (request.url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
        requests.push({
          ...((await request.json()) as Record<string, unknown>),
          voice: new URL(request.url).pathname.split('/')[3],
        });
        return Response.json({
          audio_base64: audio.toString('base64'),
          alignment: {
            characters: ['H', 'o', 'l', 'a'],
            character_start_times_seconds: [0, 0.1, 0.2, 0.3],
            character_end_times_seconds: [0.1, 0.2, 0.3, 0.4],
          },
        });
      }
      if (request.url !== 'http://tts.example.test/tts')
        throw new Error(`Unexpected HTTP request: ${request.url}`);
      requests.push((await request.json()) as Record<string, unknown>);
      await duringSpeech?.();
      return new Response(
        speechStatus === 200 ? new Uint8Array(audio) : 'Unsupported custom model',
        {
          status: speechStatus,
          headers: { 'content-type': 'audio/wav' },
        }
      );
    });
  });
  afterEach(async () => {
    for (const episodeId of episodes)
      for (const entry of await queuedStitches(episodeId)) await entry.job.remove();
    for (const queue of [audioGenerationQueue, audioStitchingQueue]) {
      for (const job of await queue.getJobs(['wait', 'delayed', 'prioritized']))
        if (episodes.includes(String(job.data.episodeId))) await job.remove();
    }
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  async function queuedStitches(episodeId: string) {
    const result = [];
    for (const job of await audioStitchingQueue.getJobs(['wait', 'delayed', 'prioritized'])) {
      if (job.name !== 'audio-stitching.v2') continue;
      const record = await sottoTransaction(instance.database, (tx) =>
        sottoJobOutbox(tx).read(job.data.operationId)
      );
      if (!record) continue;
      const payload = initialStitchPayloadSchema.parse(record.job.payload);
      if (payload.inputs.episodeId === episodeId) {
        expect(job.data).toEqual({ operationId: record.job.id, fingerprint: record.fingerprint });
        result.push({ job, payload });
      }
    }
    return result;
  }
  afterAll(async () => {
    await audioStitchingQueue.close();
    await audioGenerationQueue.close();
    await closeRedis();
    binding.database = null;
    await instance?.close();
  });
  async function fixture(id?: string) {
    const episode = await instance.database.episode.create({
      data: {
        id,
        userId: identity.ownerId,
        title: 'Lesson',
        topic: 'Learning',
        status: 'GENERATING_AUDIO',
        audioGenerationKey: randomUUID(),
        language: 'es',
        ttsProvider: 'local',
        ttsModel: 'test-model',
      },
    });
    episodes.push(episode.id);
    const segment = await instance.database.segment.create({
      data: { episodeId: episode.id, speaker: 'HOST', text: 'Hola mundo.', order: 0 },
    });
    const data: GenerateAudioPayload = {
      episodeId: episode.id,
      audioGenerationKey: episode.audioGenerationKey!,
      segmentId: segment.id,
      segmentVersion: segment.version,
      speaker: segment.speaker,
      text: segment.text,
    };
    const job: Job<GenerateAudioPayload> = await audioGenerationQueue.add('generate_audio', data);
    return { episode, segment, job };
  }
  it.each(['attempt', 'version'] as const)(
    'rejects a stale %s before requesting speech',
    async (change) => {
      const { episode, segment, job } = await fixture();
      if (change === 'attempt')
        await instance.database.episode.update({
          where: { id: episode.id },
          data: { audioGenerationKey: randomUUID() },
        });
      else
        await instance.database.segment.update({
          where: { id: segment.id },
          data: { version: { increment: 1 } },
        });
      await processAudioGeneration(job);
      expect(requests).toEqual([]);
      expect(
        (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })).audioUrl
      ).toBeNull();
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).status
      ).toBe('GENERATING_AUDIO');
    }
  );

  it('retains unreferenced write attribution when the segment commit fails', async () => {
    const { episode, segment, job } = await fixture();
    await instance.database.$executeRawUnsafe(
      'ALTER TABLE "Segment" ADD CONSTRAINT reject_audio_publication CHECK ("audioUrl" IS NULL)'
    );
    try {
      await expect(processAudioGeneration(job)).rejects.toThrow();
      expect(requests).toHaveLength(1);
      expect(
        (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })).audioUrl
      ).toBeNull();
      const writes = await instance.database.$queryRawUnsafe<{ outcome: string; status: string }[]>(
        `SELECT state->>'outcome' AS outcome, state->>'status' AS status FROM "SidedoorState" WHERE state->>'kind' = 'write'`
      );
      expect(writes).toHaveLength(3);
      expect(
        writes.every((write) => write.status === 'settled' && write.outcome === 'unreferenced')
      ).toBe(true);
      expect(
        (await audioStitchingQueue.getJobs(['wait', 'prioritized'])).filter(
          (queued) => queued.data.episodeId === episode.id
        )
      ).toEqual([]);
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).status
      ).toBe('GENERATING_AUDIO');
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "Segment" DROP CONSTRAINT reject_audio_publication'
      );
    }
  });

  it.each(['provider', 'storage'] as const)(
    'fails before speech when required %s configuration is unavailable',
    async (missing) => {
      const { episode, job } = await fixture();
      if (missing === 'provider') {
        await instance.database.episode.update({
          where: { id: episode.id },
          data: { ttsProvider: null },
        });
      } else {
        const blocked = join(directory, 'not-a-directory');
        await writeFile(blocked, 'existing file');
        await setSiteConfig({ localStorageRoot: blocked }, identity.ownerId);
        invalidateServerInfra();
      }
      await expect(processAudioGeneration(job)).rejects.toThrow();
      expect(requests).toEqual([]);
    }
  );

  it.each(['HOST', 'EXPERT'])(
    'uses the saved %s voice for the selected provider',
    async (speaker) => {
      const { episode, segment, job } = await fixture();
      await instance.database.segment.update({ where: { id: segment.id }, data: { speaker } });
      await job.updateData({ ...job.data, speaker });
      await instance.database.episodeVoice.create({
        data: {
          episodeId: episode.id,
          speaker,
          provider: 'local',
          voiceId: 'custom-selected-voice',
        },
      });
      await processAudioGeneration(job);
      expect(requests).toEqual([expect.objectContaining({ voice: 'custom-selected-voice' })]);
    }
  );

  it('replaces a voice belonging to another provider with a voice from the selected provider', async () => {
    const { episode, job } = await fixture();
    await instance.database.episodeVoice.create({
      data: {
        episodeId: episode.id,
        speaker: 'HOST',
        provider: 'openai',
        voiceId: 'foreign-provider-voice',
      },
    });
    await processAudioGeneration(job);
    const voice = await instance.database.episodeVoice.findUniqueOrThrow({
      where: { episodeId_speaker: { episodeId: episode.id, speaker: 'HOST' } },
    });
    expect(voice.provider).toBe('local');
    expect(['host-voice', 'expert-voice']).toContain(voice.voiceId);
    expect(requests).toEqual([expect.objectContaining({ voice: voice.voiceId })]);
  });

  it('forwards surrounding context and delivery direction to a hosted speech provider', async () => {
    const { episode, segment, job } = await fixture();
    await instance.seedProfileCredential(identity.ownerId, 'tts', 'elevenlabs', {
      apiKey: `test-${randomUUID()}`,
    });
    await instance.database.episode.update({
      where: { id: episode.id },
      data: {
        ttsProvider: 'elevenlabs',
        ttsModel: 'eleven_multilingual_v2',
      },
    });
    await instance.database.episodeVoice.create({
      data: {
        episodeId: episode.id,
        speaker: 'HOST',
        provider: 'elevenlabs',
        voiceId: 'configured-host',
      },
    });
    await job.updateData({
      ...job.data,
      previousText: 'Previous sentence.',
      nextText: 'Next sentence.',
      direction: 'whispering',
    });
    await processAudioGeneration(job);
    expect(requests).toEqual([
      expect.objectContaining({
        previous_text: 'Previous sentence.',
        next_text: 'Next sentence.',
        language_code: 'es',
        model_id: 'eleven_multilingual_v2',
        text: expect.stringContaining('[whispers]'),
      }),
    ]);
    expect(
      (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })).wordTimings
    ).toEqual([{ word: 'Hola', start: 0, end: 0.4 }]);
  });

  it('lets explicit tone override script inference for the same episode', async () => {
    const { episode, segment, job } = await fixture('tone-precedence-fixture');
    await instance.seedProfileCredential(identity.ownerId, 'tts', 'elevenlabs', {
      apiKey: `test-${randomUUID()}`,
    });
    await instance.database.episode.update({
      where: { id: episode.id },
      data: { ttsProvider: 'elevenlabs', ttsModel: 'eleven_multilingual_v2' },
    });
    await instance.database.script.create({
      data: {
        episodeId: episode.id,
        markdown: 'Script',
        turns: [
          { speaker: 'HOST', text: 'Hola mundo.', direction: 'excited playful enthusiastic' },
        ],
      },
    });
    await processAudioGeneration(job);
    const casualVoice = requests[0]?.voice;
    async function restart() {
      const audioGenerationKey = randomUUID();
      await instance.database.episode.update({
        where: { id: episode.id },
        data: { status: 'GENERATING_AUDIO', audioGenerationKey },
      });
      await instance.database.segment.update({
        where: { id: segment.id },
        data: { audioUrl: null },
      });
      await instance.database.episodeVoice.deleteMany({ where: { episodeId: episode.id } });
      await job.updateData({ ...job.data, audioGenerationKey });
    }
    await restart();
    await instance.database.discovery.create({
      data: {
        episodeId: episode.id,
        userId: identity.ownerId,
        focusAreas: [],
        tone: 'professional',
      },
    });
    await processAudioGeneration(job);
    const explicitVoice = requests[1]?.voice;
    expect(explicitVoice).not.toBe(casualVoice);
    await restart();
    await instance.database.discovery.delete({ where: { episodeId: episode.id } });
    await instance.database.script.update({
      where: { episodeId: episode.id },
      data: {
        turns: [{ speaker: 'HOST', text: 'Hola mundo.', direction: 'serious academic formal' }],
      },
    });
    await processAudioGeneration(job);
    expect(requests).toHaveLength(3);
    expect(requests[2]?.voice).toBe(explicitVoice);
  });

  it('publishes valid audio when optional voice assignment persistence fails', async () => {
    const { episode, segment, job } = await fixture();
    await instance.database.$executeRawUnsafe(
      'ALTER TABLE "EpisodeVoice" ADD CONSTRAINT reject_voice_assignment CHECK (false)'
    );
    try {
      await processAudioGeneration(job);
      expect(requests).toHaveLength(1);
      expect(
        (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })).audioUrl
      ).not.toBeNull();
      expect(
        await instance.database.episodeVoice.findMany({ where: { episodeId: episode.id } })
      ).toEqual([]);
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).status
      ).toBe('STITCHING');
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "EpisodeVoice" DROP CONSTRAINT reject_voice_assignment'
      );
    }
  });

  it.each(['generating', 'stitching', 'ready', 'superseded'] as const)(
    'reconciles a lost segment commit response while the generation is %s',
    async (state) => {
      const { episode, segment, job } = await fixture();
      if (state === 'generating')
        await instance.database.segment.create({
          data: {
            episodeId: episode.id,
            speaker: 'EXPERT',
            text: 'Pending speech',
            order: 1,
          },
        });
      binding.loseSegment = segment.id;
      binding.afterLostCommit = async () => {
        if (state === 'superseded')
          await instance.database.episode.update({
            where: { id: episode.id },
            data: { audioGenerationKey: randomUUID() },
          });
        if (state !== 'ready') return;
        const { record } = await sottoTransaction(instance.database, (tx) =>
          verifyCurrentInitialStitch(
            tx,
            async () => ({ userId: identity.ownerId }),
            episode.id,
            job.data.audioGenerationKey
          )
        );
        await processAudioStitching({
          id: record.job.id,
          name: 'audio-stitching.v2',
          data: { operationId: record.job.id, fingerprint: record.fingerprint },
          updateProgress: (progress) => job.updateProgress(progress),
        });
      };
      if (state === 'superseded')
        await expect(processAudioGeneration(job)).rejects.toThrow(
          'Storage publication outcome could not be reconciled'
        );
      else await processAudioGeneration(job);
      if (binding.lostHookError) throw binding.lostHookError;
      expect(binding.loseSegment).toBeNull();
      expect(requests).toHaveLength(1);
      expect(
        (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })).audioUrl
      ).not.toBeNull();
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).status
      ).toBe(
        state === 'generating' ? 'GENERATING_AUDIO' : state === 'ready' ? 'READY' : 'STITCHING'
      );
    }
  );

  it.each(['published', 'new-generation', 'changed-speaker', 'unpublished'] as const)(
    'fences terminal generation failure for an %s segment',
    async (state) => {
      const { episode, segment, job } = await fixture();
      if (state === 'published') await processAudioGeneration(job);
      if (state === 'new-generation')
        await instance.database.episode.update({
          where: { id: episode.id },
          data: { audioGenerationKey: randomUUID() },
        });
      if (state === 'changed-speaker')
        await instance.database.segment.update({
          where: { id: segment.id },
          data: { speaker: 'EXPERT' },
        });
      const changed = await markEpisodeFailed(episode.id, {
        failureReason: 'Generation failed',
        audioGeneration: {
          generationKey: job.data.audioGenerationKey,
          segmentId: segment.id,
          segmentVersion: segment.version,
          text: segment.text,
          speaker: segment.speaker,
        },
      });
      expect(changed).toBe(state === 'unpublished');
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).status
      ).toBe(
        state === 'unpublished'
          ? 'FAILED'
          : state === 'published'
            ? 'STITCHING'
            : 'GENERATING_AUDIO'
      );
    }
  );

  it('stores the exact generated bytes, measured duration, usage and stitching work', async () => {
    const { episode, segment, job } = await fixture();
    await processAudioGeneration(job);
    const stored = await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } });
    expect((await audioGenerationQueue.getJob(job.id!))?.progress).toBe(100);
    expect(stored.audioUrl).toMatch(/^\/api\/v1\/storage\/episodes\//);
    expect(
      await readFile(join(directory, stored.audioUrl!.replace('/api/v1/storage/', '')))
    ).toEqual(audio);
    expect(stored.duration).toBe(1);
    expect(requests).toEqual([
      expect.objectContaining({ text: 'Hola mundo.', language: 'es', model: 'test-model' }),
    ]);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).status
    ).toBe('STITCHING');
    expect(await queuedStitches(episode.id)).toHaveLength(1);
    await processAudioGeneration(job);
    expect(requests).toHaveLength(1);
    expect(await queuedStitches(episode.id)).toHaveLength(1);
    await expect
      .poll(() =>
        instance.database.apiUsageLog.findFirst({
          where: { episodeId: episode.id, category: 'audio_generation' },
        })
      )
      .toMatchObject({ service: 'local', userId: identity.ownerId });
  });
  it('honors a segment model and voice override in the actual provider request', async () => {
    const { episode, segment, job } = await fixture();
    await instance.database.segment.update({
      where: { id: segment.id },
      data: {
        ttsProvider: 'local',
        ttsModel: 'segment-model',
        ttsVoiceId: 'selected-voice',
      },
    });
    await processAudioGeneration(job);
    expect(requests).toEqual([
      expect.objectContaining({ model: 'segment-model', voice: 'selected-voice' }),
    ]);
    expect(
      await instance.database.episodeVoice.findUnique({
        where: { episodeId_speaker: { episodeId: episode.id, speaker: 'HOST' } },
      })
    ).toMatchObject({ provider: 'local', voiceId: 'selected-voice' });
  });

  it('waits for remaining segments and reuses existing audio on repeated jobs', async () => {
    const { episode, segment, job } = await fixture();
    const second = await instance.database.segment.create({
      data: {
        episodeId: episode.id,
        speaker: 'EXPERT',
        text: 'Otra frase.',
        order: 1,
      },
    });
    await processAudioGeneration(job);
    const firstUrl = (
      await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })
    ).audioUrl;
    await processAudioGeneration(job);
    expect(requests).toHaveLength(1);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).status
    ).toBe('GENERATING_AUDIO');
    const next: Job<GenerateAudioPayload> = await audioGenerationQueue.add('generate_audio', {
      ...job.data,
      segmentId: second.id,
      segmentVersion: second.version,
      text: second.text,
      speaker: second.speaker,
    });
    await processAudioGeneration(next);
    const queued = await queuedStitches(episode.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.payload.inputs.segments).toMatchObject([
      { id: segment.id, audioUrl: firstUrl },
      { id: second.id, audioUrl: expect.any(String) },
    ]);
    expect(
      (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })).audioUrl
    ).toBe(firstUrl);
  });

  it('surfaces the configured sidecar model error without trying another model', async () => {
    const { segment, job } = await fixture();
    speechStatus = 422;
    await expect(processAudioGeneration(job)).rejects.toThrow(
      'Local TTS sidecar error (422): Unsupported custom model'
    );
    expect(requests).toEqual([expect.objectContaining({ model: 'test-model' })]);
    expect(
      (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })).audioUrl
    ).toBeNull();
  });

  it('writes back an unspecified resolved model without discarding valid audio', async () => {
    const { episode, segment, job } = await fixture();
    await instance.database.episode.update({ where: { id: episode.id }, data: { ttsModel: null } });
    await processAudioGeneration(job);
    expect(
      (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).ttsModel
    ).toBe('local');
    expect(
      (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })).audioUrl
    ).not.toBeNull();
  });

  it.each(['attempt', 'text', 'voice', 'owner'] as const)(
    'discards speech after %s changes during generation',
    async (change) => {
      const { episode, segment, job } = await fixture();
      const other = change === 'owner' ? await identity.household('Other learner') : null;
      duringSpeech = async () => {
        if (change === 'text') {
          await instance.database.segment.update({
            where: { id: segment.id },
            data: { text: 'Changed script' },
          });
          return;
        }
        if (change === 'voice') {
          await instance.database.episodeVoice.update({
            where: { episodeId_speaker: { episodeId: episode.id, speaker: 'HOST' } },
            data: { voiceId: 'new-selected-voice' },
          });
          return;
        }
        await instance.database.episode.update({
          where: { id: episode.id },
          data: other ? { userId: other.id } : { audioGenerationKey: randomUUID() },
        });
      };
      await processAudioGeneration(job);
      expect(
        (await instance.database.segment.findUniqueOrThrow({ where: { id: segment.id } })).audioUrl
      ).toBeNull();
      expect(
        (await instance.database.episode.findUniqueOrThrow({ where: { id: episode.id } })).status
      ).toBe('GENERATING_AUDIO');
    }
  );
});
