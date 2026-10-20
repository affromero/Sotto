// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { courseNotesPageSchema, legacyMaterialTextSchema } from '@sotto/shared';
import type { PrismaClient } from '@/generated/prisma/client';
import { GET as notes } from '@/app/api/v1/courses/[courseId]/notes/route';
import { GET as text } from '@/app/api/v1/materials/[materialId]/legacy-text/route';
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
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
suite('owned bounded legacy material reads over HTTP and PostgreSQL', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  let courseId: string;
  beforeAll(async () => {
    instance = await createSharedTestInstance('legacy_material_http');
    boundary.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    identity = await instance.reset();
    vi.stubGlobal('fetch', async () => {
      throw new Error('Source reads must not dispatch provider requests.');
    });
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Retained source fixture' },
      update: {},
    });
    courseId = (
      await instance.database.course.create({
        data: {
          userId: identity.ownerId,
          nativeLang: 'en',
          targetLang: 'de',
          curriculumId: curriculum.id,
        },
      })
    ).id;
    await instance.database.courseNote.create({ data: { courseId, body: 'Saved editable note.' } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    boundary.database = null;
    await instance?.close();
  });
  const request = (path: string, token = identity.ownerToken, expectedProfile?: string) =>
    new NextRequest(`http://localhost:3000/api/v1/${path}`, {
      headers: {
        cookie: `sotto_session=${token}`,
        ...(expectedProfile ? { 'x-sotto-expected-profile-id': expectedProfile } : {}),
      },
    });
  const readNotes = (after?: string, token = identity.ownerToken) =>
    notes(
      request(
        `courses/${courseId}/notes${after ? `?after=${encodeURIComponent(after)}` : ''}`,
        token
      ),
      { params: Promise.resolve({ courseId }) }
    );
  const readText = (
    materialId: string,
    query = '',
    token = identity.ownerToken,
    expectedProfile?: string
  ) =>
    text(request(`materials/${materialId}/legacy-text${query}`, token, expectedProfile), {
      params: Promise.resolve({ materialId }),
    });
  async function material(number: number, extractedText: string) {
    return instance.database.courseMaterial.create({
      data: {
        id: id(number),
        userId: identity.ownerId,
        courseId,
        name: `Retained ${number}.txt`,
        mimeType: 'text/plain',
        byteSize: 42,
        originalUrl: `/api/v1/storage/retained-${number}`,
        extractedText,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
    });
  }
  it('returns at most twenty metadata rows without selecting full legacy extracts and preserves per-course pagination', async () => {
    const large = 'Retained private text. '.repeat(50000);
    const original = await material(1, large);
    for (let index = 2; index <= 21; index++) await material(index, 'Smaller retained extract.');
    const response = await readNotes();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const serialized = await response.text();
    expect(Buffer.byteLength(serialized)).toBeLessThan(50000);
    expect(serialized).not.toContain('Retained private text.');
    const first = courseNotesPageSchema.parse(JSON.parse(serialized));
    expect(first.body).toBe('Saved editable note.');
    expect(first.materials).toHaveLength(20);
    expect(first.materials[0]).toMatchObject({
      id: id(1),
      extractedText: '',
      textRetained: true,
      processingUrl: `/api/v1/materials/${id(1)}/processing`,
      legacyTextUrl: `/api/v1/materials/${id(1)}/legacy-text`,
    });
    const second = courseNotesPageSchema.parse(await (await readNotes(first.nextCursor!)).json());
    expect(second.materials.map((row) => row.id)).toEqual([id(21)]);
    expect(second.nextCursor).toBeNull();
    const forged = Buffer.from(
      JSON.stringify({
        courseId: 'another-course',
        createdAt: '2026-10-01T00:00:00.000Z',
        id: id(20),
      })
    ).toString('base64url');
    expect((await readNotes(forged)).status).toBe(400);
    expect(
      await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: original.id } })
    ).toEqual(original);
    expect(await instance.database.materialExtractionRun.count()).toBe(0);
    expect(await instance.database.materialAnalysis.count()).toBe(0);
    expect(await instance.database.learningObservation.count()).toBe(0);
  });
  it('slices exact Unicode codepoints and allows late text beyond one million characters without changing the retained row', async () => {
    const small = '\uFEFFa😀e\u0301終';
    const original = await material(1, small);
    let offset = 0;
    const chunks: string[] = [];
    for (;;) {
      const response = await readText(original.id, `?offset=${offset}&limit=2`);
      expect(response.status).toBe(200);
      const page = legacyMaterialTextSchema.parse(await response.json());
      expect(page.origin).toBe('LEGACY_EMBEDDED_TEXT');
      expect(page.totalCodePoints).toBe(6);
      chunks.push(page.text);
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    expect(chunks).toEqual(['\uFEFFa', '😀e', '\u0301終']);
    expect(chunks.join('')).toBe(small);
    const large = 'x'.repeat(1000010) + '😀 late e\u0301';
    const late = await material(2, large);
    const tail = legacyMaterialTextSchema.parse(
      await (await readText(late.id, '?offset=1000008&limit=8192')).json()
    );
    expect(tail.text).toBe('xx😀 late e\u0301');
    expect(tail.totalCodePoints).toBe([...large].length);
    expect(tail.nextOffset).toBeNull();
    expect(
      await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: original.id } })
    ).toEqual(original);
    expect(
      await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: late.id } })
    ).toEqual(late);
  });
  it('rejects invalid bounds, other learners and a changed captured profile before returning private legacy text', async () => {
    const original = await material(1, 'Private retained original extract.');
    for (const query of [
      '?offset=-1',
      '?offset=2147483647',
      '?limit=8193',
      '?limit=0',
      '?offset=9999',
    ])
      expect((await readText(original.id, query)).status).toBe(400);
    const foreign = await identity.household('Another learner');
    expect((await readText(original.id, '', foreign.token)).status).toBe(404);
    expect((await readNotes(undefined, foreign.token)).status).toBe(404);
    expect((await readText(original.id, '', identity.ownerToken, foreign.id)).status).toBe(409);
  });
});
