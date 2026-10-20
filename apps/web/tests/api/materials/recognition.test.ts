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
import {
  POST as review,
  PATCH as revoke,
} from '@/app/api/v1/admin/material-recognition-capabilities/route';
import {
  GET as options,
  POST as recognize,
} from '@/app/api/v1/materials/[materialId]/recognize/route';
import { GET as processing } from '@/app/api/v1/materials/[materialId]/processing/route';
import { GET as pageText } from '@/app/api/v1/materials/[materialId]/pages/[pageNumber]/text/route';
import { materialStorageScopes } from '@/lib/course-materials';
import { enqueueMaterialExtraction } from '@/lib/course-materials/extraction/admission';
import { processMaterialExtraction } from '@/lib/course-materials/extraction/processing';
import { materialRecognitionCapabilitySchema } from '@/lib/course-materials/recognition/protocol';
import { settleFailedMaterialJob } from '@/lib/course-materials/jobs/failure';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { deliverSottoJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { durableQueueOperationId } from '@/lib/sidedoor/jobs/core/durable-queue';
import { materialExtractionQueue } from '@/lib/queue';
import { closeRedis } from '@/lib/redis';
import { getServerInfra } from '@/lib/server-config';
import { syntheticMaterialPdf } from '../../helpers/materials/pdf';
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
// Restore the actual SDK, which the global unit-test setup otherwise replaces.
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(`${process.cwd()}/package.json`)('openai') };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const receiptSchema = z.object({
  materialId: z.uuid(),
  runId: z.uuid(),
  processingRevision: z.number(),
  requestId: z.uuid(),
  status: z.string(),
});
const optionsSchema = z.object({
  capabilitySha256: z.string(),
  expectedProcessingRevision: z.number(),
});
const requestEnvelope = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.union([
        z.string(),
        z.array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            image_url: z.object({ url: z.string() }).optional(),
          })
        ),
      ]),
    })
  ),
});
const pageMetadata = z.object({
  inputDigest: z.string(),
  pageNumber: z.number(),
  tiles: z.array(z.object({ imageSha256: z.string(), width: z.number(), height: z.number() })),
});
const exactText = 'Printed source\nwerde\nwürde? e\u0301 🙂\u0000';
type Mode = 'TRANSCRIBED' | 'UNCERTAIN' | 'BLANK' | 'EMPTY' | 'UNKNOWN';
suite('explicit reviewed full-page material recognition', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let directory: string;
  let server: Server;
  let endpoint: string;
  let mode: Mode = 'TRANSCRIBED';
  const requests: { image: Buffer; inputDigest: string; imageSha256: string }[] = [];
  const jobs = new Set<string>();
  beforeAll(async () => {
    instance = await createSharedTestInstance('material_recognize_http');
    boundary.database = instance.database;
    directory = await mkdtemp(join(tmpdir(), 'sotto-recognition-http-'));
    server = createServer(async (request, response) => {
      try {
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions')
          throw new Error('Unexpected synthetic provider endpoint.');
        const body: Buffer[] = [];
        for await (const chunk of request) body.push(Buffer.from(chunk));
        const input = requestEnvelope.parse(JSON.parse(Buffer.concat(body).toString('utf8')));
        const user = input.messages.find((message) => message.role === 'user');
        if (!user || typeof user.content === 'string')
          throw new Error('Missing actual image request.');
        const text = user.content.find((part) => part.type === 'text')?.text;
        const dataUrl = user.content.find((part) => part.type === 'image_url')?.image_url?.url;
        if (!text || !dataUrl?.startsWith('data:image/png;base64,'))
          throw new Error('Missing full-page PNG.');
        const metadata = pageMetadata.parse(JSON.parse(text));
        const image = Buffer.from(dataUrl.split(',')[1], 'base64');
        requests.push({
          image,
          inputDigest: metadata.inputDigest,
          imageSha256: metadata.tiles[0].imageSha256,
        });
        if (mode === 'UNKNOWN') {
          request.socket.destroy();
          return;
        }
        const state = mode === 'EMPTY' ? 'TRANSCRIBED' : mode;
        const output = {
          schemaVersion: 1,
          inputDigest: metadata.inputDigest,
          pageNumber: metadata.pageNumber,
          tiles: [
            {
              index: 0,
              state,
              fullVisibleCoverage: state !== 'UNCERTAIN',
              hasHandwriting: state !== 'BLANK',
              transcription: mode === 'BLANK' || mode === 'EMPTY' ? '' : exactText,
              uncertainties:
                state === 'UNCERTAIN'
                  ? [
                      {
                        region: { x: 0, y: 0, width: 1, height: 1 },
                        reason: 'ILLEGIBLE',
                        detail: 'A visible stroke cannot be resolved.',
                        codePointStart: null,
                        codePointEnd: null,
                      },
                    ]
                  : [],
            },
          ],
        };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'synthetic-owned-response',
            object: 'chat.completion',
            created: 1,
            model: input.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify(output) },
                finish_reason: 'stop',
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
    if (!address || typeof address === 'string') throw new Error('Missing local fixture address.');
    endpoint = `http://127.0.0.1:${address.port}/v1`;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(directory, 'executions'));
    identity = await instance.reset();
    mode = 'TRANSCRIBED';
    requests.length = 0;
    await instance.configureInfrastructure({
      ...(await getServerInfra()),
      aiProvider: 'local',
      aiModel: 'local:synthetic-reviewed-vision',
      aiBaseUrl: endpoint,
    });
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { preferredAiProvider: 'local', preferredAiModel: 'local:synthetic-reviewed-vision' },
    });
  });
  afterEach(async () => {
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS synthetic_visual_failure ON "MaterialPage"'
    );
    await instance.database.$executeRawUnsafe('DROP FUNCTION IF EXISTS synthetic_visual_failure()');
    for (const id of jobs) await (await materialExtractionQueue.getJob(id))?.remove();
    jobs.clear();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await materialExtractionQueue.close();
    await closeRedis();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    boundary.database = null;
    await instance?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  function request(path: string, body?: unknown, token = identity.ownerToken) {
    return new NextRequest(`http://localhost:3000/api/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        cookie: `sotto_session=${token}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function reviewed() {
    const capability = materialRecognitionCapabilitySchema.parse({
      schemaVersion: 1,
      source: 'REVIEWED_MODEL_CAPABILITY',
      reviewId: 'synthetic-owned-review',
      revision: 'review-1',
      provider: 'local',
      model: 'local:synthetic-reviewed-vision',
      endpoint,
      vision: true,
      handwriting: true,
      maxImages: 1,
      maxDecodedBytes: 2_000_000,
      minimumDpi: 150,
      maxOutputTokens: 2048,
    });
    const response = await review(
      request('admin/material-recognition-capabilities', {
        expectedRevision: 0,
        operatorConfirmed: true,
        capability,
        documentationUrl: 'https://example.com/synthetic-vision-documentation',
      })
    );
    expect(response.status).toBe(200);
  }
  async function fixture(pages = ['BT /F1 8 Tf 10 80 Td (Printed source) Tj ET']) {
    const bytes = syntheticMaterialPdf(pages, {
      ink: true,
    });
    const originalSha256 = createHash('sha256').update(bytes).digest('hex');
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        name: 'Synthetic handwritten worksheet.pdf',
        mimeType: 'application/pdf',
        byteSize: bytes.length,
        extractedText: '',
      },
    });
    await writeStorageReference({
      database: instance.database,
      signal: new AbortController().signal,
      prefix: `materials/${identity.ownerId}/${material.id}/original`,
      extension: 'pdf',
      body: bytes,
      contentType: 'application/pdf',
      previousReference: () => null,
      captureAdmission: async (database) => ({
        ...(await materialStorageScopes(database, material)),
        consumer: `material:${material.id}:original`,
        snapshot: null,
      }),
      validateAdmission: async (database, captured, published) => {
        const current = await database.courseMaterial.findFirstOrThrow({
          where: { id: material.id, userId: identity.ownerId, originalUrl: published ?? null },
        });
        const scopes = await materialStorageScopes(database, current);
        if (
          scopes.instanceId !== captured.instanceId ||
          JSON.stringify(scopes.scopes) !== JSON.stringify(captured.scopes)
        )
          throw new Error('Original fixture authority changed.');
      },
      commit: async (database, originalUrl) => {
        await database.courseMaterial.update({
          where: { id: material.id },
          data: { originalUrl, originalSha256 },
        });
      },
    });
    const run = await sottoTransaction(instance.database, (database) =>
      enqueueMaterialExtraction(database, material.id)
    );
    await processMaterialExtraction(await delivered(material.id, 1));
    const initial = await instance.database.materialExtractionRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(initial.status).toBe('PARTIAL');
    expect(requests).toHaveLength(0);
    return { material, initial, originalSha256 };
  }
  async function delivered(materialId: string, revision: number) {
    const operationId = durableQueueOperationId(
      'material-extraction',
      `material-extraction-${materialId}-${revision}`
    );
    jobs.add(operationId);
    const saved = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operationId)
    );
    if (!saved) throw new Error('Missing admitted extraction job.');
    await deliverSottoJob({
      database: instance.database,
      queue: materialExtractionQueue,
      operationId,
      fingerprint: saved.fingerprint,
      version: 1,
    });
    const job = await materialExtractionQueue.getJob(operationId);
    if (!job) throw new Error('Missing delivered extraction job.');
    return job;
  }
  async function admission(materialId: string) {
    const response = await options(request(`materials/${materialId}/recognize`), {
      params: Promise.resolve({ materialId }),
    });
    expect(response.status).toBe(200);
    const selected = optionsSchema.parse(await response.json());
    return { schemaVersion: 1 as const, requestId: randomUUID(), ...selected };
  }
  function start(materialId: string, input: unknown, token = identity.ownerToken) {
    return recognize(request(`materials/${materialId}/recognize`, input, token), {
      params: Promise.resolve({ materialId }),
    });
  }
  async function admitted(materialId: string) {
    const input = await admission(materialId);
    const response = await start(materialId, input);
    expect(response.status).toBe(202);
    return { input, receipt: receiptSchema.parse(await response.json()) };
  }
  async function runStatus(runId: string) {
    return instance.database.materialExtractionRun.findUniqueOrThrow({ where: { id: runId } });
  }
  async function source(materialId: string, runId: string, origin: string) {
    const response = await pageText(
      request(`materials/${materialId}/pages/1/text?runId=${runId}&origin=${origin}`),
      { params: Promise.resolve({ materialId, pageNumber: '1' }) }
    );
    expect(response.status).toBe(200);
    return z
      .object({ chunks: z.array(z.object({ text: z.string() })) })
      .parse(await response.json())
      .chunks.map((chunk) => chunk.text)
      .join('');
  }

  it('renders the retained original, dispatches once and publishes separate complete source evidence without mastery credit', async () => {
    const { material, initial, originalSha256 } = await fixture();
    await reviewed();
    const { input, receipt } = await admitted(material.id);
    expect(receipt.processingRevision).toBe(2);
    await processMaterialExtraction(await delivered(material.id, 2));
    expect((await runStatus(receipt.runId)).status).toBe('COMPLETE');
    expect(requests).toHaveLength(1);
    const image = requests[0].image;
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(image.readUInt32BE(16)).toBe(360);
    expect(image.readUInt32BE(20)).toBe(360);
    expect(createHash('sha256').update(image).digest('hex')).toBe(requests[0].imageSha256);
    expect(await source(material.id, receipt.runId, 'VISUAL_RECOGNITION')).toBe(exactText);
    expect(await source(material.id, initial.id, 'EMBEDDED_TEXT')).toContain('Printed source');
    expect(await source(material.id, receipt.runId, 'EMBEDDED_TEXT')).toContain('Printed source');
    const current = await instance.database.courseMaterial.findUniqueOrThrow({
      where: { id: material.id },
    });
    expect(current.originalSha256).toBe(originalSha256);
    expect(current.extractedText).toBe('');
    expect(await instance.database.learningObservation.count()).toBe(0);
    expect(await instance.database.learnerObjectiveState.count()).toBe(0);
    const repeated = await start(material.id, input);
    expect(repeated.status).toBe(200);
    expect(receiptSchema.parse(await repeated.json()).runId).toBe(receipt.runId);
    const newer = await admitted(material.id);
    jobs.add(
      durableQueueOperationId('material-extraction', `material-extraction-${material.id}-3`)
    );
    expect(newer.receipt.processingRevision).toBe(3);
    const oldReplay = await start(material.id, input);
    expect(receiptSchema.parse(await oldReplay.json()).runId).toBe(receipt.runId);
    expect(
      (await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: material.id } }))
        .processingRevision
    ).toBe(3);
    expect(requests).toHaveLength(1);
  });
  it('rejects a foreign profile, stale revision, changed capability and replay identity before any dispatch', async () => {
    const { material } = await fixture();
    await reviewed();
    const input = await admission(material.id);
    const foreign = await identity.household('Foreign recognition learner');
    const malformed = await recognize(
      new NextRequest(`http://localhost:3000/api/v1/materials/${material.id}/recognize`, {
        method: 'POST',
        headers: {
          cookie: `sotto_session=${identity.ownerToken}`,
          origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: new Uint8Array([0xff]),
      }),
      { params: Promise.resolve({ materialId: material.id }) }
    );
    expect(malformed.status).toBe(400);
    expect((await start(material.id, input, foreign.token)).status).toBe(404);
    expect(
      (
        await options(request(`materials/${material.id}/recognize`, undefined, foreign.token), {
          params: Promise.resolve({ materialId: material.id }),
        })
      ).status
    ).toBe(404);
    expect((await start(material.id, { ...input, expectedProcessingRevision: 2 })).status).toBe(
      409
    );
    expect((await start(material.id, { ...input, capabilitySha256: '0'.repeat(64) })).status).toBe(
      409
    );
    const accepted = await start(material.id, input);
    expect(accepted.status).toBe(202);
    jobs.add(
      durableQueueOperationId('material-extraction', `material-extraction-${material.id}-2`)
    );
    expect((await start(material.id, { ...input, expectedProcessingRevision: 2 })).status).toBe(
      409
    );
    expect(
      await instance.database.materialExtractionRun.count({ where: { materialId: material.id } })
    ).toBe(2);
    expect(requests).toHaveLength(0);
  });
  it('retains uncertain transcription as a separate source while complete visual coverage stays unresolved', async () => {
    const { material } = await fixture();
    await reviewed();
    mode = 'UNCERTAIN';
    const { receipt } = await admitted(material.id);
    await processMaterialExtraction(await delivered(material.id, 2));
    expect((await runStatus(receipt.runId)).status).toBe('PARTIAL');
    const page = await instance.database.materialPage.findFirstOrThrow({
      where: { runId: receipt.runId },
    });
    expect(page.visualCoverage).toMatchObject({ state: 'UNCERTAIN' });
    expect(await source(material.id, receipt.runId, 'VISUAL_RECOGNITION')).toBe(exactText);
    const status = await processing(request(`materials/${material.id}/processing`), {
      params: Promise.resolve({ materialId: material.id }),
    });
    expect(status.status).toBe(200);
    expect(await status.text()).toContain('PARTIAL');
    expect(requests).toHaveLength(1);
  });
  it.each(['policy', 'selection'] as const)(
    'rejects a tampered frozen recognition %s before any page dispatch',
    async (field) => {
      const { material } = await fixture();
      await reviewed();
      const { receipt } = await admitted(material.id);
      await instance.database.materialExtractionRun.update({
        where: { id: receipt.runId },
        data:
          field === 'policy'
            ? { recognitionPolicy: { schemaVersion: 1, method: 'EXPLICIT_CONFIGURATION_REQUIRED' } }
            : { providerSelection: { provider: 'local', model: 'local:unreviewed-replacement' } },
      });
      await expect(processMaterialExtraction(await delivered(material.id, 2))).rejects.toThrow();
      expect(requests).toHaveLength(0);
      expect(
        await instance.database.materialRecognitionOperation.count({
          where: { runId: receipt.runId },
        })
      ).toBe(0);
      expect(await instance.database.materialPage.count({ where: { runId: receipt.runId } })).toBe(
        0
      );
    }
  );
  it('blocks newly dispatched page work when its reviewed capability is revoked after admission', async () => {
    const { material } = await fixture();
    await reviewed();
    const { receipt } = await admitted(material.id);
    const revoked = await revoke(
      new NextRequest(
        request('admin/material-recognition-capabilities', {
          expectedRevision: 1,
          reviewId: 'synthetic-owned-review',
          revision: 'review-1',
          active: false,
        }),
        { method: 'PATCH' }
      )
    );
    expect(revoked.status).toBe(200);
    const job = await delivered(material.id, 2);
    await expect(processMaterialExtraction(job)).rejects.toThrow('revoked');
    expect(requests).toHaveLength(0);
    expect(
      await instance.database.materialRecognitionOperation.count({
        where: { runId: receipt.runId },
      })
    ).toBe(0);
    expect((await runStatus(receipt.runId)).status).not.toBe('COMPLETE');
  });
  it.each(['BLANK', 'EMPTY'] as const)(
    'does not infer a blank printed page from a %s response',
    async (responseMode) => {
      const { material } = await fixture();
      await reviewed();
      mode = responseMode;
      const { receipt } = await admitted(material.id);
      await processMaterialExtraction(await delivered(material.id, 2));
      expect((await runStatus(receipt.runId)).status).toBe('PARTIAL');
      const page = await instance.database.materialPage.findFirstOrThrow({
        where: { runId: receipt.runId },
      });
      expect(page.visualCoverage).toMatchObject({
        state: responseMode === 'BLANK' ? 'UNCERTAIN' : 'FAILED',
      });
      expect(await source(material.id, receipt.runId, 'EMBEDDED_TEXT')).toContain('Printed source');
      expect(requests).toHaveLength(1);
    }
  );
  it('fences unknown network outcomes against worker redispatch and a new recognition revision', async () => {
    const { material } = await fixture();
    await reviewed();
    mode = 'UNKNOWN';
    const { receipt } = await admitted(material.id);
    const job = await delivered(material.id, 2);
    await expect(processMaterialExtraction(job)).rejects.toThrow();
    const operation = await instance.database.materialRecognitionOperation.findFirstOrThrow({
      where: { runId: receipt.runId },
    });
    expect(operation.status).toBe('UNKNOWN');
    expect(requests).toHaveLength(1);
    await expect(processMaterialExtraction(job)).rejects.toThrow();
    expect(requests).toHaveLength(1);
    await sottoTransaction(instance.database, (database) =>
      settleFailedMaterialJob(database, job, 'material-extraction')
    );
    expect((await runStatus(receipt.runId)).status).toBe('RECOVERY_REQUIRED');
    const next = { ...(await admission(material.id)), requestId: randomUUID() };
    expect((await start(material.id, next)).status).toBe(409);
    expect(requests).toHaveLength(1);
  });
  it('marks an invalid saved response failed on crash replay and continues later pages without redispatching the saved page', async () => {
    const { material } = await fixture([
      'BT /F1 8 Tf 10 80 Td (Printed source) Tj ET',
      'BT /F1 8 Tf 10 80 Td (Second printed page) Tj ET',
    ]);
    await reviewed();
    mode = 'EMPTY';
    const { receipt } = await admitted(material.id);
    const job = await delivered(material.id, 2);
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION synthetic_visual_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."pageNumber" = 1 AND NEW."visualCoverage"->>'state' = 'FAILED' THEN RAISE EXCEPTION 'Synthetic invalid response publication interruption'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER synthetic_visual_failure BEFORE UPDATE ON "MaterialPage" FOR EACH ROW EXECUTE FUNCTION synthetic_visual_failure()'
    );
    await expect(processMaterialExtraction(job)).rejects.toThrow(
      'Synthetic invalid response publication interruption'
    );
    const operation = await instance.database.materialRecognitionOperation.findFirstOrThrow({
      where: { runId: receipt.runId, pageNumber: 1 },
    });
    expect(operation.status).toBe('SUCCEEDED');
    expect(
      await instance.database.materialRecognitionResponse.count({
        where: { operationId: operation.id },
      })
    ).toBe(1);
    expect(requests).toHaveLength(1);
    const savedDigest = requests[0].inputDigest;
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER synthetic_visual_failure ON "MaterialPage"'
    );
    mode = 'TRANSCRIBED';
    await processMaterialExtraction(job);
    expect((await runStatus(receipt.runId)).status).toBe('PARTIAL');
    const pages = await instance.database.materialPage.findMany({
      where: { runId: receipt.runId },
      orderBy: { pageNumber: 'asc' },
    });
    expect(pages).toHaveLength(2);
    expect(pages[0].visualCoverage).toMatchObject({ state: 'FAILED' });
    expect(pages[1].visualCoverage).toMatchObject({ state: 'RECOGNIZED' });
    expect(requests).toHaveLength(2);
    expect(requests.filter((entry) => entry.inputDigest === savedDigest)).toHaveLength(1);
    const retained = await instance.database.materialRecognitionOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });
    expect(retained.status).toBe('SUCCEEDED');
    expect(retained.identityDigest).toBe(operation.identityDigest);
  });
  it('replays a saved successful response offline after publication rollback and review revocation', async () => {
    const { material } = await fixture();
    await reviewed();
    const { receipt } = await admitted(material.id);
    const job = await delivered(material.id, 2);
    // A real PostgreSQL publication fault leaves the separately committed provider
    // receipt intact. The failed transaction rolls back its text and page state.
    await instance.database.$executeRawUnsafe(
      `CREATE FUNCTION synthetic_visual_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."visualCoverage"->>'state' = 'RECOGNIZED' THEN RAISE EXCEPTION 'Synthetic page publication interruption'; END IF; RETURN NEW; END $$`
    );
    await instance.database.$executeRawUnsafe(
      'CREATE TRIGGER synthetic_visual_failure BEFORE UPDATE ON "MaterialPage" FOR EACH ROW EXECUTE FUNCTION synthetic_visual_failure()'
    );
    await expect(processMaterialExtraction(job)).rejects.toThrow(
      'Synthetic page publication interruption'
    );
    const operation = await instance.database.materialRecognitionOperation.findFirstOrThrow({
      where: { runId: receipt.runId },
    });
    expect(operation.status).toBe('SUCCEEDED');
    expect(
      await instance.database.materialRecognitionResponse.count({
        where: { operationId: operation.id },
      })
    ).toBe(1);
    expect(
      await instance.database.materialPageText.count({
        where: { page: { runId: receipt.runId }, origin: 'VISUAL_RECOGNITION' },
      })
    ).toBe(0);
    await instance.database.$executeRawUnsafe(
      'DROP TRIGGER synthetic_visual_failure ON "MaterialPage"'
    );
    const revoked = await revoke(
      new NextRequest(
        request('admin/material-recognition-capabilities', {
          expectedRevision: 1,
          reviewId: 'synthetic-owned-review',
          revision: 'review-1',
          active: false,
        }),
        { method: 'PATCH' }
      )
    );
    expect(revoked.status).toBe(200);
    mode = 'UNKNOWN';
    await processMaterialExtraction(job);
    expect((await runStatus(receipt.runId)).status).toBe('COMPLETE');
    expect(await source(material.id, receipt.runId, 'VISUAL_RECOGNITION')).toBe(exactText);
    expect(requests).toHaveLength(1);
    const retained = await instance.database.materialRecognitionOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });
    expect(retained.identityDigest).toBe(operation.identityDigest);
  });
});
