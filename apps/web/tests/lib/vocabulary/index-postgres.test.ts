// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { AIOptions, AIResponse, ChatMessage } from '@/lib/providers/ai';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { createQueue, createWorker } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import { importCourseMaterials, attachCourseMaterials } from '@/lib/course-materials';
import { authenticateRequest } from '@/lib/api-keys';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { requestMaterialVocabularyIndex } from '@/lib/vocabulary/index-admission';
import { readDictionary } from '@/lib/vocabulary/dictionary';
import { processVocabularyIndex } from '@/workers/vocabulary/index.worker';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  vocabularyIndexPayloadSchema,
  vocabularyIndexOperationSchema,
  vocabularyIndexGrant,
} from '@/lib/vocabulary/index-state';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/providers/ai', async (original) => {
  const actual = await original<typeof import('@/lib/providers/ai')>();
  return {
    ...actual,
    createAIProvider: () => ({
      generateResponse: async (
        _system: string,
        messages: ChatMessage[],
        options?: AIOptions
      ): Promise<AIResponse> => {
        if (!options?.fetch) throw new Error('Fixture must use the captured provider transport.');
        const response = await options.fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKeyOverride}`,
          },
          body: JSON.stringify({
            name: options.jsonSchema?.name,
            payload: messages[0]!.content,
            model: options.model,
          }),
        });
        return response.json() as Promise<AIResponse>;
      },
    }),
  };
});
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));

const entries = [
  ['Bahnhof', 'station'],
  ['Fahrkarte', 'ticket'],
  ['Bäckerei', 'bakery'],
  ['Rechnung', 'bill'],
  ['Wohnung', 'apartment'],
  ['Schlüssel', 'key'],
  ['Fenster', 'window'],
  ['Treppe', 'stairs'],
  ['Wetter', 'weather'],
  ['Wolke', 'cloud'],
  ['Sonne', 'sun'],
  ['Regen', 'rain'],
  ['Termin', 'appointment'],
  ['Arbeit', 'work'],
  ['Urlaub', 'vacation'],
  ['Reise', 'journey'],
  ['Freundschaft', 'friendship'],
  ['Hoffnung', 'hope'],
  ['Erinnerung', 'memory'],
  ['Weltanschauung', 'worldview'],
] as const;
const meanings = new Map<string, string>(entries);
const suite =
  process.env.SIDEDOOR_TEST_DATABASE_URL && process.env.SIDEDOOR_TEST_REDIS_URL
    ? describe
    : describe.skip;
suite('complete material vocabulary with durable source coverage', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  let root: string;
  let worker: Worker | undefined;
  let requests: string[];
  let failTransport: boolean;
  let rejectLargeCoverage: boolean;
  let rejectMetadata: boolean;
  let beforeModel: (() => Promise<void>) | null;
  const queue = () => createQueue('vocabulary-index');
  const incoming = () =>
    new Request('http://localhost/api/v1/materials', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie: `sotto_session=${identity.ownerToken}` },
    });
  async function authority() {
    const request = incoming();
    const actor = await authenticateRequest(request);
    if (!actor) throw new Error('Missing fixture admission');
    return { request, actor, execution: sottoRequestExecution(request, actor) };
  }
  async function upload(text: string, attached = true) {
    const { request, actor } = await authority();
    const result = await importCourseMaterials(
      request,
      actor,
      [new File([text], 'Deutsch.txt', { type: 'text/plain' })],
      attached ? courseId : undefined
    );
    expect(result.failed).toBe(0);
    return result.materials[0]!;
  }
  async function startWorker(revokeBeforeClaim = false) {
    if (revokeBeforeClaim) {
      worker = createWorker(
        'vocabulary-index',
        async (job, signal) => {
          const payload = vocabularyIndexPayloadSchema.parse(job.data);
          if (payload.phase === 'CHUNK')
            await sottoTransaction(instance.database, async (database) => {
              const chunk = await database.vocabularyIndexChunk.findUniqueOrThrow({
                where: { id: payload.chunkId },
              });
              const operation = vocabularyIndexOperationSchema.parse(chunk.operation);
              await vocabularyIndexGrant(database, operation).revoke(operation.grant);
            });
          return processVocabularyIndex(job, signal);
        },
        { concurrency: 2 }
      );
      await worker.waitUntilReady();
      return;
    }
    worker = createWorker('vocabulary-index', processVocabularyIndex, { concurrency: 2 });
    await worker.waitUntilReady();
  }
  async function index(materialId: string, retry = false) {
    return requestMaterialVocabularyIndex(materialId, (await authority()).execution, retry);
  }
  async function waitForIndex(materialId: string, status = 'COMPLETE') {
    await expect
      .poll(
        async () =>
          (
            await instance.database.materialVocabularyIndex.findFirst({
              where: { materialId },
              orderBy: { createdAt: 'desc' },
            })
          )?.status,
        { timeout: 30000, interval: 100 }
      )
      .toBe(status);
  }

  it('reports a queued grant rejection as a retryable import failure without model calls', async () => {
    const material = await upload('Bahnhof = station');
    await startWorker(true);
    await index(material.id);
    await waitForIndex(material.id, 'FAILED');
    expect(requests).toEqual([]);
    expect(
      await instance.database.vocabularyIndexChunk.findFirst({
        where: { index: { materialId: material.id } },
      })
    ).toMatchObject({ status: 'FAILED' });
  });

  beforeAll(async () => {
    vi.stubEnv('REDIS_URL', process.env.SIDEDOOR_TEST_REDIS_URL!);
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost');
    instance = await createSharedTestInstance('vocabulary_index');
    boundary.database = instance.database;
    root = await mkdtemp(join(tmpdir(), 'sotto-index-test-'));
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(root, 'executions'));
  });
  beforeEach(async () => {
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(root, 'executions'));
    identity = await instance.reset();
    await queue().drain(true);
    requests = [];
    failTransport = false;
    rejectLargeCoverage = false;
    rejectMetadata = false;
    beforeModel = null;
    await instance.seedAiCredential(identity.ownerId, 'openai', 'fixture-index-key');
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: {
        preferredAiProvider: 'openai',
        preferredAiModel: getAiProviderMeta('openai').defaultModel,
      },
    });
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Source fixture' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
        },
      })
    ).id;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url !== 'https://api.openai.com/v1/chat/completions')
        throw new Error('Unexpected fixture provider destination');
      const body = (await request.json()) as { name: string; payload: string; model: string };
      requests.push(body.name);
      await beforeModel?.();
      if (failTransport) throw new Error('Provider transport ended before its outcome was known');
      const payload = JSON.parse(body.payload);
      let result: unknown;
      if (body.name === 'source_vocabulary_inventory') {
        const words = payload.passageWords.flatMap((token: { surface: string }, index: number) => {
          const gloss = meanings.get(token.surface);
          if (!gloss) return [];
          const start = payload.passageText.indexOf(
            token.surface,
            payload.passageWords
              .slice(0, index)
              .reduce(
                (offset: number, prior: { surface: string }) =>
                  payload.passageText.indexOf(prior.surface, offset) + prior.surface.length,
                0
              )
          );
          if (
            payload.requiredSpan &&
            (start < payload.requiredSpan.start || start >= payload.requiredSpan.end)
          )
            return [];
          return [
            {
              lemma: token.surface,
              gloss,
              pos: 'noun',
              sourceSpan: { startWordIndex: index, endWordIndex: index },
              questionIndices: [],
            },
          ];
        });
        const table = new Intl.Segmenter('de', { granularity: 'word' });
        const tokens = [...table.segment(payload.passageText)].filter((part) => part.isWordLike);
        result = {
          words,
          coverage: payload.lines.map((line: { index: number; start: number; end: number }) => {
            const indices = words.flatMap(
              (word: { sourceSpan: { startWordIndex: number } }, index: number) => {
                const start = tokens[word.sourceSpan.startWordIndex]!.index;
                return start >= line.start && start < line.end ? [index] : [];
              }
            );
            return {
              lineIndex: line.index,
              entries: indices,
              classification: indices.length ? 'VOCABULARY' : 'CONTEXT',
            };
          }),
        };
      } else if (body.name === 'source_inventory_coverage') {
        const incomplete = rejectLargeCoverage && payload.inventory.words.length > 2;
        result = {
          complete: !incomplete,
          missingEntries: incomplete ? ['A required entry needs a smaller section.'] : [],
        };
      } else if (body.name === 'reading_vocabulary_quality') {
        result = {
          items: payload.items.map((item: { index: number }) => ({
            index: item.index,
            metadata: {
              acceptable: !rejectMetadata,
              issues: rejectMetadata ? ['meaning'] : [],
              feedback: [],
            },
            associations: [],
          })),
        };
      } else throw new Error(`Unexpected fixture model protocol ${body.name}`);
      return Response.json({
        content: JSON.stringify(result),
        model: body.model,
        inputTokens: 10,
        outputTokens: 10,
      });
    });
  });
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await queue().close();
    await closeRedis();
    boundary.database = null;
    await instance?.close();
    if (root) await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('reports a bootstrap workspace failure and retries without a previous model request', async () => {
    const blocked = join(root, 'not-an-execution-directory');
    await writeFile(blocked, 'blocked');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', blocked);
    const material = await upload('Bahnhof = station');
    await startWorker();
    await index(material.id);
    await waitForIndex(material.id, 'FAILED');
    expect(requests).toEqual([]);
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(root, 'executions'));
    await index(material.id, true);
    await waitForIndex(material.id);
    expect(
      await instance.database.learnerVocab.findFirst({ where: { courseId, lemma: 'Bahnhof' } })
    ).toMatchObject({ translation: 'station', mastery: 0 });
  });

  it('indexes every section beyond the old 12-word and 12000-character limits while preserving known mastery', async () => {
    const known = await instance.database.learnerVocab.create({
      data: {
        courseId,
        lemma: 'Bahnhof',
        translation: 'my station meaning',
        acceptedMeanings: ['my alias'],
        reps: 8,
        mastery: 0.91,
        lastReviewed: new Date(),
        dueAt: new Date('2100-01-01'),
      },
    });
    const text = entries
      .map(
        ([lemma, gloss]) =>
          `${lemma} = ${gloss}. ${'This is reference context for the same dictionary entry. '.repeat(16)}`
      )
      .join('\n');
    expect(text.length).toBeGreaterThan(12000);
    const material = await upload(text);
    await startWorker();
    await index(material.id);
    await waitForIndex(material.id);
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(
      entries.length
    );
    expect(
      await instance.database.learnerVocab.findUniqueOrThrow({ where: { id: known.id } })
    ).toEqual(known);
    const newWords = await instance.database.learnerVocab.findMany({
      where: { courseId, id: { not: known.id } },
    });
    expect(
      newWords.every(
        (word) =>
          word.mastery === 0 &&
          word.reps === 0 &&
          word.lastReviewed === null &&
          word.introducedAt === null
      )
    ).toBe(true);
    const sources = await instance.database.vocabularySourceOccurrence.findMany({
      where: { materialId: material.id },
      include: { word: true },
    });
    expect(new Set(sources.map((source) => source.word.lemma))).toEqual(
      new Set(entries.map(([lemma]) => lemma))
    );
    expect(
      sources.every(
        (source) =>
          material.extractedText.slice(source.startOffset, source.endOffset) === source.quote
      )
    ).toBe(true);
    expect(sources.some((source) => source.startOffset > 12000)).toBe(true);
    const count = requests.length;
    await index(material.id, true);
    expect(requests).toHaveLength(count);
    expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(0);
    expect((await readDictionary(courseId, identity.ownerId, {})).materials[0]).toMatchObject({
      status: 'COMPLETE',
    });
  }, 60000);

  it('creates an atomic indexing intent only when staged material is attached and retains multiple source origins', async () => {
    const first = await upload('Bahnhof = station', false);
    expect(await instance.database.materialVocabularyIndex.count()).toBe(0);
    await sottoTransaction(instance.database, (database) =>
      attachCourseMaterials(database, identity.ownerId, courseId, [first.id])
    );
    expect(await instance.database.materialVocabularyIndex.count()).toBe(1);
    const second = await upload('Bahnhof = station');
    await startWorker();
    await index(first.id);
    await index(second.id);
    await waitForIndex(first.id);
    await waitForIndex(second.id);
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(1);
    expect(
      new Set(
        (await instance.database.vocabularySourceOccurrence.findMany()).map(
          (source) => source.materialId
        )
      )
    ).toEqual(new Set([first.id, second.id]));
  }, 60000);

  it('subdivides independently rejected coverage without publishing the incomplete parent', async () => {
    rejectLargeCoverage = true;
    const material = await upload(
      entries
        .slice(0, 6)
        .map(([lemma, gloss]) => `${lemma} = ${gloss}`)
        .join(' · ')
    );
    await startWorker();
    await index(material.id);
    await waitForIndex(material.id);
    const split = await instance.database.vocabularyIndexChunk.findMany({
      where: { status: 'SPLIT' },
    });
    expect(split.length).toBeGreaterThan(0);
    expect(
      await instance.database.vocabularySourceOccurrence.count({
        where: { chunkId: { in: split.map((chunk) => chunk.id) } },
      })
    ).toBe(0);
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(6);
  }, 60000);

  it('fences unknown model outcomes and preserves the completed dictionary when a retry is requested', async () => {
    failTransport = true;
    const material = await upload('Bahnhof = station');
    await startWorker();
    await index(material.id);
    await waitForIndex(material.id, 'UNRESOLVED');
    const count = requests.length;
    failTransport = false;
    await index(material.id, true);
    await waitForIndex(material.id, 'FAILED');
    expect(requests).toHaveLength(count);
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
  }, 60000);

  it('rejects a source change during model work before any vocabulary can publish', async () => {
    const material = await upload('Bahnhof = station');
    beforeModel = async () => {
      beforeModel = null;
      await instance.database.courseMaterial.update({
        where: { id: material.id },
        data: { extractedText: 'Fahrkarte = ticket' },
      });
    };
    await startWorker();
    await index(material.id);
    await waitForIndex(material.id, 'FAILED');
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
    expect(await instance.database.vocabularySourceOccurrence.count()).toBe(0);
    expect((await readDictionary(courseId, identity.ownerId, {})).materials[0]!.status).toBe(
      'NOT_INDEXED'
    );
  }, 60000);

  it('cannot publish a late model response after the material was removed', async () => {
    const material = await upload('Bahnhof = station');
    beforeModel = async () => {
      beforeModel = null;
      await instance.database.courseMaterial.delete({ where: { id: material.id } });
    };
    await startWorker();
    await index(material.id);
    await expect
      .poll(() => instance.database.courseMaterial.count({ where: { id: material.id } }), {
        timeout: 10000,
      })
      .toBe(0);
    await worker!.close();
    worker = undefined;
    expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
    expect(await instance.database.materialVocabularyIndex.count()).toBe(0);
    expect(await instance.database.vocabularySourceOccurrence.count()).toBe(0);
    await expect(index(material.id)).rejects.toThrow('Attached material not found');
  }, 60000);
});
