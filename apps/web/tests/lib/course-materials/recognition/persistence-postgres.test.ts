// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { CapturedLearningAi } from '@/lib/learning-ai';
import { captureSottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';
import {
  captureSottoCredentialOwner,
  sottoCredentialStorage,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  createMaterialRecognitionOperation,
  materialRecognitionHttpStore,
  materialRecognitionCliStore,
  readMaterialRecognitionReceipt,
  readMaterialRecognitionIdentity,
  markMaterialRecognitionUnknown,
} from '@/lib/course-materials/recognition/persistence';
import {
  materialRecognitionHash,
  prepareMaterialRecognition,
  rebuildMaterialRecognitionInput,
  type MaterialRecognitionSource,
} from '@/lib/course-materials/recognition/protocol';
import {
  replayMaterialRecognitionCli,
  executeMaterialRecognitionHttp,
  replayMaterialRecognitionHttp,
  type MaterialRecognitionCliReceipt,
  type MaterialRecognitionHttpReceipt,
} from '@/lib/course-materials/recognition/execute';
import type { PreparedMaterialRecognition } from '@/lib/course-materials/recognition/protocol';
import { initializeMaterialPages } from '@/lib/course-materials/extraction/persistence';
import { materialPdfPageSchema } from '@/lib/course-materials/extraction/pdf-protocol';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { deleteSottoProfile } from '@/lib/sidedoor/access/deletion/profile-deletion';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { captureStorageBackend } from '@/lib/r2';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(`${process.cwd()}/package.json`)('openai') };
});
// Storage cleanup runs after erasure commits. These database cases retain its
// real admission/manifests and replace only the asynchronous storage-I/O boundary.
vi.mock('@/lib/sidedoor/storage/migration/storage-cleanup-runtime', () => ({
  runSottoStorageCleanup: async () => {},
}));

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKm0AAAAASUVORK5CYII=',
  'base64'
);
const originalSha256 = 'a'.repeat(64);
const cliBinding = {
  kind: 'LOCAL_ACCOUNT' as const,
  fingerprint: 'b'.repeat(64),
  revision: 'owned-account-v1',
};

