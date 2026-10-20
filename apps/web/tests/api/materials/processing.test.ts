// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { materialPageTextManifestSchema } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import { GET as processing } from '@/app/api/v1/materials/[materialId]/processing/route';
import { GET as pageText } from '@/app/api/v1/materials/[materialId]/pages/[pageNumber]/text/route';
import { prepareMaterialPageText } from '@/lib/course-materials/extraction/chunks';
import {
  initializeMaterialPages,
  publishMaterialPageText,
} from '@/lib/course-materials/extraction/persistence';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
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

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const originalSha256 = 'a'.repeat(64);
const embeddedText = '\uFEFF\u0000😀e\u0301漢\r\n' + 'x'.repeat(28);
const recognizedText = 'Explicit recognized source: 😀\u0000e\u0301';
const privatePath = '/private/worker/workspace/DO_NOT_EXPOSE_SOURCE_PATH';
const privateCredential = 'DO_NOT_EXPOSE_CAPTURED_CREDENTIAL';
const processingResponseSchema = z.object({
  materialId: z.uuid(),
  processingRevision: z.number().int().positive(),
  originalSha256: z.string(),
  status: z.string(),
  run: z.object({
    id: z.uuid(),
    status: z.string(),
    pageCount: z.number().int().positive(),
  }),
  pages: z.array(z.object({ pageNumber: z.number().int().positive() })),
  nextPage: z.number().int().positive().nullable(),
});
const sourceResponseSchema = z.object({
  runId: z.uuid(),
  manifest: materialPageTextManifestSchema,
  chunks: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      codePointStart: z.number().int().nonnegative(),
      codePointEnd: z.number().int().positive(),
      utf8ByteStart: z.number().int().nonnegative(),
      utf8ByteEnd: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      text: z.string(),
    })
  ),
  nextIndex: z.number().int().nonnegative().nullable(),
});

