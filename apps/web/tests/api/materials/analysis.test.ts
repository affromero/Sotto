// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST as analyze } from '@/app/api/v1/courses/[courseId]/material-analyses/route';
import { GET as status } from '@/app/api/v1/material-analyses/[analysisId]/route';
import { GET as detail } from '@/app/api/v1/material-analyses/[analysisId]/focuses/[focusId]/route';
import { POST as retry } from '@/app/api/v1/material-analyses/[analysisId]/retry/route';
import { prepareMaterialPageText } from '@/lib/course-materials/extraction/chunks';
import {
  initializeMaterialPages,
  publishMaterialPageText,
} from '@/lib/course-materials/extraction/persistence';
import { materialStorageScopes } from '@/lib/course-materials';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { captureStorageBackend } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { processMaterialAnalysis } from '@/lib/course-materials/analysis/processing';
import { requestMaterialAnalysis } from '@/lib/course-materials/analysis/admission';
import { authenticateRequest } from '@/lib/api-keys';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { readOwnedMaterialSourceFocus } from '@/lib/course-materials/analysis/read';
import { settleFailedAnalysisJob } from '@/lib/course-materials/jobs/analysis-failure';
import { materialAnalysisQueue, createWorker } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import { getServerInfra } from '@/lib/server-config';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { deliverSottoJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import { registerOnboardingMaterialReplayCase } from './analysis/onboarding-case';
import { registerMaterialRetryAliasCase } from './analysis/retry-alias-case';
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
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(`${process.cwd()}/package.json`)('openai') };
});
const envelope = z.object({
  model: z.string(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});
const sourceSchema = z.object({
  sourceKind: z.string(),
  sourceId: z.string(),
  sourceSha256: z.string(),
  materialId: z.string().nullable(),
  runId: z.string().nullable(),
  streamId: z.string(),
  pageNumber: z.number(),
  origin: z.string(),
  chunkIndex: z.number(),
  chunkSha256: z.string(),
  pageTextSha256: z.string(),
  codePointStart: z.number(),
  codePointEnd: z.number(),
  utf8ByteStart: z.number(),
  utf8ByteEnd: z.number(),
});
const unitInput = z.object({
  analysisIdentityDigest: z.string(),
  unitId: z.string(),
  inputDigest: z.string(),
  primary: z.object({ source: sourceSchema }),
  sources: z.array(z.object({ unitId: z.string(), text: z.string(), role: z.string() })),
});
const receiptSchema = z.object({
  analysisId: z.uuid(),
  analysisRevision: z.number(),
  status: z.string(),
  identityDigest: z.string().nullable(),
  resultDigest: z.string().nullable(),
});
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const exactText = '\uFEFFPassiv Präsens\u0000: Das Essen wird gekocht. 😀 e\u0301';
type Mode = 'COMPLETE' | 'TRUNCATED' | 'INVALID' | 'UNKNOWN' | 'FAILED_PAGE';
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;

suite('durable owned material focus analysis', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  let directory: string;
  let server: Server;
  let endpoint: string;
  let mode: Mode;
  const requests: z.infer<typeof unitInput>[] = [];
  const jobs = new Set<string>();
  beforeAll(async () => {
    instance = await createSharedTestInstance('material_analysis_http');
    boundary.database = instance.database;
    directory = await mkdtemp(join(tmpdir(), 'sotto-analysis-http-'));
    server = createServer(async (request, response) => {
      try {
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions')
          throw new Error('Unexpected provider request.');
        const parts: Buffer[] = [];
        for await (const chunk of request) parts.push(Buffer.from(chunk));
        const body = envelope.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
        const message = body.messages.find((value) => value.role === 'user');
        if (!message) throw new Error('Missing exact source input.');
        const input = unitInput.parse(JSON.parse(message.content));
        requests.push(input);
        if (mode === 'UNKNOWN') {
          request.socket.destroy();
          return;
        }
        if (
          mode === 'FAILED_PAGE' &&
          input.primary.source.pageNumber === 65 &&
          input.primary.source.chunkIndex === 0
        ) {
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ error: { message: 'Confirmed synthetic unavailable page' } })
          );
          return;
        }
        const source = input.primary.source;
        const text = input.sources.find((value) => value.unitId === input.unitId)?.text;
        if (!text) throw new Error('Missing primary source text.');
        const quote = [...text].slice(0, 180).join('');
        const output = {
          schemaVersion: 1,
          analysisIdentityDigest: input.analysisIdentityDigest,
          unitId: input.unitId,
          inputDigest: input.inputDigest,
          coverage: {
            chunkSha256: source.chunkSha256,
            codePointStart: source.codePointStart,
            codePointEnd: source.codePointEnd,
          },
          headings: [],
          focuses: [
            {
              localId: 'source-class',
              kind: 'GRAMMAR',
              title: 'Passiv Präsens',
              description: 'Present passive with werden and a past participle.',
              communicativeIntent: null,
              heading: null,
              grammarKeys: ['passiv-praesens'],
              objectiveIds: [],
              groupIds: [],
              continuation: null,
              citations: [
                {
                  ...source,
                  unitId: input.unitId,
                  quote,
                  codePointEnd: source.codePointStart + [...quote].length,
                  utf8ByteEnd: source.utf8ByteStart + Buffer.byteLength(quote),
                },
              ],
            },
          ],
        };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'synthetic-analysis-response',
            object: 'chat.completion',
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: mode === 'INVALID' ? '{' : JSON.stringify(output),
                },
                finish_reason: mode === 'TRUNCATED' ? 'length' : 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          })
        );
      } catch (error) {
        response.writeHead(500);
        response.end(String(error));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
    endpoint = `http://127.0.0.1:${address.port}/v1`;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    identity = await instance.reset();
    requests.length = 0;
    mode = 'COMPLETE';
    await instance.configureInfrastructure({
      ...(await getServerInfra()),
      aiProvider: 'local',
      aiModel: 'local:synthetic-source-analysis',
      aiBaseUrl: endpoint,
    });
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { preferredAiProvider: 'local', preferredAiModel: 'local:synthetic-source-analysis' },
    });
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Owned German analysis' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: curriculum.id,
          nativeLang: 'en',
          targetLang: 'de',
          currentLevel: 'A2',
          startLevel: 'A2',
        },
      })
    ).id;
  });
  afterEach(async () => {
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS synthetic_analysis_failure ON "MaterialAnalysisUnit"'
    );
    await instance.database.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS synthetic_analysis_failure()'
    );
    for (const id of jobs) await (await materialAnalysisQueue.getJob(id))?.remove();
    jobs.clear();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await materialAnalysisQueue.close();
    await closeRedis();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    boundary.database = null;
    await instance?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  function request(
    path: string,
    body?: unknown,
    token = identity.ownerToken,
    origin = 'http://localhost:3000'
  ) {
    return new NextRequest(`http://localhost:3000/api/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie: `sotto_session=${token}`, origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const input = (content = exactText) => ({
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    native: 'en',
    target: 'de',
    content,
  });
  const start = (body: unknown, token = identity.ownerToken, origin?: string) =>
    analyze(request(`courses/${courseId}/material-analyses`, body, token, origin), {
      params: Promise.resolve({ courseId }),
    });
  async function admitted(body: unknown = input()) {
    const response = await start(body);
    expect(response.status).toBe(202);
    return receiptSchema.parse(await response.json());
  }
  async function delivered(analysisId: string) {
    const operationId = durableQueueOperationId(
      'material-analysis',
      `material-analysis-${analysisId}-1`
    );
    jobs.add(operationId);
    const saved = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operationId)
    );
    if (!saved) throw new Error('Missing admitted analysis outbox.');
    await deliverSottoJob({
      database: instance.database,
      queue: materialAnalysisQueue,
      operationId,
      fingerprint: saved.fingerprint,
      version: 1,
    });
    const job = await materialAnalysisQueue.getJob(operationId);
    if (!job) throw new Error('Missing delivered analysis job.');
    return job;
  }
  const saved = (analysisId: string) =>
    instance.database.materialAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
  const projection = (analysisId: string, token = identity.ownerToken) =>
    status(request(`material-analyses/${analysisId}`, undefined, token), {
      params: Promise.resolve({ analysisId }),
    });
  async function retryInput(analysisId: string, requestId = randomUUID()) {
    const parent = await saved(analysisId);
    return {
      schemaVersion: 1,
      requestId,
      analysisRevision: parent.revision,
      identityDigest: parent.identityDigest,
      resultDigest: parent.resultDigest,
    };
  }
  const retryRequest = (analysisId: string, body: unknown, token = identity.ownerToken) =>
    retry(request(`material-analyses/${analysisId}/retry`, body, token), {
      params: Promise.resolve({ analysisId }),
    });

  async function materialFixture(texts = ['Passiv Präsens: Das Essen wird gekocht.']) {
    const bytes = Buffer.from(texts.join('\n'), 'utf8');
    const originalSha256 = sha(bytes);
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        name: 'Synthetic source.txt',
        mimeType: 'text/plain',
        byteSize: bytes.length,
        extractedText: '',
      },
    });
    await writeStorageReference({
      database: instance.database,
      signal: new AbortController().signal,
      prefix: `materials/${identity.ownerId}/${material.id}/original`,
      extension: 'txt',
      body: bytes,
      contentType: 'text/plain',
      previousReference: () => null,
      captureAdmission: async (database) => ({
        ...(await materialStorageScopes(database, material)),
        consumer: `material:${material.id}:original`,
        snapshot: null,
      }),
      validateAdmission: async (database) => {
        await database.courseMaterial.findFirstOrThrow({
          where: { id: material.id, userId: identity.ownerId },
        });
      },
      commit: async (database, originalUrl) => {
        await database.courseMaterial.update({
          where: { id: material.id },
          data: { originalUrl, originalSha256 },
        });
      },
    });
    const run = await instance.database.materialExtractionRun.create({
      data: {
        materialId: material.id,
        processingRevision: material.processingRevision,
        runKey: sha(Buffer.from(randomUUID())),
        originalSha256,
        extractorVersion: 'synthetic-exact-source-1',
        rendererVersion: 'synthetic-text-inventory-1',
        recognitionPolicy: {},
      },
    });
    const authority = {
      userId: identity.ownerId,
      materialId: material.id,
      runId: run.id,
      processingRevision: material.processingRevision,
      originalSha256,
    };
    await sottoTransaction(
      instance.database,
      async (database) => {
        await initializeMaterialPages(database, authority, texts.length);
        for (const [index, text] of texts.entries()) {
          const prepared = prepareMaterialPageText({
            pageNumber: index + 1,
            source: { origin: 'EMBEDDED_TEXT', method: 'SYNTHETIC_OWNED_SOURCE', version: '1' },
            text,
          });
          await publishMaterialPageText(database, authority, prepared.manifest, prepared.chunks);
        }
        await database.materialPage.updateMany({
          where: { runId: run.id },
          data: {
            visualCoverage: {
              state: 'UNAVAILABLE',
              diagnostic: 'Synthetic text source has no visual recognition.',
            },
          },
        });
        await database.materialExtractionRun.update({
          where: { id: run.id },
          data: { status: 'PARTIAL' },
        });
        await database.courseMaterial.update({
          where: { id: material.id },
          data: { processingStatus: 'PARTIAL' },
        });
      },
      { timeoutMs: 60_000 }
    );
    return { material, run };
  }

  it('retains exact Unicode source and quoted receipts while creating exposure without mastery', async () => {
    const receipt = await admitted();
    const job = await delivered(receipt.analysisId);
    await processMaterialAnalysis(job);
    const row = await saved(receipt.analysisId);
    expect(row.status).toBe('COMPLETE');
    expect(requests).toHaveLength(1);
    expect(requests[0].sources[0].text).toBe(exactText);
    const source = await instance.database.materialAnalysisSource.findFirstOrThrow({
      where: { analysisId: row.id },
    });
    expect(Buffer.from(source.snapshotBytes!).equals(Buffer.from(exactText))).toBe(true);
    expect(sha(row.resultBytes!)).toBe(row.resultDigest);
    const focus = await instance.database.materialSourceFocus.findFirstOrThrow({
      where: { analysisId: row.id },
    });
    const selected = await sottoTransaction(instance.database, (database) =>
      readOwnedMaterialSourceFocus(database, {
        id: focus.id,
        userId: identity.ownerId,
        courseId,
        targetLang: 'de',
        level: 'A2',
      })
    );

    expect(sha(Buffer.from(selected.detailsBase64, 'base64'))).toBe(selected.focusDigest);
    expect(selected.details.citations[0].quote).toBe(exactText);
    expect(selected.sourceContext).toContain('\\u0000');
    expect(selected.contextTruncated).toBe(false);
    const preview = await detail(request(`material-analyses/${row.id}/focuses/${focus.id}`), {
      params: Promise.resolve({ analysisId: row.id, focusId: focus.id }),
    });
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('Passiv Präsens');
    expect(await instance.database.learningObservation.count()).toBe(0);
    expect(await instance.database.learnerObjectiveState.count()).toBe(0);
    expect(
      (await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })).currentLevel
    ).toBe('A2');
    const response = await projection(row.id);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain('credentialFingerprint');
    await processMaterialAnalysis(job);
    expect(requests).toHaveLength(1);
  });
  it('deduplicates concurrent admission and rejects changed request identity before dispatch', async () => {
    const first = input();
    const [left, right] = await Promise.all([
      admitted(first),
      admitted({ ...first, requestId: randomUUID() }),
    ]);
    expect(left.analysisId).toBe(right.analysisId);
    expect(await instance.database.materialAnalysis.count()).toBe(1);
    expect(await instance.database.materialAnalysisRequest.count()).toBe(2);
    expect((await start({ ...first, content: 'Changed source' })).status).toBe(409);
    expect(requests).toHaveLength(0);
  });
  it('rejects foreign profiles, cross-origin mutation and malformed UTF-8 without admitting work', async () => {
    const foreign = await identity.household('Foreign source learner');
    expect((await start(input(), foreign.token)).status).toBe(404);
    expect((await start(input(), identity.ownerToken, 'https://foreign.example')).status).toBe(403);
    const malformed = new NextRequest(
      `http://localhost:3000/api/v1/courses/${courseId}/material-analyses`,
      {
        method: 'POST',
        headers: {
          cookie: `sotto_session=${identity.ownerToken}`,
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: new Uint8Array([0xff]),
      }
    );
    expect((await analyze(malformed, { params: Promise.resolve({ courseId }) })).status).toBe(400);
    expect(await instance.database.materialAnalysis.count()).toBe(0);
    const receipt = await admitted();
    expect((await projection(receipt.analysisId, foreign.token)).status).toBe(404);
    expect(requests).toHaveLength(0);
  });
  it.each(['TRUNCATED', 'INVALID'] as const)(
    'keeps %s responses as failed coverage instead of treating them as complete',
    async (value) => {
      mode = value;
      const receipt = await admitted();
      await processMaterialAnalysis(await delivered(receipt.analysisId));
      expect((await saved(receipt.analysisId)).status).toBe('PARTIAL');
      expect(await instance.database.materialSourceFocus.count()).toBe(0);
      expect((await instance.database.materialAnalysisUnit.findFirstOrThrow()).status).toBe(
        'OUTPUT_INVALID'
      );
      expect(requests).toHaveLength(1);
    }
  );
  it('replays the saved HTTP response after publication crashes and provider configuration rotates', async () => {
    const receipt = await admitted();
    const job = await delivered(receipt.analysisId);
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION synthetic_analysis_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'ANALYZED' THEN RAISE EXCEPTION 'Synthetic analysis publication failure'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER synthetic_analysis_failure BEFORE UPDATE ON "MaterialAnalysisUnit" FOR EACH ROW EXECUTE FUNCTION synthetic_analysis_failure()'
    );
    await expect(processMaterialAnalysis(job)).rejects.toThrow(
      'Synthetic analysis publication failure'
    );
    const unit = await instance.database.materialAnalysisUnit.findFirstOrThrow();
    expect(unit.status).toBe('SUCCEEDED');
    expect(unit.responseBytes?.length).toBeGreaterThan(0);
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER synthetic_analysis_failure ON "MaterialAnalysisUnit"'
    );
    await instance.configureInfrastructure({
      ...(await getServerInfra()),
      aiBaseUrl: 'http://127.0.0.1:1/v1',
    });
    await processMaterialAnalysis(job);
    expect((await saved(receipt.analysisId)).status).toBe('COMPLETE');
    expect(requests).toHaveLength(1);
  });
  it('fences an unknown provider outcome across retries and new admission identities', async () => {
    mode = 'UNKNOWN';
    const receipt = await admitted();
    const job = await delivered(receipt.analysisId);
    await expect(processMaterialAnalysis(job)).rejects.toThrow('unknown outcome');
    await expect(processMaterialAnalysis(job)).rejects.toThrow();
    await sottoTransaction(instance.database, (database) =>
      settleFailedAnalysisJob(database, job, 'material-analysis')
    );
    expect((await saved(receipt.analysisId)).status).toBe('RECOVERY_REQUIRED');
    expect((await start(input())).status).toBe(409);
    expect(
      (await retryRequest(receipt.analysisId, await retryInput(receipt.analysisId))).status
    ).toBe(409);
    expect(await instance.database.materialAnalysis.count()).toBe(1);
    expect(requests).toHaveLength(1);
    expect(await instance.database.materialSourceFocus.count()).toBe(0);
  });

  it('forks retained successful responses offline and keeps exact nonmaterial identities and distinct focus occurrences', async () => {
    const receipt = await admitted();
    const job = await delivered(receipt.analysisId);
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION synthetic_analysis_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'ANALYZED' THEN RAISE EXCEPTION 'Synthetic analysis publication failure'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER synthetic_analysis_failure BEFORE UPDATE ON "MaterialAnalysisUnit" FOR EACH ROW EXECUTE FUNCTION synthetic_analysis_failure()'
    );
    await expect(processMaterialAnalysis(job)).rejects.toThrow(
      'Synthetic analysis publication failure'
    );
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER synthetic_analysis_failure ON "MaterialAnalysisUnit"'
    );
    await sottoTransaction(instance.database, (database) =>
      settleFailedAnalysisJob(database, job, 'material-analysis')
    );
    const parent = await saved(receipt.analysisId);
    expect(parent.status).toBe('FAILED');
    const source = await instance.database.materialAnalysisSource.findFirstOrThrow({
      where: { analysisId: parent.id },
    });
    const unit = await instance.database.materialAnalysisUnit.findFirstOrThrow({
      where: { analysisId: parent.id },
    });
    expect(unit.status).toBe('SUCCEEDED');
    const foreign = await identity.household('Foreign retry learner');
    const body = await retryInput(parent.id);
    expect((await retryRequest(parent.id, body, foreign.token)).status).toBe(404);
    expect(
      (await retryRequest(parent.id, { ...body, identityDigest: '0'.repeat(64) })).status
    ).toBe(409);
    const result = await retryRequest(parent.id, body);
    expect(result.status).toBe(202);
    const child = receiptSchema
      .extend({ counts: z.object({ offlineReplay: z.number(), inherited: z.number() }) })
      .parse(await result.json());
    expect(child.counts).toMatchObject({ offlineReplay: 1, inherited: 1 });
    await instance.configureInfrastructure({
      ...(await getServerInfra()),
      aiBaseUrl: 'http://127.0.0.1:1/v1',
    });
    const childJob = await delivered(child.analysisId);
    const inherited = await instance.database.materialAnalysisUnit.findFirstOrThrow({
      where: { analysisId: child.analysisId },
    });
    const provenance = z.record(z.string(), z.json()).parse(inherited.reuse);
    await instance.database.materialAnalysisUnit.update({
      where: { id: inherited.id },
      data: { reuse: { ...provenance, responseSha256: '0'.repeat(64) } },
    });
    await expect(processMaterialAnalysis(childJob)).rejects.toThrow('inherited source response');
    expect(requests).toHaveLength(1);
    await instance.database.materialAnalysisUnit.update({
      where: { id: inherited.id },
      data: { reuse: provenance },
    });
    await processMaterialAnalysis(childJob);
    expect((await saved(child.analysisId)).status).toBe('COMPLETE');
    expect(requests).toHaveLength(1);
    const childSource = await instance.database.materialAnalysisSource.findFirstOrThrow({
      where: { analysisId: child.analysisId },
    });
    expect(childSource.sourceId).toBe(source.sourceId);
    const projected = z
      .object({
        retryOfAnalysisId: z.string(),
        counts: z.object({ inherited: z.number() }),
        sources: z.array(z.object({ sourceId: z.string() })),
      })
      .parse(await (await projection(child.analysisId)).json());
    expect(projected.retryOfAnalysisId).toBe(parent.id);
    expect(projected.counts.inherited).toBe(1);
    expect(projected.sources[0].sourceId).toBe(source.sourceId);
    expect(childSource.id).not.toBe(source.id);
    expect(Buffer.from(childSource.snapshotBytes!).equals(Buffer.from(source.snapshotBytes!))).toBe(
      true
    );
    expect(await saved(parent.id)).toEqual(parent);
    expect(
      await instance.database.materialAnalysisUnit.findUniqueOrThrow({ where: { id: unit.id } })
    ).toEqual(unit);
    const focus = await instance.database.materialSourceFocus.findFirstOrThrow({
      where: { analysisId: child.analysisId },
    });
    expect(focus.id).not.toBe(focus.localKey);
    expect(
      (
        await detail(request(`material-analyses/${child.analysisId}/focuses/${focus.id}`), {
          params: Promise.resolve({ analysisId: child.analysisId, focusId: focus.id }),
        })
      ).status
    ).toBe(200);
    const response = await retryRequest(parent.id, body);
    expect(receiptSchema.parse(await response.json()).analysisId).toBe(child.analysisId);
    expect(await instance.database.materialAnalysis.count()).toBe(2);
  });

  it('replays an unvalidated saved response offline and permits a fresh grant only after its invalid output is proven', async () => {
    mode = 'INVALID';
    const receipt = await admitted();
    const job = await delivered(receipt.analysisId);
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION synthetic_analysis_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'OUTPUT_INVALID' THEN RAISE EXCEPTION 'Synthetic invalid-output publication failure'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER synthetic_analysis_failure BEFORE UPDATE ON "MaterialAnalysisUnit" FOR EACH ROW EXECUTE FUNCTION synthetic_analysis_failure()'
    );
    await expect(processMaterialAnalysis(job)).rejects.toThrow(
      'Synthetic invalid-output publication failure'
    );
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER synthetic_analysis_failure ON "MaterialAnalysisUnit"'
    );
    await sottoTransaction(instance.database, (database) =>
      settleFailedAnalysisJob(database, job, 'material-analysis')
    );
    const admittedRetry = await retryRequest(
      receipt.analysisId,
      await retryInput(receipt.analysisId)
    );
    expect(admittedRetry.status).toBe(202);
    const replay = receiptSchema.parse(await admittedRetry.json());
    await processMaterialAnalysis(await delivered(replay.analysisId));
    expect((await saved(replay.analysisId)).status).toBe('PARTIAL');
    expect(requests).toHaveLength(1);
    const invalid = await instance.database.materialAnalysisUnit.findFirstOrThrow({
      where: { analysisId: replay.analysisId },
    });
    expect(invalid.status).toBe('OUTPUT_INVALID');
    expect(invalid.grant).toBeNull();
    mode = 'COMPLETE';
    const fresh = await retryRequest(replay.analysisId, await retryInput(replay.analysisId));
    expect(fresh.status).toBe(202);
    const child = receiptSchema.parse(await fresh.json());
    await processMaterialAnalysis(await delivered(child.analysisId));
    expect((await saved(child.analysisId)).status).toBe('COMPLETE');
    expect(requests).toHaveLength(2);
  });

  it('accepts all ten originals plus a paste and course note as twelve distinct sources', async () => {
    const materials = [];
    for (let index = 0; index < 10; index++) materials.push((await materialFixture()).material.id);
    await instance.database.courseNote.create({ data: { courseId, body: 'Owned class note' } });
    const receipt = await admitted({ ...input(), materialIds: materials, includeCourseNote: true });
    const job = await delivered(receipt.analysisId);
    const worker = createWorker('material-analysis', processMaterialAnalysis, { concurrency: 1 });
    try {
      await vi.waitFor(
        async () =>
          expect(['COMPLETE', 'PARTIAL']).toContain((await saved(receipt.analysisId)).status),
        { timeout: 45_000, interval: 100 }
      );
      expect(requests).toHaveLength(12);
      expect(
        await instance.database.materialAnalysisSource.count({
          where: { analysisId: receipt.analysisId },
        })
      ).toBe(12);
      await vi.waitFor(async () => expect(await job.getState()).toBe('completed'), {
        timeout: 10_000,
      });
    } finally {
      await worker.close();
    }
  }, 60_000);

  it('retries one confirmed failure after all 65 pages without redispatching inherited million-character analysis', async () => {
    const texts = Array.from(
      { length: 65 },
      (_, index) => `Page ${index + 1}: Passiv Präsens. ` + 'x'.repeat(16_010)
    );
    expect(texts.reduce((total, text) => total + [...text].length, 0)).toBeGreaterThan(1_000_000);
    const { material } = await materialFixture(texts);
    mode = 'FAILED_PAGE';
    const receipt = await admitted({ ...input(''), materialIds: [material.id] });
    const job = await delivered(receipt.analysisId);
    const worker = createWorker('material-analysis', processMaterialAnalysis, { concurrency: 1 });
    try {
      await vi.waitFor(
        async () => expect((await saved(receipt.analysisId)).status).toBe('PARTIAL'),
        { timeout: 90_000, interval: 200 }
      );
      expect(new Set(requests.map((value) => value.primary.source.pageNumber)).size).toBe(65);
      expect(requests.some((value) => value.primary.source.pageNumber === 65)).toBe(true);
      expect(new Set(requests.map((value) => value.unitId)).size).toBe(requests.length);
      const parentUnits = await instance.database.materialAnalysisUnit.findMany({
        where: { analysisId: receipt.analysisId },
        orderBy: { unitKey: 'asc' },
      });
      const analyzed = parentUnits.filter((unit) => unit.status === 'ANALYZED');
      const failed = parentUnits.filter((unit) => unit.status === 'FAILED');
      expect(analyzed.length).toBeGreaterThanOrEqual(64);
      expect(failed).toHaveLength(1);
      await vi.waitFor(async () => expect(await job.getState()).toBe('completed'), {
        timeout: 10_000,
      });
      const parent = await saved(receipt.analysisId);
      const sourceRows = await instance.database.materialAnalysisSource.findMany({
        where: { analysisId: parent.id },
        orderBy: { order: 'asc' },
      });
      const parentFocus = await instance.database.materialSourceFocus.findMany({
        where: { analysisId: parent.id },
        orderBy: { id: 'asc' },
      });
      const originalRequestCount = requests.length;
      mode = 'COMPLETE';
      const retryBody = await retryInput(parent.id);
      const admittedRetry = await retryRequest(parent.id, retryBody);
      expect(admittedRetry.status).toBe(202);
      const child = receiptSchema
        .extend({ counts: z.object({ inherited: z.number(), failed: z.number() }) })
        .parse(await admittedRetry.json());
      expect(child.analysisId).not.toBe(parent.id);
      expect(child.identityDigest).toBe(parent.identityDigest);
      expect(child.counts.inherited).toBe(analyzed.length);
      expect(child.counts.failed).toBe(1);
      const replay = await retryRequest(parent.id, retryBody);
      expect(receiptSchema.parse(await replay.json()).analysisId).toBe(child.analysisId);
      expect((await retryRequest(parent.id, await retryInput(parent.id))).status).toBe(202);
      const childJob = await delivered(child.analysisId);
      await vi.waitFor(async () => expect((await saved(child.analysisId)).status).toBe('PARTIAL'), {
        timeout: 90000,
        interval: 200,
      });
      await vi.waitFor(async () => expect(await childJob.getState()).toBe('completed'), {
        timeout: 10000,
      });
      expect(requests.length - originalRequestCount).toBe(1);
      expect(requests.at(-1)?.primary.source.pageNumber).toBe(65);
      const inherited = await instance.database.materialAnalysisUnit.findMany({
        where: { analysisId: child.analysisId },
      });
      expect(inherited.filter((unit) => unit.reuse !== null)).toHaveLength(analyzed.length);
      for (const unit of inherited.filter((unit) => unit.reuse !== null)) {
        expect(unit.grant).toBeNull();
        expect(unit.attemptId).toBeNull();
        expect(unit.responseBytes).toBeNull();
      }
      expect(await saved(parent.id)).toEqual(parent);
      expect(
        await instance.database.materialAnalysisUnit.findMany({
          where: { analysisId: parent.id },
          orderBy: { unitKey: 'asc' },
        })
      ).toEqual(parentUnits);
      expect(
        await instance.database.materialSourceFocus.findMany({
          where: { analysisId: parent.id },
          orderBy: { id: 'asc' },
        })
      ).toEqual(parentFocus);
      const childSources = await instance.database.materialAnalysisSource.findMany({
        where: { analysisId: child.analysisId },
        orderBy: { order: 'asc' },
      });
      expect(childSources.map((source) => source.sourceId)).toEqual(
        sourceRows.map((source) => source.sourceId)
      );
      expect(childSources[0].id).not.toBe(sourceRows[0].id);
      expect(
        (await retryRequest(child.analysisId, await retryInput(child.analysisId))).status
      ).toBe(422);
      expect((await retryRequest(parent.id, await retryInput(parent.id))).status).toBe(200);
    } finally {
      await worker.close();
    }
  }, 220_000);

  it('settles a stale source revision without dispatching and exposes the stale analysis', async () => {
    const { material } = await materialFixture();
    const receipt = await admitted({ ...input(''), materialIds: [material.id] });
    const job = await delivered(receipt.analysisId);
    await instance.database.courseMaterial.update({
      where: { id: material.id },
      data: { processingRevision: { increment: 1 } },
    });
    await expect(processMaterialAnalysis(job)).rejects.toThrow('changed');
    await sottoTransaction(instance.database, (database) =>
      settleFailedAnalysisJob(database, job, 'material-analysis')
    );
    expect((await saved(receipt.analysisId)).status).toBe('FAILED');
    expect(
      z.object({ stale: z.boolean() }).parse(await (await projection(receipt.analysisId)).json())
        .stale
    ).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('erases the entire multi-source result and exact grants when one original is deleted', async () => {
    const { material } = await materialFixture();
    const unrelated = (await materialFixture()).material;
    const receipt = await admitted({ ...input(), materialIds: [material.id, unrelated.id] });
    const job = await delivered(receipt.analysisId);
    await processMaterialAnalysis(job);
    const units = await instance.database.materialAnalysisUnit.findMany({
      where: { analysisId: receipt.analysisId },
    });
    const grants = units.map((unit) => `${SIDEDOOR_STATE_ID}:material-analysis-grant:${unit.id}`);
    expect(await instance.database.sidedoorState.count({ where: { id: { in: grants } } })).toBe(3);
    await sottoTransaction(
      instance.database,
      async (database) => {
        await admitLearningStorageDeletion({
          database,
          scope: { kind: 'material', id: material.id },
          subjects: [
            { subjectId: `material:${material.id}`, generation: material.createdAt.getTime() },
          ],
          currentBackend: await captureStorageBackend(),
        });
        await database.courseMaterial.delete({ where: { id: material.id } });
      },
      { timeoutMs: 60_000 }
    );
    expect(
      await instance.database.materialAnalysis.count({ where: { id: receipt.analysisId } })
    ).toBe(0);
    expect(await instance.database.materialSourceFocus.count()).toBe(0);
    expect(await instance.database.sidedoorState.count({ where: { id: { in: grants } } })).toBe(0);
    expect(
      await instance.database.courseMaterial.findUnique({ where: { id: unrelated.id } })
    ).not.toBeNull();
    await expect(processMaterialAnalysis(job)).resolves.toBeUndefined();
    expect(requests).toHaveLength(3);
  });

  it('settles a paste-only placement job after attachment and course deletion using its original immutable scope', async () => {
    const original = request('placement/from-notes', input());
    const admission = await authenticateRequest(original);
    if (!admission) throw new Error('Missing fixture admission.');
    const receipt = await requestMaterialAnalysis(
      sottoRequestExecution(original, admission),
      input()
    );
    const job = await delivered(receipt.analysisId);
    await instance.database.materialAnalysis.update({
      where: { id: receipt.analysisId },
      data: { attachedCourseId: courseId },
    });
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    await sottoTransaction(
      instance.database,
      async (database) => {
        await admitLearningStorageDeletion({
          database,
          scope: { kind: 'course', id: courseId, episodeIds: [] },
          subjects: [{ subjectId: `course:${courseId}`, generation: course.createdAt.getTime() }],
          currentBackend: await captureStorageBackend(),
        });
        await database.course.delete({ where: { id: courseId } });
      },
      { timeoutMs: 60_000 }
    );
    expect(await instance.database.materialAnalysis.count()).toBe(0);
    await expect(processMaterialAnalysis(job)).resolves.toBeUndefined();
    const operationId = durableQueueOperationId(
      'material-analysis',
      `material-analysis-${receipt.analysisId}-1`
    );
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(operationId)
        )
      )?.complete
    ).toBe(true);
    expect(requests).toHaveLength(0);
  });
  registerOnboardingMaterialReplayCase(() => ({
    instance,
    identity,
    courseId,
    admitted,
    input,
    delivered,
    request,
    saved,
    projection,
  }));
  registerMaterialRetryAliasCase(() => ({
    instance,
    identity,
    admitted,
    delivered,
    retryInput,
    retryRequest,
    saved,
    requests,
    setMode: (value) => {
      mode = value;
    },
  }));
});
