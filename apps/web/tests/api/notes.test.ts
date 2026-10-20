// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockGetCourseNote = vi.fn();
const mockGetEditableNote = vi.fn();
const mockMaterials = vi.fn();
const mockCreateMaterial = vi.fn();
const mockUpdateMaterial = vi.fn();
const mockWriteReference = vi.fn();
const mockSetCourseNote = vi.fn();
const mockExtractAndStoreNoteVocab = vi.fn();
const mockExtractViaMarkit = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) },
    courseMaterial: { findMany: (...a: unknown[]) => mockMaterials(...a) },
  },
  prismaUnfiltered: {},
}));
vi.mock('@/lib/sidedoor/access/core/http', () => ({
  accessOperation: (_request: Request, _browser: boolean, operation: () => Promise<Response>) =>
    operation(),
}));
vi.mock('@/lib/sidedoor/storage/core/storage-write', () => ({
  writeStorageReference: (...a: unknown[]) => mockWriteReference(...a),
}));
vi.mock('@/lib/sidedoor/access/core/request-identity', () => ({
  requireOriginalSottoAdmission: async () => {},
}));
vi.mock('@/lib/sidedoor/access/state/store', () => ({
  sottoStorageInstance: () => ({
    read: async () => ({ instanceId: 'instance', subjectId: 'instance', generation: 1 }),
  }),
}));
vi.mock('@/lib/course-notes', () => ({
  MAX_NOTE_LENGTH: 12000,
  getCourseNote: (...a: unknown[]) => mockGetCourseNote(...a),
  getEditableCourseNote: (...a: unknown[]) => mockGetEditableNote(...a),
  mergeCourseNote: (current: string, addition: string) =>
    [current.trim(), addition.trim()].filter(Boolean).join('\n\n').trim().slice(0, 12000),
  normalizeCourseNote: (body: string) => body.trim().slice(0, 12000),
  setCourseNote: (...a: unknown[]) => mockSetCourseNote(...a),
}));
vi.mock('@/lib/live-vocab', () => ({
  extractAndStoreNoteVocab: (...a: unknown[]) => mockExtractAndStoreNoteVocab(...a),
}));
vi.mock('@/lib/extractors/markit', () => ({
  extractViaMarkit: (...a: unknown[]) => mockExtractViaMarkit(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST, PUT } from '@/app/api/v1/courses/[courseId]/notes/route';

const PARAMS = { params: Promise.resolve({ courseId: 'course-1' }) };

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/courses/course-1/notes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/courses/course-1/notes', { method: 'GET' });
}
interface TestUpload {
  name: string;
  type: string;
  content: string;
}

function postReq(files: TestUpload[]): NextRequest {
  const boundary = '----sotto-course-notes-test';
  const body =
    files
      .map(
        (file) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n${file.content}\r\n`
      )
      .join('') + `--${boundary}--\r\n`;

  return new NextRequest('http://localhost:3000/api/v1/courses/course-1/notes', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
  mockCourseFindFirst.mockResolvedValue({
    nativeLang: 'en',
    targetLang: 'it',
    currentLevel: 'B1',
  });
  mockExtractAndStoreNoteVocab.mockResolvedValue(0);
  mockExtractViaMarkit.mockResolvedValue({ markdown: 'ciao from pdf', text: 'ciao from pdf' });
  mockGetEditableNote.mockResolvedValue('');
  mockGetCourseNote.mockResolvedValue('focus on speaking');
  mockMaterials.mockResolvedValue([]);
  mockCreateMaterial.mockImplementation(async ({ data }) => {
    mockMaterials.mockResolvedValue([data]);
    return data;
  });
  mockUpdateMaterial.mockImplementation(async ({ data }) => {
    const rows = await mockMaterials();
    mockMaterials.mockResolvedValue(
      rows.map((row: Record<string, unknown>) => ({ ...row, ...data }))
    );
    return { count: 1 };
  });
  mockWriteReference.mockImplementation(async (options) => {
    const url = '/api/v1/storage/materials/immutable-original';
    const database = {
      course: { findFirst: mockCourseFindFirst },
      user: { findUnique: async () => ({ createdAt: new Date(1) }) },
      courseMaterial: { create: mockCreateMaterial, updateMany: mockUpdateMaterial },
    };
    await options.captureAdmission(database);
    await options.commit(database, url, null);
    return url;
  });
});

describe('GET /api/v1/courses/[courseId]/notes', () => {
  it('returns the note body for the owner', async () => {
    mockGetEditableNote.mockResolvedValue('travel to Italy');
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ body: 'travel to Italy', materials: [] });
  });

  it('401s without auth', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(401);
  });

  it("404s when the course is not the user's", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(404);
    expect(mockGetCourseNote).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/courses/[courseId]/notes', () => {
  it('saves a valid note for the owner', async () => {
    mockExtractAndStoreNoteVocab.mockResolvedValue(2);
    const res = await PUT(putReq({ body: 'focus on speaking' }), PARAMS);
    expect(res.status).toBe(200);
    expect(mockSetCourseNote).toHaveBeenCalledWith('course-1', 'focus on speaking');
    expect(mockExtractAndStoreNoteVocab).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        courseId: 'course-1',
        targetLang: 'it',
        nativeLang: 'en',
        level: 'B1',
        note: 'focus on speaking',
      })
    );
    expect(await res.json()).toEqual({ body: 'focus on speaking', addedVocabulary: 2 });
  });

  it('400s on an invalid body', async () => {
    const res = await PUT(putReq({ body: 123 }), PARAMS);
    expect(res.status).toBe(400);
    expect(mockSetCourseNote).not.toHaveBeenCalled();
  });

  it("404s when the course is not the user's", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const res = await PUT(putReq({ body: 'x' }), PARAMS);
    expect(res.status).toBe(404);
    expect(mockSetCourseNote).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/courses/[courseId]/notes', () => {
  it('400s when no files are uploaded', async () => {
    const res = await POST(postReq([]), PARAMS);
    expect(res.status).toBe(400);
    expect(mockSetCourseNote).not.toHaveBeenCalled();
  });

  it("404s when the course is not the user's", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const file = { content: 'ciao', name: 'notes.md', type: 'text/markdown' };
    const res = await POST(postReq([file]), PARAMS);
    expect(res.status).toBe(404);
    expect(mockSetCourseNote).not.toHaveBeenCalled();
  });
});
