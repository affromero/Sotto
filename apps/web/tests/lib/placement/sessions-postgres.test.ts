// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { placementConfirmRequestSchema, placementSubmitRequestSchema } from '@sotto/shared';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { publishLearningCatalog } from '@/lib/learning-map/catalog';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import {
  materialAnalysisPolicySchema,
  materialAnalysisRuntimeRevision,
} from '@/lib/course-materials/analysis/policy';
import {
  prepareMaterialFocusTextSnapshot,
  prepareMaterialFocusAnalysis,
  prepareMaterialFocusChunk,
  parseMaterialFocusChunk,
  materialFocusAnalysisHash,
} from '@/lib/course-materials/analysis/protocol';
import { mergeMaterialSourceFocuses } from '@/lib/course-materials/analysis/merge';
import { inferMaterialPlacement } from '@/lib/course-materials/analysis/results';
import { materialAnalysisBytesHash } from '@/lib/course-materials/analysis/inventory';
import {
  acceptPlacementInTransaction,
  confirmSourcePlacement,
  submitPlacementSession,
} from '@/lib/placement/confirmation';
import { readPlacementAnalysis } from '@/lib/placement/analysis';
import {
  createPlacementSessionGrant,
  placementHttpStore,
  readPlacementResponse,
  readOwnedPlacementSession,
} from '@/lib/placement/journal';
import { readPlacementSessionStatus, requestPlacementSession } from '@/lib/placement/sessions';
import {
  preparePlacementQuestionBatch,
  parsePlacementQuestionBatch,
  PLACEMENT_SCORING_VERSION,
} from '@/lib/placement-test';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { replayLearningProviderResponse } from '@/lib/learning/preparation/provider-invocation';
import { createAIProvider, type AIOptions } from '@/lib/providers/ai';
import { enqueueDurableQueueJob } from '@/lib/sidedoor/jobs/core/durable-queue';
import { settleAnalysisFailure } from '@/lib/course-materials/jobs/analysis-failure';
import { finishMaterialExtraction } from '@/lib/course-materials/extraction/persistence';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(`${process.cwd()}/package.json`)('openai');
});
const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
const rawQuestions = (perBand = 2) => ({
  questions: levels.flatMap((cefr) =>
    Array.from({ length: perBand }, (_, index) => ({
      cefr,
      skill: index ? 'reading' : 'grammar',
      prompt: `Owned ${cefr} question ${index}`,
      options: ['alpha', 'beta', 'gamma', 'delta'],
      correctIndex: 0,
      explanation: 'Owned fixture explanation.',
    }))
  ),
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('immutable private placement receipts against PostgreSQL', () => {
  let instance: SharedTestInstance,
    userId: string,
    curriculumId: string,
    owner: Awaited<ReturnType<SharedTestInstance['reset']>>;
  const execution = () => ({
    userId,
    authorize: async (database: Prisma.TransactionClient) => {
      await database.user.findUniqueOrThrow({ where: { id: userId } });
      return { userId };
    },
  });
  const tx = <T>(work: (database: Prisma.TransactionClient) => Promise<T>) =>
    sottoTransaction(instance.database, work, { timeoutMs: 60000 });
  beforeAll(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'a'.repeat(64));
    instance = await createSharedTestInstance('placement_receipts');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    owner = await instance.reset();
    userId = owner.ownerId;
    curriculumId = (
      await instance.database.curriculum.upsert({
        where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
        create: { nativeLang: 'en', targetLang: 'de', title: 'Owned fixture curriculum' },
        update: {},
      })
    ).id;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
    vi.unstubAllEnvs();
  });
  function policy() {
    return materialAnalysisPolicySchema.parse({
      schemaVersion: 1,
      analyzerVersion: 'sotto-source-focus-1',
      runtimeRevision: materialAnalysisRuntimeRevision(),
      maxOutputTokens: 16384,
      cliBinding: null,
      selection: {
        provider: 'local',
        model: 'local:owned-quiz-fixture',
        endpoint: 'http://127.0.0.1:9999/v1',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
    });
  }
  async function source(partial = false) {
    const owner = await instance.database.user.findUniqueOrThrow({ where: { id: userId } }),
      id = randomUUID(),
      sourceId = randomUUID();
    const text = '\uFEFFAlthough it rains, we leave.\0 Source class: obwohl und trotzdem.';
    const snapshot = prepareMaterialFocusTextSnapshot({
      sourceKind: 'PASTE',
      sourceId,
      userId,
      revision: 1,
      name: 'Owned exact source',
      text,
      note: null,
    });
    const selected = policy(),
      catalog = getLanguageCatalog('de');
    const material = partial
      ? await instance.database.courseMaterial.create({
          data: {
            userId,
            name: 'Owned unreadable fixture.pdf',
            mimeType: 'application/pdf',
            byteSize: 100,
            originalUrl: `materials/${randomUUID()}/original.pdf`,
            originalSha256: 'a'.repeat(64),
            extractedText: '',
            processingStatus: 'PARTIAL',
          },
        })
      : null;
    const run = material
      ? await instance.database.materialExtractionRun.create({
          data: {
            materialId: material.id,
            processingRevision: 1,
            runKey: materialFocusAnalysisHash({ id }),
            originalSha256: material.originalSha256!,
            extractorVersion: 'owned-1',
            rendererVersion: 'owned-1',
            recognitionPolicy: { kind: 'EMBEDDED_TEXT_ONLY', version: 1 },
            status: 'EXTRACTING',
            pageCount: 1,
            pages: {
              create: {
                pageNumber: 1,
                embeddedText: {
                  state: 'FAILED',
                  diagnostic: 'Owned fixture contains no readable embedded text.',
                },
                visualCoverage: {
                  state: 'UNAVAILABLE',
                  diagnostic: 'This synthetic fixture has no rendered page.',
                },
              },
            },
          },
        })
      : null;
    if (material && run)
      await tx((database) =>
        finishMaterialExtraction(database, {
          userId,
          materialId: material.id,
          runId: run.id,
          processingRevision: 1,
          originalSha256: material.originalSha256!,
        })
      );
    const materialSnapshot =
      material && run
        ? {
            sourceKind: 'MATERIAL' as const,
            materialId: material.id,
            userId,
            materialGeneration: material.createdAt.getTime(),
            runId: run.id,
            processingRevision: 1,
            originalSha256: material.originalSha256!,
            name: material.name,
            extractorVersion: run.extractorVersion,
            rendererVersion: run.rendererVersion,
            pageCount: 1,
            pages: [
              {
                pageNumber: 1,
                embeddedText: {
                  state: 'FAILED' as const,
                  diagnostic: 'Owned fixture contains no readable embedded text.',
                },
                visual: {
                  state: 'UNAVAILABLE' as const,
                  diagnostic: 'This synthetic fixture has no rendered page.',
                },
                streams: [],
              },
            ],
          }
        : null;
    const prepared = prepareMaterialFocusAnalysis({
      owner: { userId, generation: owner.createdAt.getTime() },
      course: null,
      nativeLang: 'en',
      targetLang: 'de',
      catalog,
      selection: selected.selection,
      sources: [snapshot.snapshot, ...(materialSnapshot ? [materialSnapshot] : [])],
      analyzerVersion: selected.analyzerVersion,
      runtimeRevision: selected.runtimeRevision,
      maxOutputTokens: selected.maxOutputTokens,
    });
    const input = prepareMaterialFocusChunk({
      analysis: prepared,
      unitId: prepared.units[0]!.id,
      chunks: [{ unitId: prepared.units[0]!.id, text }],
    });
    const u = input.unit,
      s = u.source;
    const citation = {
      unitId: u.id,
      sourceKind: s.sourceKind,
      sourceId: s.sourceId,
      sourceSha256: s.sourceSha256,
      materialId: s.materialId,
      runId: s.runId,
      streamId: s.streamId,
      pageNumber: s.pageNumber,
      origin: s.origin,
      chunkIndex: s.chunkIndex,
      chunkSha256: s.chunkSha256,
      pageTextSha256: s.pageTextSha256,
      codePointStart: 0,
      codePointEnd: [...text].length,
      utf8ByteStart: 0,
      utf8ByteEnd: Buffer.byteLength(text),
      quote: text,
    };
    const parsed = parseMaterialFocusChunk(
      input,
      JSON.stringify({
        schemaVersion: 1,
        analysisIdentityDigest: prepared.identityDigest,
        unitId: u.id,
        inputDigest: u.inputDigest,
        coverage: { chunkSha256: s.chunkSha256, codePointStart: 0, codePointEnd: s.codePointEnd },
        headings: [],
        focuses: [
          {
            localId: 'concession',
            kind: 'GRAMMAR',
            title: 'Concession with obwohl and trotzdem',
            description: 'A source class on concessive contrast.',
            communicativeIntent: null,
            heading: null,
            grammarKeys: ['obwohl-trotzdem'],
            objectiveIds: [],
            groupIds: [],
            citations: [citation],
            continuation: null,
          },
        ],
      }),
      { completion: 'COMPLETE' }
    );
    const merged = mergeMaterialSourceFocuses({ analysis: prepared, catalog, results: [parsed] });
    const result = {
        ...merged,
        inference: inferMaterialPlacement(merged.focuses, merged.coverage),
      },
      bytes = Buffer.from(JSON.stringify(result), 'utf8');
    await tx(async (database) => {
      const revision = await publishLearningCatalog(database, catalog);
      await database.materialAnalysis.create({
        data: {
          id,
          userId,
          userGeneration: BigInt(owner.createdAt.getTime()),
          nativeLang: 'en',
          targetLang: 'de',
          purpose: 'PLACEMENT',
          requestId: randomUUID(),
          admissionDigest: materialFocusAnalysisHash({ id, kind: 'admission' }),
          sourceSetDigest: materialFocusAnalysisHash({ id, kind: 'source' }),
          catalogRevisionId: revision.id,
          policy: selected,
          identity: prepared.identity,
          identityDigest: prepared.identityDigest,
          status: partial ? 'PARTIAL' : 'COMPLETE',
          coverage: merged.coverage,
          summary: { focusCount: 1, inference: result.inference, exposureOnly: true },
          resultBytes: Uint8Array.from(bytes),
          resultDigest: materialAnalysisBytesHash(bytes),
          sources: {
            create: [
              {
                id: sourceId,
                sourceId,
                order: 0,
                kind: 'PASTE',
                name: snapshot.snapshot.name,
                snapshotBytes: Buffer.from(text, 'utf8'),
                snapshotSha256: snapshot.snapshot.snapshotSha256,
                inventory: snapshot.snapshot,
                inventoryDigest: materialFocusAnalysisHash(snapshot.snapshot),
              },
              ...(material && run && materialSnapshot
                ? [
                    {
                      order: 1,
                      kind: 'MATERIAL',
                      name: material.name,
                      materialId: material.id,
                      materialGeneration: BigInt(material.createdAt.getTime()),
                      runId: run.id,
                      processingRevision: 1,
                      originalSha256: material.originalSha256,
                      inventory: materialSnapshot,
                      inventoryDigest: materialFocusAnalysisHash(materialSnapshot),
                    },
                  ]
                : []),
            ],
          },
        },
      });
    });
    const reference = {
      analysisId: id,
      analysisRevision: 1,
      resultDigest: materialAnalysisBytesHash(bytes),
    };
    const inputConfirm = placementConfirmRequestSchema.parse({
      schemaVersion: 1,
      requestId: randomUUID(),
      native: 'en',
      target: 'de',
      ...reference,
      acceptPartial: partial,
    });
    return { reference, input: inputConfirm, text, result, snapshot, material };
  }
  async function session(analysis: Awaited<ReturnType<typeof source>> | null = null) {
    const owner = await instance.database.user.findUniqueOrThrow({ where: { id: userId } }),
      selected = policy(),
      id = randomUUID();
    const prepared = preparePlacementQuestionBatch('en', 'de', '', 2),
      questions = parsePlacementQuestionBatch(JSON.stringify(rawQuestions()), 'en', 2);
    const input = {
      system: prepared.system,
      messagesJson: JSON.stringify(prepared.messages),
      jsonSchemaJson: JSON.stringify(prepared.jsonSchema),
      maxOutputTokens: selected.maxOutputTokens,
      perBand: 2,
      scoringVersion: PLACEMENT_SCORING_VERSION,
      analysisId: analysis?.reference.analysisId ?? null,
      analysisRevision: analysis?.reference.analysisRevision ?? null,
      resultDigest: analysis?.reference.resultDigest ?? null,
    };
    const inputDigest = learningProviderInputHash({
      userId,
      userGeneration: owner.createdAt.getTime(),
      native: 'en',
      target: 'de',
      policy: selected,
      input,
    });
    const bytes = Buffer.from(JSON.stringify(questions), 'utf8');
    await tx(async (database) => {
      await database.placementSession.create({
        data: {
          id,
          userId,
          userGeneration: BigInt(owner.createdAt.getTime()),
          nativeLang: 'en',
          targetLang: 'de',
          requestId: randomUUID(),
          semanticDigest: learningProviderInputHash({ id }),
          policy: selected,
          input,
          inputDigest,
          mode: 'HTTP',
          grant: {},
          analysisId: input.analysisId,
          analysisRevision: input.analysisRevision,
          analysisDigest: input.resultDigest,
          questionsBytes: bytes,
          questionsDigest: materialAnalysisBytesHash(bytes),
          status: 'READY',
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      await createPlacementSessionGrant(database, {
        userId,
        placementSessionId: id,
        execution: execution(),
      });
    });
    const submit = placementSubmitRequestSchema.parse({
      schemaVersion: 1,
      requestId: randomUUID(),
      native: 'en',
      target: 'de',
      placementSessionId: id,
      questionsDigest: materialAnalysisBytesHash(bytes),
      analysisId: input.analysisId,
      analysisRevision: input.analysisRevision,
      resultDigest: input.resultDigest,
      acceptPartial: analysis?.input.acceptPartial ?? false,
      answers: questions.map((question) => ({ id: question.id, selectedIndex: 0 })),
    });
    return { id, questions, submit, input, policy: selected, inputDigest };
  }
  it('accepts the exact source receipt once and preserves complete Unicode snapshots without granting mastery', async () => {
    const f = await source(),
      first = await confirmSourcePlacement(execution(), f.input),
      replayed = await confirmSourcePlacement(execution(), f.input);
    expect(replayed).toEqual(first);
    expect(first.level).toBe('B1');
    const analysis = await instance.database.materialAnalysis.findUniqueOrThrow({
      where: { id: f.reference.analysisId },
      include: { sources: true },
    });
    expect(analysis.attachedCourseId).toBe(first.courseId);
    expect(analysis.acceptedReceiptId).toBe(first.confirmationReceiptId);
    expect(Buffer.from(analysis.sources[0]!.snapshotBytes!).toString('utf8')).toBe(f.text);
    expect(await instance.database.courseNote.count()).toBe(0);
    expect(await instance.database.placementConfirmationReceipt.count()).toBe(1);
    expect(await instance.database.learningObservation.count()).toBe(0);
    expect(await instance.database.learningLevelCompletion.count()).toBe(0);
  });
  it('requires explicit partial coverage acceptance and rejects wrong digests, revisions and owners', async () => {
    const f = await source(true);
    await expect(
      confirmSourcePlacement(execution(), { ...f.input, acceptPartial: false })
    ).rejects.toThrow('partial coverage');
    await expect(
      confirmSourcePlacement(execution(), { ...f.input, resultDigest: 'a'.repeat(64) })
    ).rejects.toThrow('receipt changed');
    await expect(
      confirmSourcePlacement(execution(), { ...f.input, analysisRevision: 2 })
    ).rejects.toThrow('receipt changed');
    const foreign = await owner.household('Other');
    await expect(
      tx((database) =>
        readPlacementAnalysis(database, {
          userId: foreign.id,
          native: 'en',
          target: 'de',
          reference: f.reference,
          acceptPartial: true,
        })
      )
    ).rejects.toThrow();
    const accepted = await confirmSourcePlacement(execution(), f.input);
    expect(
      (await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: f.material!.id } }))
        .courseId
    ).toBe(accepted.courseId);
    const run = await instance.database.materialExtractionRun.findFirstOrThrow({
      where: { materialId: f.material!.id },
    });
    expect(run.status).toBe('PARTIAL');
    expect(run.coverage).toMatchObject({
      processingComplete: true,
      coverageComplete: false,
      unresolvedPageNumbers: [1],
      unavailablePageNumbers: [1],
    });
    const index = await instance.database.materialVocabularyIndex.findFirstOrThrow({
      where: { materialId: f.material!.id },
    });
    expect(index).toMatchObject({ protocol: 2, status: 'NEEDS_TEXT', textLength: 0 });
    expect(
      await instance.database.vocabularyIndexChunk.count({ where: { indexId: index.id } })
    ).toBe(0);
    expect(await instance.database.learningObservation.count()).toBe(0);
    expect(await instance.database.learnerVocab.count()).toBe(0);
  });
  it('rolls the source decision, course and initial requirement band back when the surrounding transaction fails', async () => {
    const f = await source();
    await expect(
      tx(async (database) => {
        await acceptPlacementInTransaction(
          database,
          execution(),
          { kind: 'SOURCE', input: f.input },
          curriculumId
        );
        throw new Error('Owned transaction interruption');
      })
    ).rejects.toThrow('interruption');
    expect(await instance.database.course.count()).toBe(0);
    expect(await instance.database.learningLevelBinding.count()).toBe(0);
    expect(await instance.database.placementConfirmationReceipt.count()).toBe(0);
    expect(
      (
        await instance.database.materialAnalysis.findUniqueOrThrow({
          where: { id: f.reference.analysisId },
        })
      ).acceptedReceiptId
    ).toBeNull();
  });
  it('serializes competing confirmation IDs into one course and one immutable source acceptance receipt', async () => {
    const f = await source();
    const [first, second] = await Promise.all([
      confirmSourcePlacement(execution(), f.input),
      confirmSourcePlacement(execution(), { ...f.input, requestId: randomUUID() }),
    ]);
    expect(first).toEqual(second);
    expect(await instance.database.course.count()).toBe(1);
    expect(await instance.database.placementConfirmationReceipt.count()).toBe(1);
  });
  it('binds answers to the exact stored session and questions while preserving an existing course level', async () => {
    const course = await instance.database.course.create({
      data: {
        userId,
        nativeLang: 'en',
        targetLang: 'de',
        curriculumId,
        currentLevel: 'A2',
        startLevel: 'A2',
        placementSource: 'MANUAL',
      },
    });
    const f = await session();
    const response = await submitPlacementSession(execution(), f.submit);
    expect(response).toMatchObject({ courseId: course.id, level: 'A2', assessedLevel: 'C2' });
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: course.id } }))
        .placementSource
    ).toBe('MANUAL');
    expect(await instance.database.learningLevelCompletion.count()).toBe(0);
    await expect(
      submitPlacementSession(execution(), { ...f.submit, questionsDigest: 'a'.repeat(64) })
    ).rejects.toThrow('different placement');
  });
  it('rejects duplicate, foreign, missing and expired answers without creating a course', async () => {
    const f = await session();
    await expect(
      submitPlacementSession(execution(), {
        ...f.submit,
        answers: [f.submit.answers[0], ...f.submit.answers.slice(1).map(() => f.submit.answers[0])],
      })
    ).rejects.toThrow('once');
    await expect(
      submitPlacementSession(execution(), { ...f.submit, answers: f.submit.answers.slice(1) })
    ).rejects.toThrow('every preserved');
    await expect(
      submitPlacementSession(execution(), {
        ...f.submit,
        answers: [{ id: 'pq_999', selectedIndex: 0 }, ...f.submit.answers.slice(1)],
      })
    ).rejects.toThrow('every preserved');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 7200000);
    await expect(submitPlacementSession(execution(), f.submit)).rejects.toThrow('expired');
    expect(await instance.database.course.count()).toBe(0);
  });
  it('keeps two same-pair quiz sessions separate and does not publish answer keys in polling', async () => {
    const first = await session(),
      second = await session();
    const publicFirst = await tx((database) =>
      readPlacementSessionStatus(database, { userId, placementSessionId: first.id })
    );
    expect(publicFirst.questions).toHaveLength(12);
    expect(publicFirst.questions[0]).not.toHaveProperty('correctIndex');
    const changed = { ...first.submit, placementSessionId: second.id };
    const questions = structuredClone(second.questions);
    questions[0]!.prompt = 'Different independently generated question.';
    const changedBytes = Buffer.from(JSON.stringify(questions), 'utf8');
    await instance.database.placementSession.update({
      where: { id: second.id },
      data: {
        questionsBytes: changedBytes,
        questionsDigest: materialAnalysisBytesHash(changedBytes),
      },
    });
    await expect(submitPlacementSession(execution(), changed)).rejects.toThrow(
      'questions or source analysis'
    );
  });
  it('consumes one provider attempt, persists raw bytes atomically and fences an unknown result permanently', async () => {
    const f = await session();
    await instance.database.placementSession.update({
      where: { id: f.id },
      data: { status: 'GENERATING' },
    });
    const ai = {
        provider: 'local',
        model: f.policy.selection.model,
        endpoint: f.policy.selection.endpoint,
        execution: { ...execution(), credential: null },
      },
      context = { userId, placementSessionId: f.id, execution: execution() };
    const store = placementHttpStore(context, ai),
      attempt = { id: randomUUID(), fingerprint: 'a'.repeat(64) };
    expect(await tx((database) => store.admit(database, attempt))).toEqual({ dispatch: true });
    await tx((database) => store.settle(database, attempt, 'unknown'));
    expect(
      await tx((database) =>
        store.admit(database, { id: randomUUID(), fingerprint: 'b'.repeat(64) })
      )
    ).toEqual({ dispatch: false });
    expect(
      (await instance.database.placementSession.findUniqueOrThrow({ where: { id: f.id } })).status
    ).toBe('RECOVERY_REQUIRED');
    const bytes = Buffer.from('{}');
    await expect(
      tx((database) =>
        store.settle(database, attempt, 'succeeded', {
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyBase64: bytes.toString('base64'),
          bodySha256: materialAnalysisBytesHash(bytes),
        })
      )
    ).rejects.toThrow('cannot change');
  });
  it('preserves exact HTTP request replay after JSONB order and configured credentials change with zero network', async () => {
    const f = await session();
    await instance.database.placementSession.update({
      where: { id: f.id },
      data: { status: 'GENERATING' },
    });
    const context = { userId, placementSessionId: f.id, execution: execution() },
      ai = {
        provider: 'local',
        model: f.policy.selection.model,
        endpoint: f.policy.selection.endpoint,
        execution: { ...execution(), credential: null },
      };
    const bytes = Buffer.from(
      JSON.stringify({
        id: 'owned-receipt',
        object: 'chat.completion',
        created: 1,
        model: 'owned-quiz-fixture',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(rawQuestions()) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
    );
    let dispatched = 0;
    const providerRequest = learningPreparationProviderRequest(
      {
        ...placementHttpStore(context, ai),
        selection: { purpose: 'fixture', inputDigest: f.inputDigest },
        responseReceipt: { maxBytes: 512 * 1024 },
      },
      new AbortController().signal,
      () => {}
    );
    const options: AIOptions = {
      model: f.policy.selection.model,
      maxTokens: f.input.maxOutputTokens,
      temperature: 0,
      skipModeration: true,
      useWebSearch: false,
      jsonSchema: JSON.parse(f.input.jsonSchemaJson),
      maxOutputBytes: 512 * 1024,
    };
    const messages = JSON.parse(f.input.messagesJson);
    await createAIProvider('local').generateResponse(f.input.system, messages, {
      ...options,
      endpoint: f.policy.selection.endpoint,
      apiKeyOverride: 'OWNED_NO_NETWORK_FIXTURE',
      fetch: (resource, init) =>
        providerRequest(new Request(resource, init), async () => {
          dispatched++;
          return new Response(bytes, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }),
    });
    const saved = await tx((database) => readPlacementResponse(database, context));
    expect(saved.receipt?.kind).toBe('HTTP');
    expect(saved.row.status).toBe('SUCCEEDED');
    expect(Buffer.from(saved.row.responseBytes!)).toEqual(bytes);
    expect(dispatched).toBe(1);
    const restored = await tx((database) =>
      readOwnedPlacementSession(database, { userId, placementSessionId: f.id })
    );
    expect(restored.input.messagesJson).toBe(f.input.messagesJson);
    expect(restored.input.jsonSchemaJson).toBe(f.input.jsonSchemaJson);
    vi.stubGlobal('fetch', () => {
      throw new Error('No network allowed during receipt replay');
    });
    await instance.database.user.update({
      where: { id: userId },
      data: { preferredAiProvider: 'codex', preferredAiModel: 'codex:unavailable-fixture' },
    });
    const readAgain = await tx((database) => readPlacementResponse(database, context));
    expect(readAgain.row.responseSha256).toBe(materialAnalysisBytesHash(bytes));
    if (readAgain.receipt?.kind !== 'HTTP') throw new Error('Expected retained HTTP fixture.');
    const replayed = await replayLearningProviderResponse({
      provider: 'local',
      endpoint: f.policy.selection.endpoint,
      system: restored.input.system,
      messages: JSON.parse(restored.input.messagesJson),
      options,
      selection: { purpose: 'fixture', inputDigest: f.inputDigest },
      attemptFingerprint: readAgain.row.attemptFingerprint!,
      receipt: readAgain.receipt.value,
      signal: new AbortController().signal,
    });
    expect(parsePlacementQuestionBatch(replayed.content, 'en', 2)).toEqual(f.questions);
    expect(dispatched).toBe(1);
  });

  it('admits a request once and blocks another request ID from bypassing an equivalent unknown generation', async () => {
    await instance.configureInfrastructure({
      aiProvider: 'local',
      aiModel: 'local:owned-quiz-fixture',
      aiBaseUrl: 'http://127.0.0.1:9999/v1',
    });
    await instance.database.user.update({
      where: { id: userId },
      data: { preferredAiProvider: 'local', preferredAiModel: 'local:owned-quiz-fixture' },
    });
    const input = { schemaVersion: 1, requestId: randomUUID(), native: 'en', target: 'de' };
    const first = await requestPlacementSession(execution(), input),
      again = await requestPlacementSession(execution(), input);
    expect(again).toEqual(first);
    expect(first.status).toBe('QUEUED');
    expect(await instance.database.placementSession.count()).toBe(1);
    await instance.database.placementSession.update({
      where: { id: first.placementSessionId },
      data: { status: 'RECOVERY_REQUIRED' },
    });
    await expect(
      requestPlacementSession(execution(), { ...input, requestId: randomUUID() })
    ).rejects.toThrow('explicit recovery');
    expect(await instance.database.placementSession.count()).toBe(1);
  });

  it('keeps an accepted decision when failure reconciliation arrives before outbox completion', async () => {
    const f = await session();
    const record = await tx((database) =>
      enqueueDurableQueueJob(database, {
        handler: 'placement-generation',
        type: 'generate_placement_session',
        payload: { userId, placementSessionId: f.id },
        jobId: `placement-generation-${f.id}`,
        attempts: 2,
      })
    );
    const accepted = await submitPlacementSession(execution(), f.submit);
    await tx((database) =>
      settleAnalysisFailure(database, {
        operationId: record.job.id,
        fingerprint: record.fingerprint,
        handler: 'placement-generation',
        version: 1,
      })
    );
    const preserved = await instance.database.placementSession.findUniqueOrThrow({
      where: { id: f.id },
    });
    expect(preserved.status).toBe('ACCEPTED');
    expect(preserved.acceptedReceiptId).toBe(accepted.confirmationReceiptId);
    expect(await submitPlacementSession(execution(), f.submit)).toEqual(accepted);
  });
});
