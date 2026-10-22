// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { AIOptions, AIResponse, ChatMessage } from '@/lib/providers/ai';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { createQueue, createWorker } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import {
  importCourseMaterials,
  attachCourseMaterials,
  materialStorageScopes,
} from '@/lib/course-materials';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { prepareMaterialPageText } from '@/lib/course-materials/extraction/chunks';
import {
  initializeMaterialPages,
  publishMaterialPageText,
  finishMaterialExtraction,
} from '@/lib/course-materials/extraction/persistence';
import { canonicalVocabularySourceSchema } from '@/lib/vocabulary/source/snapshot';
import { readMaterialTextRange } from '@/lib/course-materials/extraction/readers';
import { authenticateRequest } from '@/lib/api-keys';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { requestMaterialVocabularyIndex } from '@/lib/vocabulary/index-admission';
import { readDictionary } from '@/lib/vocabulary/dictionary';
import { processVocabularyIndex } from '@/workers/vocabulary/index.worker';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
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
  let canonicalPhraseInventory: boolean;
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
    canonicalPhraseInventory = false;
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
          if (
            canonicalPhraseInventory &&
            token.surface === 'Fahrkarte' &&
            payload.passageWords[index - 1]?.surface === 'Bahnhof'
          )
            return [];
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
              lemma:
                canonicalPhraseInventory && token.surface === 'Bahnhof'
                  ? 'Bahnhof Fahrkarte'
                  : token.surface,
              gloss:
                canonicalPhraseInventory && token.surface === 'Bahnhof' ? 'station ticket' : gloss,
              pos: 'noun',
              sourceSpan: {
                startWordIndex: index,
                endWordIndex:
                  canonicalPhraseInventory && token.surface === 'Bahnhof' ? index + 1 : index,
              },
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

  it.each([
    ['QUEUED', 'PENDING'],
    ['EXTRACTING', 'PENDING'],
    ['LEGACY', 'NOT_INDEXED'],
    ['READY', 'NOT_INDEXED'],
    ['PARTIAL', 'NOT_INDEXED'],
    ['RETAINED', 'NOT_INDEXED'],
    ['AWAITING_UPLOAD', 'NOT_INDEXED'],
    ['FAILED', 'NOT_INDEXED'],
    ['CANCELLED', 'NOT_INDEXED'],
    ['EXPIRED', 'NOT_INDEXED'],
    ['RECOVERY_REQUIRED', 'NOT_INDEXED'],
  ])(
    'shows unindexed %s material as %s without admitting work or changing mastery',
    async (processingStatus, status) => {
      const text = 'Bahnhof = station';
      const material = await upload(text, false);
      await instance.database.courseMaterial.update({
        where: { id: material.id },
        data: {
          courseId,
          processingStatus,
          originalSha256:
            processingStatus === 'LEGACY' ? null : createHash('sha256').update(text).digest('hex'),
          extractedText: processingStatus === 'LEGACY' ? text : '',
        },
      });
      const known = await instance.database.learnerVocab.create({
        data: {
          courseId,
          lemma: 'Bahnhof',
          translation: 'station',
          mastery: 0.91,
          reps: 8,
          lastReviewed: new Date(),
        },
      });
      expect(await instance.database.materialVocabularyIndex.count()).toBe(0);

      const dictionary = await readDictionary(courseId, identity.ownerId, {});

      expect(dictionary.materials).toEqual([
        expect.objectContaining({ id: material.id, status, totalChunks: 0, entries: 0 }),
      ]);
      expect(await instance.database.materialVocabularyIndex.count()).toBe(0);
      expect(await instance.database.learnerVocab.findMany({ where: { courseId } })).toEqual([
        known,
      ]);
      expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(0);
      expect(requests).toEqual([]);
    }
  );

  it.each(['PENDING', 'ACTIVE', 'COMPLETE', 'FAILED', 'NEEDS_TEXT', 'UNRESOLVED'])(
    'preserves a current %s index while material processing is queued or extracting',
    async (status) => {
      const material = await upload('Bahnhof = station');
      const existing = await instance.database.materialVocabularyIndex.findFirstOrThrow({
        where: { materialId: material.id },
      });
      const current = await instance.database.materialVocabularyIndex.update({
        where: { id: existing.id },
        data: { status },
      });
      for (const processingStatus of ['QUEUED', 'EXTRACTING']) {
        await instance.database.courseMaterial.update({
          where: { id: material.id },
          data: { processingStatus },
        });

        const dictionary = await readDictionary(courseId, identity.ownerId, {});

        expect(dictionary.materials[0]).toMatchObject({ id: material.id, status });
        expect(
          await instance.database.materialVocabularyIndex.findMany({
            where: { materialId: material.id },
          })
        ).toEqual([current]);
      }
      expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
      expect(requests).toEqual([]);
    }
  );

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
      sources.every((source) => text.slice(source.startOffset, source.endOffset) === source.quote)
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

  it.each([true, false])(
    'indexes canonical retained text through the real worker with exact byte receipts and original coverage=%s',
    async (complete) => {
      canonicalPhraseInventory = true;
      const text = '\uFEFF𠮷 Bahnhof\u0000 Fahrkarte\nWohnung = apartment';
      const originalSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
      const id = randomUUID(),
        createdAt = new Date();
      const { request, actor } = await authority();
      await instance.database.courseMaterial.create({
        data: {
          id,
          userId: actor.userId,
          name: 'Canonical Unicode source.txt',
          mimeType: 'text/plain',
          byteSize: Buffer.byteLength(text),
          originalSha256,
          extractedText: '',
          createdAt,
          processingStatus: 'RETAINED',
        },
      });
      await writeStorageReference({
        database: instance.database,
        signal: request.signal,
        prefix: `materials/${actor.userId}/${id}`,
        extension: 'txt',
        body: Buffer.from(text, 'utf8'),
        contentType: 'text/plain',
        previousReference: () => null,
        captureAdmission: async (database) => {
          await requireOriginalSottoAdmission(database, request, actor);
          return {
            ...(await materialStorageScopes(database, { id, userId: actor.userId, createdAt })),
            consumer: `material:${id}:original`,
            snapshot: null,
          };
        },
        validateAdmission: async (database, captured, reference) => {
          await requireOriginalSottoAdmission(database, request, actor);
          const current = await materialStorageScopes(database, {
            id,
            userId: actor.userId,
            createdAt,
          });
          if (
            current.instanceId !== captured.instanceId ||
            JSON.stringify(current.scopes) !== JSON.stringify(captured.scopes) ||
            !(await database.courseMaterial.findFirst({
              where: { id, userId: actor.userId, originalUrl: reference ?? null },
            }))
          )
            throw new Error('Owned synthetic source changed.');
        },
        commit: async (database, originalUrl) => {
          await database.courseMaterial.update({ where: { id }, data: { originalUrl } });
        },
      });
      const run = await instance.database.materialExtractionRun.create({
        data: {
          materialId: id,
          processingRevision: 1,
          runKey: randomUUID(),
          originalSha256,
          extractorVersion: 'sotto-complete-utf8-extraction-1',
          rendererVersion: 'NO_VISUAL_LAYER:1',
          recognitionPolicy: { method: 'FIXTURE_COMPLETE_TEXT' },
        },
      });
      const identity = {
        userId: actor.userId,
        materialId: id,
        runId: run.id,
        processingRevision: 1,
        originalSha256,
      };
      const prepared = prepareMaterialPageText({
        pageNumber: 1,
        source: { origin: 'EMBEDDED_TEXT', method: 'FIXTURE_COMPLETE_TEXT', version: '1' },
        text,
      });
      await sottoTransaction(instance.database, async (database) => {
        await attachCourseMaterials(database, actor.userId, courseId, [id]);
        expect(await database.materialVocabularyIndex.count({ where: { materialId: id } })).toBe(0);
        await initializeMaterialPages(database, identity, 1);
        await publishMaterialPageText(database, identity, prepared.manifest, prepared.chunks);
        await database.materialPage.updateMany({
          where: { runId: run.id },
          data: {
            visualCoverage: complete
              ? {
                  state: 'TEXT_SOURCE',
                  originalSha256,
                  diagnostic: 'Complete retained text fixture',
                }
              : { state: 'UNAVAILABLE', diagnostic: 'Original handwriting remains unresolved.' },
          },
        });
        const coverage = await finishMaterialExtraction(database, identity);
        expect(coverage.coverageComplete).toBe(complete);
        expect(
          await database.materialVocabularyIndex.count({ where: { materialId: id, protocol: 2 } })
        ).toBe(1);
        const pendingIndex = await database.materialVocabularyIndex.findFirstOrThrow({
          where: { materialId: id },
        });
        const outbox = await sottoJobOutbox(database).read(
          durableQueueOperationId(
            'vocabulary-index',
            `prepare-${pendingIndex.id}-${pendingIndex.generation}`
          )
        );
        expect(outbox?.job.handler).toBe('vocabulary-index');
      });
      expect(requests).toEqual([]);
      await startWorker();
      await index(id);
      await waitForIndex(id, complete ? 'COMPLETE' : 'NEEDS_TEXT');
      const indexed = await instance.database.materialVocabularyIndex.findFirstOrThrow({
        where: { materialId: id },
      });
      const snapshot = canonicalVocabularySourceSchema.parse(indexed.sourceSnapshot);
      expect(snapshot.inventory.runId).toBe(run.id);
      expect(snapshot.inventory.originalSha256).toBe(originalSha256);
      expect(
        await instance.database.$transaction((database) =>
          readMaterialTextRange(database, snapshot.inventory, 0, snapshot.inventory.length)
        )
      ).toBe(`${text}\n`);
      expect(
        (await instance.database.courseMaterial.findUniqueOrThrow({ where: { id } })).extractedText
      ).toBe('');
      const chunks = await instance.database.vocabularyIndexChunk.findMany({
        where: { indexId: indexed.id, status: 'COMPLETE' },
      });
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((chunk) => chunk.resultBytes !== null && chunk.result === null)).toBe(
        true
      );
      expect(
        chunks
          .flatMap((chunk) => JSON.parse(Buffer.from(chunk.resultBytes!).toString('utf8')))
          .some((word: { sourceForm: string }) => word.sourceForm === 'Bahnhof\u0000 Fahrkarte')
      ).toBe(true);
      const sources = await instance.database.vocabularySourceOccurrence.findMany({
        where: { materialId: id },
        include: { word: true },
      });
      const phrase = sources.find((source) => source.word.lemma === 'Bahnhof Fahrkarte');
      expect(phrase).toBeDefined();
      expect(phrase!.quote).toBeNull();
      expect(Buffer.from(phrase!.quoteBytes!).toString('utf8')).toBe('Bahnhof\u0000 Fahrkarte');
      const pointStart = [...text.slice(0, text.indexOf('Bahnhof'))].length;
      expect(phrase!.startOffset).toBe(pointStart);
      expect(phrase!.startOffset).not.toBe(text.indexOf('Bahnhof'));
      expect([...`${text}\n`].slice(phrase!.startOffset, phrase!.endOffset).join('')).toBe(
        'Bahnhof\u0000 Fahrkarte'
      );
      expect(
        sources.every(
          (source) =>
            source.word.mastery === 0 &&
            source.word.reps === 0 &&
            source.word.lastReviewed === null &&
            source.word.introducedAt === null
        )
      ).toBe(true);
      expect(await instance.database.learningObservation.count({ where: { courseId } })).toBe(0);
      expect(await instance.database.learnerReviewEvent.count({ where: { courseId } })).toBe(0);
      expect(requests).toContain('source_vocabulary_inventory');
      expect(requests).toContain('source_inventory_coverage');
      const dictionary = await readDictionary(courseId, actor.userId, {});
      expect(dictionary.materials[0]!.status).toBe(complete ? 'COMPLETE' : 'NEEDS_TEXT');
      expect(
        dictionary.words.find((word) => word.lemma === 'Bahnhof Fahrkarte')?.sources[0]
      ).toMatchObject({
        quote: 'Bahnhof\u0000 Fahrkarte',
        coordinateSystem: 'MATERIAL_CODEPOINTS',
      });
      if (complete) {
        const words = await instance.database.learnerVocab.findMany({
          where: { courseId },
          orderBy: { id: 'asc' },
        });
        for (const processingStatus of ['QUEUED', 'EXTRACTING']) {
          await instance.database.courseMaterial.update({
            where: { id },
            data: { processingRevision: 2, processingStatus },
          });

          const pending = await readDictionary(courseId, actor.userId, {});

          expect(pending.materials[0]).toMatchObject({ id, status: 'PENDING' });
          expect(
            await instance.database.materialVocabularyIndex.findMany({
              where: { materialId: id },
            })
          ).toEqual([indexed]);
          expect(
            await instance.database.learnerVocab.findMany({
              where: { courseId },
              orderBy: { id: 'asc' },
            })
          ).toEqual(words);
        }
      }
    },
    60000
  );

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
