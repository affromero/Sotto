// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockGetCourseNote = vi.fn();
const mockSetCourseNote = vi.fn();
const mockExtractAndStoreNoteVocab = vi.fn();
const mockExtractViaMarkit = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) } },
}));
vi.mock('@/lib/course-notes', () => ({
  MAX_NOTE_LENGTH: 12000,
  getCourseNote: (...a: unknown[]) => mockGetCourseNote(...a),
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
});

describe('GET /api/v1/courses/[courseId]/notes', () => {
  it('returns the note body for the owner', async () => {
    mockGetCourseNote.mockResolvedValue('travel to Italy');
    const res = await GET(getReq(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ body: 'travel to Italy' });
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
  it('imports uploaded text notes, appends them to the note, and updates vocab', async () => {
    mockGetCourseNote.mockResolvedValue('existing official course notes');
    mockExtractAndStoreNoteVocab.mockResolvedValue(3);

    const file = {
      content: 'capitolo uno: buongiorno e arrivederci',
      name: 'official.md',
      type: 'text/markdown',
    };
    const res = await POST(postReq([file]), PARAMS);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSetCourseNote).toHaveBeenCalledWith(
      'course-1',
      expect.stringContaining('existing official course notes')
    );
    expect(mockSetCourseNote.mock.calls[0][1]).toContain('Uploaded course note: official.md');
    expect(mockSetCourseNote.mock.calls[0][1]).toContain('buongiorno');
    expect(mockExtractAndStoreNoteVocab).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'course-1', note: mockSetCourseNote.mock.calls[0][1] })
    );
    expect(body).toMatchObject({ imported: 1, failed: 0, addedVocabulary: 3 });
  });

  it('uses Markit for document uploads', async () => {
    mockGetCourseNote.mockResolvedValue('');
    mockExtractViaMarkit.mockResolvedValue({ markdown: '# Capitolo\nciao', text: 'Capitolo ciao' });

    const file = { content: 'pdf bytes', name: 'course.pdf', type: 'application/pdf' };
    const res = await POST(postReq([file]), PARAMS);

    expect(res.status).toBe(200);
    expect(mockExtractViaMarkit).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ extension: '.pdf', url: 'upload://course.pdf' })
    );
    expect(mockSetCourseNote.mock.calls[0][1]).toContain('# Capitolo');
  });

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