suite('owned material processing and source HTTP projections', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('material_source_http');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });

  async function fixture(pageCount = 1, includeRecognition = true) {
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        name: 'Owned source.pdf',
        mimeType: 'application/pdf',
        byteSize: 42,
        originalUrl: `${privatePath}/original.pdf`,
        originalSha256,
        extractedText: '',
        processingStatus: 'EXTRACTING',
      },
    });
    const run = await instance.database.materialExtractionRun.create({
      data: {
        materialId: material.id,
        processingRevision: material.processingRevision,
        runKey: sha256(Buffer.from(randomUUID())),
        originalSha256,
        extractorVersion: 'fixture-extractor-1',
        rendererVersion: 'fixture-renderer-1',
        recognitionPolicy: { privatePath },
        providerSelection: {
          credential: privateCredential,
          endpoint: 'https://private.invalid/provider',
        },
      },
    });
    const input = {
      userId: identity.ownerId,
      materialId: material.id,
      runId: run.id,
      processingRevision: material.processingRevision,
      originalSha256,
    };
    const embedded = prepareMaterialPageText(
      {
        pageNumber: 1,
        source: { origin: 'EMBEDDED_TEXT', method: 'FIXTURE', version: '1' },
        text: embeddedText,
      },
      { codePoints: 4, utf8Bytes: 16 }
    );
    const recognized = prepareMaterialPageText({
      pageNumber: 1,
      source: {
        origin: 'VISUAL_RECOGNITION',
        method: 'EXPLICIT_FIXTURE_RECOGNITION',
        version: '1',
      },
      text: recognizedText,
    });
    await sottoTransaction(
      instance.database,
      async (database) => {
        await initializeMaterialPages(database, input, pageCount);
        await publishMaterialPageText(database, input, embedded.manifest, embedded.chunks);
        if (includeRecognition)
          await publishMaterialPageText(database, input, recognized.manifest, recognized.chunks);
        await database.materialPage.update({
          where: { runId_pageNumber: { runId: run.id, pageNumber: 1 } },
          data: {
            renderIdentity: {
              path: privatePath,
              credentials: privateCredential,
            },
            visualCoverage: {
              state: 'UNAVAILABLE',
              diagnostic: 'No explicit full-page assessment has completed.',
            },
          },
        });
      },
      { timeoutMs: 60_000 }
    );
    return { material, run, embedded, recognized };
  }

  function request(path: string, token: string | null = identity.ownerToken) {
    return new NextRequest(`http://localhost:3000/api/v1/materials/${path}`, {
      headers: token ? { cookie: `sotto_session=${token}` } : {},
    });
  }
  function status(materialId: string, query = '', token: string | null = identity.ownerToken) {
    return processing(request(`${materialId}/processing${query}`, token), {
      params: Promise.resolve({ materialId }),
    });
  }
  function source(
    materialId: string,
    runId: string,
    options: {
      pageNumber?: string;
      origin?: string;
      afterIndex?: number;
      token?: string | null;
    } = {}
  ) {
    const pageNumber = options.pageNumber ?? '1';
    const query = new URLSearchParams({ runId });
    if (options.origin !== undefined) query.set('origin', options.origin);
    if (options.afterIndex !== undefined) query.set('afterIndex', String(options.afterIndex));
    return pageText(
      request(
        `${materialId}/pages/${pageNumber}/text?${query}`,
        options.token === undefined ? identity.ownerToken : options.token
      ),
      {
        params: Promise.resolve({ materialId, pageNumber }),
      }
    );
  }

  it('paginates 101 inventoried pages without skipping or repeating the last page', async () => {
    const value = await fixture(101);
    const firstResponse = await status(value.material.id);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('cache-control')).toBe('private, no-store');
    const first = processingResponseSchema.parse(await firstResponse.json());
    expect(first).toMatchObject({
      materialId: value.material.id,
      processingRevision: 1,
      originalSha256,
      status: 'EXTRACTING',
      run: { id: value.run.id, pageCount: 101 },
    });
    expect(first.pages.map((page) => page.pageNumber)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1)
    );
    expect(first.nextPage).toBe(100);
    const last = processingResponseSchema.parse(
      await (await status(value.material.id, `?afterPage=${first.nextPage}`)).json()
    );
    expect(last.pages.map((page) => page.pageNumber)).toEqual([101]);
    expect(last.nextPage).toBeNull();
    const empty = processingResponseSchema.parse(
      await (await status(value.material.id, '?afterPage=101')).json()
    );
    expect(empty.pages).toEqual([]);
    expect(empty.nextPage).toBeNull();
  });

  it('paginates nine source chunks and preserves exact BOM, NUL, emoji, hashes and offsets', async () => {
    const value = await fixture();
    expect(value.embedded.manifest.chunkCount).toBe(9);
    const firstResponse = await source(value.material.id, value.run.id);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('cache-control')).toBe('private, no-store');
    const first = sourceResponseSchema.parse(await firstResponse.json());
    expect(first.runId).toBe(value.run.id);
    expect(first.manifest).toEqual(value.embedded.manifest);
    expect(first.chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(first.nextIndex).toBe(7);
    const last = sourceResponseSchema.parse(
      await (
        await source(value.material.id, value.run.id, {
          afterIndex: first.nextIndex!,
        })
      ).json()
    );
    expect(last.chunks.map((chunk) => chunk.index)).toEqual([8]);
    expect(last.nextIndex).toBeNull();
    const chunks = [...first.chunks, ...last.chunks];
    const text = chunks.map((chunk) => chunk.text).join('');
    expect(text).toBe(embeddedText);
    expect(text.startsWith('\uFEFF\u0000😀')).toBe(true);
    expect(sha256(Buffer.from(text))).toBe(first.manifest.textSha256);
    let points = 0;
    let bytes = 0;
    for (const chunk of chunks) {
      expect(chunk.codePointStart).toBe(points);
      expect(chunk.utf8ByteStart).toBe(bytes);
      expect(chunk.sha256).toBe(sha256(Buffer.from(chunk.text)));
      points += [...chunk.text].length;
      bytes += Buffer.byteLength(chunk.text, 'utf8');
      expect(chunk.codePointEnd).toBe(points);
      expect(chunk.utf8ByteEnd).toBe(bytes);
    }
    expect(points).toBe(first.manifest.codePointLength);
    expect(bytes).toBe(first.manifest.utf8ByteLength);
    const empty = sourceResponseSchema.parse(
      await (await source(value.material.id, value.run.id, { afterIndex: 8 })).json()
    );
    expect(empty.chunks).toEqual([]);
    expect(empty.nextIndex).toBeNull();
  });

  it.each(['processing', 'source'] as const)(
    "conceals another profile's owned %s resource",
    async (route) => {
      const value = await fixture();
      const other = await identity.household('Other learner');
      const response =
        route === 'processing'
          ? await status(value.material.id, '', other.token)
          : await source(value.material.id, value.run.id, {
              token: other.token,
            });
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).not.toContain(value.run.id);
      expect(body).not.toContain(embeddedText);
      expect(body).not.toContain(privateCredential);
    }
  );

  it.each(['processing', 'source'] as const)(
    'requires authentication for the %s route',
    async (route) => {
      const value = await fixture();
      const response =
        route === 'processing'
          ? await status(value.material.id, '', null)
          : await source(value.material.id, value.run.id, { token: null });
      expect(response.status).toBe(401);
    }
  );

  it('exposes explicit text origins without substituting another stream', async () => {
    const value = await fixture();
    const embedded = sourceResponseSchema.parse(
      await (
        await source(value.material.id, value.run.id, {
          origin: 'EMBEDDED_TEXT',
        })
      ).json()
    );
    const recognized = sourceResponseSchema.parse(
      await (
        await source(value.material.id, value.run.id, {
          origin: 'VISUAL_RECOGNITION',
        })
      ).json()
    );
    expect(embedded.manifest.source.origin).toBe('EMBEDDED_TEXT');
    expect(recognized.manifest.source.origin).toBe('VISUAL_RECOGNITION');
    expect(recognized.chunks.map((chunk) => chunk.text).join('')).toBe(recognizedText);
    expect(recognized.manifest.textSha256).not.toBe(embedded.manifest.textSha256);
    const embeddedOnly = await fixture(1, false);
    expect(
      (
        await source(embeddedOnly.material.id, embeddedOnly.run.id, {
          origin: 'VISUAL_RECOGNITION',
        })
      ).status
    ).toBe(404);
  });

  it('binds requested source text to its exact material, extraction run and page', async () => {
    const first = await fixture();
    const second = await fixture();
    expect((await source(first.material.id, second.run.id)).status).toBe(404);
    expect((await source(first.material.id, randomUUID())).status).toBe(404);
    expect((await source(first.material.id, first.run.id, { pageNumber: '2' })).status).toBe(404);
  });

  it('omits private render paths, captured provider selections and credentials from both projections', async () => {
    const value = await fixture();
    for (const response of [
      await status(value.material.id),
      await source(value.material.id, value.run.id),
    ]) {
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain(privatePath);
      expect(body).not.toContain(privateCredential);
      expect(body).not.toContain('renderIdentity');
      expect(body).not.toContain('providerSelection');
      expect(body).not.toContain('private.invalid');
    }
  });

  it('serves the exact requested historical run while processing status follows the current revision', async () => {
    const value = await fixture();
    await instance.database.courseMaterial.update({
      where: { id: value.material.id },
      data: { processingRevision: 2 },
    });
    const current = await instance.database.materialExtractionRun.create({
      data: {
        materialId: value.material.id,
        processingRevision: 2,
        runKey: sha256(Buffer.from(randomUUID())),
        originalSha256,
        extractorVersion: 'fixture-extractor-2',
        rendererVersion: 'fixture-renderer-2',
        recognitionPolicy: {},
      },
    });
    const prepared = prepareMaterialPageText({
      pageNumber: 1,
      source: { origin: 'EMBEDDED_TEXT', method: 'FIXTURE', version: '2' },
      text: 'New extraction revision source',
    });
    const input = {
      userId: identity.ownerId,
      materialId: value.material.id,
      runId: current.id,
      processingRevision: 2,
      originalSha256,
    };
    await sottoTransaction(instance.database, async (database) => {
      await initializeMaterialPages(database, input, 1);
      await publishMaterialPageText(database, input, prepared.manifest, prepared.chunks);
    });
    const old = sourceResponseSchema.parse(
      await (await source(value.material.id, value.run.id)).json()
    );
    const latest = sourceResponseSchema.parse(
      await (await source(value.material.id, current.id)).json()
    );
    expect(old.runId).toBe(value.run.id);
    expect(old.manifest).toEqual(value.embedded.manifest);
    expect(latest.runId).toBe(current.id);
    expect(latest.manifest).toEqual(prepared.manifest);
    expect(latest.chunks.map((chunk) => chunk.text).join('')).toBe(
      'New extraction revision source'
    );
    expect(
      processingResponseSchema.parse(await (await status(value.material.id)).json())
    ).toMatchObject({ processingRevision: 2, run: { id: current.id } });
  });

  it.each(['processing', 'source'] as const)(
    'returns 404 for a deleted material through %s',
    async (route) => {
      const value = await fixture();
      await instance.database.courseMaterial.delete({
        where: { id: value.material.id },
      });
      const response =
        route === 'processing'
          ? await status(value.material.id)
          : await source(value.material.id, value.run.id);
      expect(response.status).toBe(404);
    }
  );

  it('rejects malformed pagination, page, run and origin inputs before returning source content', async () => {
    const value = await fixture();
    expect((await status(value.material.id, '?afterPage=-1')).status).toBe(400);
    expect((await status(value.material.id, '?afterPage=10001')).status).toBe(400);
    expect((await source(value.material.id, value.run.id, { afterIndex: -2 })).status).toBe(400);
    expect((await source(value.material.id, value.run.id, { pageNumber: '0' })).status).toBe(400);
    expect((await source(value.material.id, 'not-a-run-id')).status).toBe(400);
    expect((await source(value.material.id, value.run.id, { origin: 'UNKNOWN' })).status).toBe(400);
  });
});