suite('durable owned material recognition receipts', () => {
  let instance: SharedTestInstance;
  let owner: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('material_recognition');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'synthetic-material-recognition-test-key');
    owner = await instance.reset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  const transaction = <Result>(
    operation: (database: Prisma.TransactionClient) => Promise<Result>
  ) => sottoTransaction(instance.database, operation, { timeoutMs: 60_000 });

  async function rotateAiCredential() {
    await transaction(async (database) => {
      const storage = await sottoCredentialStorage(database, 'ai', 'openai');
      const credentialOwner = await captureSottoCredentialOwner(database, owner.ownerId);
      const target = { ...storage.slot, owner: credentialOwner };
      const current = await storage.owned.head(target);
      if (!current.credential) throw new Error('Expected existing owned credential');
      await storage.owned.replace(
        storage.owned.prepareReplacement(target, {
          expectedHeadRevision: current.revision,
          credentialRevision: randomUUID(),
          values: { apiKey: 'rotated-owned-fixture-key' },
          binding: current.credential.binding,
          availability: 'enabled',
          label: 'Owned fixture',
          metadata: { createdAt: 1, updatedAt: 2, lastUsedAt: null },
        })
      );
    });
  }

  async function fixture(
    mode: 'HTTP' | 'CLI' = 'HTTP',
    useCredential = false,
    profileId = owner.ownerId
  ) {
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: profileId,
        name: 'Owned fixture.pdf',
        mimeType: 'application/pdf',
        byteSize: 100,
        originalUrl: `materials/${randomUUID()}/original.pdf`,
        originalSha256,
        extractedText: '',
        processingStatus: 'EXTRACTING',
      },
    });
    const run = await instance.database.materialExtractionRun.create({
      data: {
        materialId: material.id,
        processingRevision: 1,
        runKey: sha(Buffer.from(randomUUID())),
        originalSha256,
        extractorVersion: 'owned-extractor-v1',
        rendererVersion: 'owned-renderer-v1',
        recognitionPolicy: { kind: 'EXPLICIT_REVIEWED_MODEL', version: 1 },
      },
    });
    const input = {
      userId: profileId,
      materialId: material.id,
      runId: run.id,
      processingRevision: 1,
      originalSha256,
    };
    await transaction((database) => initializeMaterialPages(database, input, 1));
    const user = await instance.database.user.findUniqueOrThrow({ where: { id: profileId } });
    const source: MaterialRecognitionSource = {
      schemaVersion: 1,
      runtimeRevision: 'owned-runtime-v1',
      material: {
        id: material.id,
        userId: profileId,
        generation: material.createdAt.getTime(),
        ownerGeneration: user.createdAt.getTime(),
        processingRevision: 1,
        originalSha256,
      },
      page: { number: 1, width: 1, height: 1, imageSha256: sha(png) },
      renderer: {
        method: 'PDFJS_PAGE_TEXT_AND_DISPLAY_RENDER',
        version: run.rendererVersion,
        dpi: 144,
        rotation: '0',
        includeAnnotations: true,
        background: 'WHITE',
        format: 'PNG',
      },
      tiles: [{ index: 0, x: 0, y: 0, width: 1, height: 1, imageSha256: sha(png) }],
    };
    const renderPage = materialPdfPageSchema.parse({
      schemaVersion: 1,
      pageNumber: 1,
      width: 0.5,
      height: 0.5,
      rotation: 0,
      text: {
        state: 'FAILED',
        manifest: null,
        artifact: null,
        chunksArtifact: null,
        positionsArtifact: null,
      },
      image: {
        file: 'owned-page.png',
        sha256: sha(png),
        byteSize: png.length,
        width: 1,
        height: 1,
        scale: 2,
        mimeType: 'image/png',
        rgbaSha256: 'c'.repeat(64),
      },
      annotationsArtifact: null,
      annotationMeaningSha256: null,
      annotationCount: 0,
      visualState: 'RECOGNITION_NEEDED',
      diagnostics: [],
    });
    await instance.database.materialPage.update({
      where: { runId_pageNumber: { runId: run.id, pageNumber: 1 } },
      data: {
        pageImageSha256: sha(png),
        renderIdentity: { originalSha256, rendererVersion: run.rendererVersion, page: renderPage },
      },
    });
    const authorize = async (database: Prisma.TransactionClient) => {
      await database.user.findUniqueOrThrow({ where: { id: profileId } });
      return { userId: profileId };
    };
    if (useCredential)
      await instance.seedAiCredential(profileId, 'openai', 'owned-no-network-fixture');
    const credential = useCredential
      ? await transaction((database) =>
          captureSottoExecutionCredential(database, authorize, 'ai', 'openai', false)
        )
      : null;
    const ai: CapturedLearningAi = {
      provider: mode === 'CLI' ? 'codex' : useCredential ? 'openai' : 'local',
      model:
        mode === 'CLI'
          ? 'codex:owned-fixture'
          : useCredential
            ? 'owned-vision-fixture'
            : 'local:owned-vision-fixture',
      ...(mode === 'CLI'
        ? {}
        : { endpoint: credential?.binding.endpoint ?? 'http://127.0.0.1:9999/v1' }),
      ...(credential ? { apiKey: 'owned-no-network-fixture' } : {}),
      execution: { userId: profileId, authorize, credential },
    };
    const prepared = prepareMaterialRecognition({
      ai,
      source,
      images: [{ index: 0, bytes: png }],
      capability: {
        schemaVersion: 1,
        source: 'REVIEWED_MODEL_CAPABILITY',
        reviewId: 'owned-fixture-review',
        revision: 'v1',
        provider: ai.provider,
        model: ai.model,
        endpoint: ai.endpoint ?? null,
        vision: true,
        handwriting: true,
        maxImages: 5,
        maxDecodedBytes: 2_000_000,
        minimumDpi: 144,
        maxOutputTokens: 1024,
      },
    });
    const create = () =>
      transaction((database) =>
        createMaterialRecognitionOperation(database, {
          run: input,
          ai,
          prepared,
          mode,
          ...(mode === 'CLI' ? { cliBinding } : {}),
          expiresAt: Date.now() + 60_000,
        })
      );
    const operation = await create();
    const context = { run: input, execution: ai.execution, operationId: operation.id };
    const http = materialRecognitionHttpStore({ run: input, ai, operationId: operation.id });
    const cli = materialRecognitionCliStore({
      run: input,
      ai,
      operationId: operation.id,
      validateBinding: async (_database, expected) => {
        if (materialRecognitionHash(expected) !== materialRecognitionHash(cliBinding))
          throw new Error('Owned account binding changed.');
      },
    });
    const attempt = {
      id: randomUUID(),
      fingerprint:
        mode === 'HTTP'
          ? 'd'.repeat(64)
          : materialRecognitionHash({
              inputDigest: prepared.inputDigest,
              selection: prepared.selection,
              binding: cliBinding,
            }),
    };
    return { input, ai, prepared, operation, context, http, cli, attempt, create };
  }
  function response(text = 'Private recognition response 😀\0é') {
    const body = Buffer.from(text, 'utf8');
    return {
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']] as [string, string][],
      bodyBase64: body.toString('base64'),
      bodySha256: sha(body),
    };
  }

  it('reuses one immutable scope across registration replay and competing admissions', async () => {
    const fixtureInput = await fixture();
    expect((await fixtureInput.create()).id).toBe(fixtureInput.operation.id);
    const results = await Promise.all(
      [fixtureInput.attempt, { id: randomUUID(), fingerprint: 'e'.repeat(64) }].map((attempt) =>
        transaction((database) => fixtureInput.http.admit(database, attempt))
      )
    );
    expect(results.map((result) => result.dispatch).sort()).toEqual([false, true]);
    expect(await instance.database.materialRecognitionOperation.count()).toBe(1);
    expect(
      (
        await transaction((database) =>
          readMaterialRecognitionReceipt(database, fixtureInput.context)
        )
      ).status
    ).toBe('DISPATCHING');
  });

  it('atomically saves the complete HTTP bytes with success for offline replay after a lost acknowledgement', async () => {
    const f = await fixture();
    await transaction((database) => f.http.admit(database, f.attempt));
    const receipt = response();
    await transaction((database) => f.http.settle(database, f.attempt, 'succeeded', receipt));
    await transaction((database) => f.http.settle(database, f.attempt, 'succeeded', receipt));
    const saved = await transaction((database) =>
      readMaterialRecognitionReceipt(database, f.context)
    );
    expect(saved).toEqual({
      status: 'SUCCEEDED',
      receipt: {
        kind: 'HTTP',
        value: {
          inputDigest: f.prepared.inputDigest,
          attempt: f.attempt,
          response: receipt,
        },
      },
    });
    const raw = await instance.database.materialRecognitionResponse.findUniqueOrThrow({
      where: { operationId: f.operation.id },
    });
    expect(Buffer.from(raw.body)).toEqual(Buffer.from(receipt.bodyBase64, 'base64'));
    expect(
      await transaction((database) =>
        f.http.admit(database, { id: randomUUID(), fingerprint: 'e'.repeat(64) })
      )
    ).toEqual({ dispatch: false });
    await expect(
      transaction((database) => f.http.settle(database, f.attempt, 'unknown'))
    ).rejects.toThrow('terminal');
    await transaction((database) => markMaterialRecognitionUnknown(database, f.context));
    expect(
      (await transaction((database) => readMaterialRecognitionReceipt(database, f.context))).status
    ).toBe('SUCCEEDED');
  });

  it('retains a complete known HTTP rejection without refunding the dispatch', async () => {
    const f = await fixture();
    await transaction((database) => f.http.admit(database, f.attempt));
    const receipt = {
      ...response('explicit provider rejection'),
      status: 422,
      statusText: 'Unprocessable Content',
    };
    await transaction((database) => f.http.settle(database, f.attempt, 'failed', receipt));
    const saved = await transaction((database) =>
      readMaterialRecognitionReceipt(database, f.context)
    );
    expect(saved.status).toBe('FAILED');
    expect(saved.receipt?.kind === 'HTTP' && saved.receipt.value.response.status).toBe(422);
    expect(
      await transaction((database) =>
        f.http.admit(database, { id: randomUUID(), fingerprint: 'e'.repeat(64) })
      )
    ).toEqual({ dispatch: false });
  });

  it('leaves a rolled-back receipt settlement fenced and recovers it as terminal unknown', async () => {
    const f = await fixture();
    await transaction((database) => f.http.admit(database, f.attempt));
    await expect(
      transaction(async (database) => {
        await f.http.settle(database, f.attempt, 'succeeded', response());
        throw new Error('Simulated commit failure');
      })
    ).rejects.toThrow('Simulated commit failure');
    expect(await instance.database.materialRecognitionResponse.count()).toBe(0);
    expect(
      (await transaction((database) => readMaterialRecognitionReceipt(database, f.context))).status
    ).toBe('DISPATCHING');
    await transaction((database) => markMaterialRecognitionUnknown(database, f.context));
    await transaction((database) => markMaterialRecognitionUnknown(database, f.context));
    expect(
      await transaction((database) => readMaterialRecognitionReceipt(database, f.context))
    ).toEqual({ status: 'UNKNOWN', receipt: null });
    expect(
      await transaction((database) =>
        f.http.admit(database, { id: randomUUID(), fingerprint: 'e'.repeat(64) })
      )
    ).toEqual({ dispatch: false });
    expect((await f.create()).id).toBe(f.operation.id);
    await expect(
      transaction((database) => f.http.settle(database, f.attempt, 'succeeded', response()))
    ).rejects.toThrow('terminal');
  });

  it('rejects success without receipt, changed content, oversized bodies and another attempt', async () => {
    const f = await fixture();
    await transaction((database) => f.http.admit(database, f.attempt));
    await expect(
      transaction((database) => f.http.settle(database, f.attempt, 'succeeded'))
    ).rejects.toThrow('receipt');
    await expect(
      transaction((database) =>
        f.http.settle(database, f.attempt, 'succeeded', {
          ...response(),
          bodySha256: 'f'.repeat(64),
        })
      )
    ).rejects.toThrow('changed');
    await expect(
      transaction((database) =>
        f.http.settle(database, f.attempt, 'succeeded', response('x'.repeat(524289)))
      )
    ).rejects.toThrow('budget');
    await expect(
      transaction((database) =>
        f.http.settle(database, { ...f.attempt, id: randomUUID() }, 'succeeded', response())
      )
    ).rejects.toThrow('admitted attempt');
    expect(await instance.database.materialRecognitionResponse.count()).toBe(0);
    expect(
      (await transaction((database) => readMaterialRecognitionReceipt(database, f.context))).status
    ).toBe('DISPATCHING');
  });

  it('rejects a different owner, original digest, extraction run and changed retained render', async () => {
    const f = await fixture();
    const other = await owner.household('Other reader');
    await expect(
      transaction((database) =>
        readMaterialRecognitionReceipt(database, {
          ...f.context,
          run: { ...f.input, userId: other.id },
          execution: { userId: other.id, authorize: async () => ({ userId: other.id }) },
        })
      )
    ).rejects.toThrow('ownership');
    await expect(
      transaction((database) =>
        readMaterialRecognitionReceipt(database, {
          ...f.context,
          run: { ...f.input, originalSha256: 'e'.repeat(64) },
        })
      )
    ).rejects.toThrow('identity');
    await expect(
      transaction((database) =>
        readMaterialRecognitionReceipt(database, {
          ...f.context,
          run: { ...f.input, runId: randomUUID() },
        })
      )
    ).rejects.toThrow('identity');
    await instance.database.materialPage.update({
      where: { runId_pageNumber: { runId: f.input.runId, pageNumber: 1 } },
      data: { pageImageSha256: 'f'.repeat(64) },
    });
    await expect(transaction((database) => f.http.admit(database, f.attempt))).rejects.toThrow(
      'render changed'
    );
  });

  it('rejects a stale live credential revision while preserving owner access to a prior response', async () => {
    const f = await fixture('HTTP', true);
    const credential = f.ai.execution.credential;
    if (!credential) throw new Error('Expected owned credential fixture');
    const changedAi = {
      ...f.ai,
      execution: {
        ...f.ai.execution,
        credential: {
          ...credential,
          selected: {
            ...credential.selected,
            credential: { ...credential.selected.credential, credentialRevision: randomUUID() },
          },
        },
      },
    };
    const changed = materialRecognitionHttpStore({
      run: f.input,
      ai: changedAi,
      operationId: f.operation.id,
    });
    await expect(transaction((database) => changed.admit(database, f.attempt))).rejects.toThrow(
      'credential changed'
    );
    await transaction((database) => f.http.admit(database, f.attempt));
    await transaction((database) => f.http.settle(database, f.attempt, 'succeeded', response()));
    await rotateAiCredential();
    const readContext = {
      ...f.context,
      execution: { userId: owner.ownerId, authorize: f.ai.execution.authorize },
    };
    expect(
      (await transaction((database) => readMaterialRecognitionReceipt(database, readContext)))
        .status
    ).toBe('SUCCEEDED');
  });

  it('revalidates the actual owned credential head before consuming dispatch admission', async () => {
    const f = await fixture('HTTP', true);
    await rotateAiCredential();
    await expect(transaction((database) => f.http.admit(database, f.attempt))).rejects.toThrow(
      'credential'
    );
    expect(
      (await transaction((database) => readMaterialRecognitionReceipt(database, f.context))).status
    ).toBe('READY');
  });

  it('requires Serializable admission and rejects database receipt bounds independently', async () => {
    const f = await fixture();
    await expect(f.http.admit(instance.database, f.attempt)).rejects.toThrow('Serializable');
    await expect(
      instance.database.materialRecognitionResponse.create({
        data: {
          operationId: f.operation.id,
          kind: 'HTTP',
          metadata: {},
          body: Uint8Array.from([1]),
          bodySha256: 'a'.repeat(64),
          bodyBytes: 2,
        },
      })
    ).rejects.toThrow('bounds_check');
    await expect(
      instance.database.materialRecognitionOperation.update({
        where: { id: f.operation.id },
        data: {
          status: 'DISPATCHING',
          attemptId: randomUUID(),
          admittedAt: new Date(),
          attemptFingerprint: null,
        },
      })
    ).rejects.toThrow('status_check');
    expect(
      (await transaction((database) => readMaterialRecognitionReceipt(database, f.context))).status
    ).toBe('READY');
  });

  it('replays CLI transcription after PostgreSQL JSONB reorders nested binding and selection keys', async () => {
    const f = await fixture('CLI');
    await transaction((database) => f.cli.admit(database, f.attempt));
    const content = JSON.stringify({
      schemaVersion: 1,
      inputDigest: f.prepared.inputDigest,
      pageNumber: 1,
      tiles: [
        {
          index: 0,
          state: 'TRANSCRIBED',
          fullVisibleCoverage: true,
          hasHandwriting: true,
          transcription: 'Exact owned handwriting 😀\0é',
          uncertainties: [],
        },
      ],
    });
    const receipt = {
      inputDigest: f.prepared.inputDigest,
      attempt: f.attempt,
      binding: cliBinding,
      response: { content, model: f.ai.model, inputTokens: null, outputTokens: null },
    };
    await transaction((database) => f.cli.settle(database, f.attempt, 'succeeded', receipt));
    const saved = await transaction((database) =>
      readMaterialRecognitionReceipt(database, f.context)
    );
    if (saved.receipt?.kind !== 'CLI') throw new Error('Expected saved CLI invocation receipt');
    const [jsonb] = await instance.database.$queryRaw<{ receipt: MaterialRecognitionCliReceipt }[]>`
      SELECT ${JSON.stringify(saved.receipt.value)}::jsonb AS receipt`;
    if (!jsonb) throw new Error('Expected PostgreSQL receipt round trip');
    expect(Object.keys(jsonb.receipt.binding)).not.toEqual(Object.keys(cliBinding));
    expect(materialRecognitionHash(jsonb.receipt.binding)).toBe(
      materialRecognitionHash(cliBinding)
    );
    expect(replayMaterialRecognitionCli(f.prepared, jsonb.receipt).tiles[0]?.transcription).toBe(
      'Exact owned handwriting 😀\0é'
    );
    expect(
      await transaction((database) =>
        f.cli.admit(database, { id: randomUUID(), fingerprint: f.attempt.fingerprint })
      )
    ).toEqual({ dispatch: false });
  });

  it('replays the exact canonical HTTP request after actual JSONB key reordering with no network dispatch', async () => {
    const f = await fixture('HTTP', true);
    const transcription = {
      schemaVersion: 1,
      inputDigest: f.prepared.inputDigest,
      pageNumber: 1,
      tiles: [
        {
          index: 0,
          state: 'TRANSCRIBED',
          fullVisibleCoverage: true,
          hasHandwriting: true,
          transcription: 'Owned complete handwritten response 😀',
          uncertainties: [],
        },
      ],
    };
    const network = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'owned-response',
            object: 'chat.completion',
            model: f.ai.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify(transcription) },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', network);
    const initial = await executeMaterialRecognitionHttp({
      ai: f.ai,
      prepared: f.prepared,
      operation: f.http,
      signal: new AbortController().signal,
      unresolved: () => {
        throw new Error('Unexpected uncertain provider result');
      },
    });
    const saved = await transaction((database) =>
      readMaterialRecognitionReceipt(database, f.context)
    );
    if (saved.receipt?.kind !== 'HTTP') throw new Error('Expected durable HTTP receipt');
    const [jsonb] = await instance.database.$queryRaw<
      {
        prepared: PreparedMaterialRecognition;
        receipt: MaterialRecognitionHttpReceipt;
      }[]
    >`SELECT ${JSON.stringify(f.prepared)}::jsonb AS prepared, ${JSON.stringify(saved.receipt.value)}::jsonb AS receipt`;
    if (!jsonb) throw new Error('Expected PostgreSQL prepared input round trip');
    expect(Object.keys(jsonb.prepared.selection)).not.toEqual(Object.keys(f.prepared.selection));
    network.mockImplementation(async () => {
      throw new Error('Offline replay cannot use network');
    });
    const replay = await replayMaterialRecognitionHttp({
      prepared: jsonb.prepared,
      receipt: jsonb.receipt,
      signal: new AbortController().signal,
    });
    expect(replay).toEqual(initial);
    await transaction(async (database) => {
      const storage = await sottoCredentialStorage(database, 'ai', 'openai');
      const credentialOwner = await captureSottoCredentialOwner(database, owner.ownerId);
      const target = { ...storage.slot, owner: credentialOwner };
      const current = await storage.owned.head(target);
      await storage.owned.remove(target, current.revision, randomUUID());
    });
    const offlineContext = {
      ...f.context,
      execution: { userId: owner.ownerId, authorize: f.ai.execution.authorize },
    };
    const identity = await transaction((database) =>
      readMaterialRecognitionIdentity(database, offlineContext)
    );
    expect(identity.selection.credentialFingerprint).not.toBeNull();
    const rebuilt = rebuildMaterialRecognitionInput({
      source: identity.source,
      capability: identity.capability,
      selection: identity.selection,
      images: [{ index: 0, bytes: png }],
    });
    expect(rebuilt).toEqual(f.prepared);
    const offlineSaved = await transaction((database) =>
      readMaterialRecognitionReceipt(database, offlineContext)
    );
    if (offlineSaved.receipt?.kind !== 'HTTP')
      throw new Error('Expected retained HTTP receipt after credential removal');
    expect(
      await replayMaterialRecognitionHttp({
        prepared: rebuilt,
        receipt: offlineSaved.receipt.value,
        signal: new AbortController().signal,
      })
    ).toEqual(initial);
    // One original boundary invocation. Replay uses only the owned receipt.
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('requires the CLI account binding and exact invocation response model', async () => {
    const f = await fixture('CLI');
    await transaction((database) => f.cli.admit(database, f.attempt));
    const receipt = {
      inputDigest: f.prepared.inputDigest,
      attempt: f.attempt,
      binding: { ...cliBinding, fingerprint: 'e'.repeat(64) },
      response: { content: '{}', model: f.ai.model, inputTokens: null, outputTokens: null },
    };
    await expect(
      transaction((database) => f.cli.settle(database, f.attempt, 'succeeded', receipt))
    ).rejects.toThrow('identity');
    await expect(
      transaction((database) =>
        f.cli.settle(database, f.attempt, 'succeeded', {
          ...receipt,
          binding: cliBinding,
          response: { ...receipt.response, model: 'codex:changed-model' },
        })
      )
    ).rejects.toThrow('model changed');
    expect(await instance.database.materialRecognitionResponse.count()).toBe(0);
  });

  it('erases one material grant with its canonical deletion and preserves another material grant', async () => {
    const removed = await fixture();
    const retained = await fixture();
    await transaction(async (database) => {
      for (let index = 0; index < 100; index++) {
        const prepared = prepareMaterialRecognition({
          ai: removed.ai,
          source: removed.prepared.source,
          capability: { ...removed.prepared.capability, revision: `owned-page-scope-${index}` },
          images: [{ index: 0, bytes: png }],
        });
        await createMaterialRecognitionOperation(database, {
          run: removed.input,
          ai: removed.ai,
          prepared,
          mode: 'HTTP',
          expiresAt: Date.now() + 60_000,
        });
      }
    });
    const removedIds = (
      await instance.database.materialRecognitionOperation.findMany({
        where: { runId: removed.input.runId },
        select: { id: true },
      })
    ).map((operation) => operation.id);
    expect(removedIds).toHaveLength(101);
    await transaction((database) => removed.http.admit(database, removed.attempt));
    await transaction((database) =>
      removed.http.settle(database, removed.attempt, 'succeeded', response())
    );
    const grantId = (operationId: string) =>
      `${SIDEDOOR_STATE_ID}:material-recognition-grant:${operationId}`;
    const retainedGrant = await instance.database.sidedoorState.findUniqueOrThrow({
      where: { id: grantId(retained.operation.id) },
    });
    const otherNamespace = `${SIDEDOOR_STATE_ID}:class-grant:${removed.operation.id}`;
    await instance.database.sidedoorState.create({
      data: { id: otherNamespace, revision: randomUUID(), state: { retained: true } },
    });
    // These owned fixtures have no real storage artifacts. The external reference
    // remains explicit and never enters a storage deletion inventory.
    await instance.database.courseMaterial.update({
      where: { id: removed.input.materialId },
      data: { originalUrl: 'https://fixture.invalid/owned-original.pdf' },
    });
    const backend = await captureStorageBackend();
    await transaction(async (database) => {
      await admitLearningStorageDeletion({
        database,
        scope: { kind: 'material', id: removed.input.materialId },
        subjects: [
          {
            subjectId: `material:${removed.input.materialId}`,
            generation: removed.prepared.source.material.generation,
          },
        ],
        currentBackend: backend,
      });
      await database.courseMaterial.delete({ where: { id: removed.input.materialId } });
    });
    expect(
      await instance.database.sidedoorState.count({
        where: { id: { in: removedIds.map(grantId) } },
      })
    ).toBe(0);
    expect(
      await instance.database.sidedoorState.findUnique({
        where: { id: grantId(removed.operation.id) },
      })
    ).toBeNull();
    expect(
      await instance.database.materialRecognitionOperation.findUnique({
        where: { id: removed.operation.id },
      })
    ).toBeNull();
    expect(
      await instance.database.materialRecognitionResponse.findUnique({
        where: { operationId: removed.operation.id },
      })
    ).toBeNull();
    expect(
      await instance.database.sidedoorState.findUnique({
        where: { id: grantId(retained.operation.id) },
      })
    ).toEqual(retainedGrant);
    expect(
      await instance.database.sidedoorState.findUnique({ where: { id: otherNamespace } })
    ).not.toBeNull();
    expect(
      await transaction((database) => retained.http.admit(database, retained.attempt))
    ).toEqual({ dispatch: true });
  });

  it('rolls back grant erasure with the deletion transaction and preserves journals during transfer-only cleanup', async () => {
    const f = await fixture();
    const grantId = `${SIDEDOOR_STATE_ID}:material-recognition-grant:${f.operation.id}`;
    const grant = await instance.database.sidedoorState.findUniqueOrThrow({
      where: { id: grantId },
    });
    await instance.database.courseMaterial.update({
      where: { id: f.input.materialId },
      data: { originalUrl: 'https://fixture.invalid/owned-original.pdf' },
    });
    const backend = await captureStorageBackend();
    await expect(
      transaction(async (database) => {
        await admitLearningStorageDeletion({
          database,
          scope: { kind: 'material', id: f.input.materialId },
          subjects: [
            {
              subjectId: `material:${f.input.materialId}`,
              generation: f.prepared.source.material.generation,
            },
          ],
          currentBackend: backend,
        });
        await database.courseMaterial.delete({ where: { id: f.input.materialId } });
        throw new Error('Simulated erasure transaction failure');
      })
    ).rejects.toThrow('Simulated erasure transaction failure');
    expect(await instance.database.sidedoorState.findUnique({ where: { id: grantId } })).toEqual(
      grant
    );
    expect(
      await instance.database.materialRecognitionOperation.findUnique({
        where: { id: f.operation.id },
      })
    ).not.toBeNull();
    const uploadId = randomUUID();
    await transaction((database) =>
      admitLearningStorageDeletion({
        database,
        scope: { kind: 'material-upload', id: uploadId },
        subjects: [{ subjectId: `material-upload:${uploadId}`, generation: Date.now() }],
        currentBackend: backend,
      })
    );
    expect(await instance.database.sidedoorState.findUnique({ where: { id: grantId } })).toEqual(
      grant
    );
    expect(await transaction((database) => f.http.admit(database, f.attempt))).toEqual({
      dispatch: true,
    });
  });

  it('erases a household profile through canonical deletion while preserving another profile material grant', async () => {
    const targetProfile = await owner.household('Removed learner');
    const otherProfile = await owner.household('Retained learner');
    const removed = await fixture('HTTP', false, targetProfile.id);
    const retained = await fixture('HTTP', false, otherProfile.id);
    const removedGrantId = `${SIDEDOOR_STATE_ID}:material-recognition-grant:${removed.operation.id}`;
    const retainedGrantId = `${SIDEDOOR_STATE_ID}:material-recognition-grant:${retained.operation.id}`;
    const retainedGrant = await instance.database.sidedoorState.findUniqueOrThrow({
      where: { id: retainedGrantId },
    });
    await instance.database.courseMaterial.update({
      where: { id: removed.input.materialId },
      data: { originalUrl: 'https://fixture.invalid/owned-original.pdf' },
    });
    const request = new Request(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/v1/profiles/${targetProfile.id}`,
      {
        method: 'DELETE',
        headers: { cookie: `${SHARED_SESSION_COOKIE}=${owner.ownerToken}` },
      }
    );
    expect(await deleteSottoProfile(instance.database, request, targetProfile.id)).not.toBeNull();
    expect(await instance.database.user.findUnique({ where: { id: targetProfile.id } })).toBeNull();
    expect(
      await instance.database.courseMaterial.findUnique({ where: { id: removed.input.materialId } })
    ).toBeNull();
    expect(
      await instance.database.sidedoorState.findUnique({ where: { id: removedGrantId } })
    ).toBeNull();
    expect(
      await instance.database.sidedoorState.findUnique({ where: { id: retainedGrantId } })
    ).toEqual(retainedGrant);
    expect(
      await transaction((database) => retained.http.admit(database, retained.attempt))
    ).toEqual({ dispatch: true });
  });

  it('does not admit a completed extraction and removes private receipts with their material', async () => {
    const f = await fixture();
    await instance.database.materialExtractionRun.update({
      where: { id: f.input.runId },
      data: { status: 'PARTIAL' },
    });
    await expect(transaction((database) => f.http.admit(database, f.attempt))).rejects.toThrow(
      'completed'
    );
    await instance.database.materialExtractionRun.update({
      where: { id: f.input.runId },
      data: { status: 'EXTRACTING' },
    });
    await transaction((database) => f.http.admit(database, f.attempt));
    await transaction((database) => f.http.settle(database, f.attempt, 'succeeded', response()));
    await instance.database.courseMaterial.delete({ where: { id: f.input.materialId } });
    expect(await instance.database.materialRecognitionOperation.count()).toBe(0);
    expect(await instance.database.materialRecognitionResponse.count()).toBe(0);
    await expect(
      transaction((database) => readMaterialRecognitionReceipt(database, f.context))
    ).rejects.toThrow('identity');
  });
});
