import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (declared before imports that load the module) ----

const mockCourseClassFindFirst = vi.fn();
const mockCourseClassUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prismaUnfiltered: {
    courseClass: {
      findFirst: (...args: unknown[]) => mockCourseClassFindFirst(...args),
      update: (...args: unknown[]) => mockCourseClassUpdate(...args),
    },
  },
}));

const mockBuildClassDocument = vi.fn();
vi.mock('@/lib/class-document', () => ({
  buildClassDocument: (...args: unknown[]) => mockBuildClassDocument(...args),
}));

const mockRenderWorksheetHtml = vi.fn();
vi.mock('@/lib/worksheet-html', () => ({
  renderWorksheetHtml: (...args: unknown[]) => mockRenderWorksheetHtml(...args),
}));

const mockUploadFile = vi.fn();
vi.mock('@/lib/r2', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Playwright mock — default: working browser
const mockPdf = vi.fn();
const mockSetContent = vi.fn();
const mockNewPage = vi.fn();
const mockClose = vi.fn();
const mockLaunch = vi.fn();

vi.mock('playwright', () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
}));

// ---- Test fixtures ----

function makeFakeClass() {
  return {
    id: 'class-1',
    worksheetPdfUrl: null,
    course: { nativeLang: 'en', targetLang: 'de' },
    lesson: { title: 'Greetings', level: 'A1', objective: 'Learn greetings' },
    sections: [
      {
        id: 'sec-1',
        skill: 'GRAMMAR',
        questions: [
          {
            id: 'q-1',
            order: 1,
            question: 'Pick one',
            options: ['A', 'B'],
            passageRef: null,
            passageText: null,
            correctIndex: 0,
            explanation: null,
          },
        ],
        prompts: [],
        writingPrompts: [
          {
            id: 'w-1',
            order: 1,
            task: 'Write a greeting.',
            guidance: 'Use two sentences.',
          },
        ],
      },
    ],
  };
}

function makeFakeJob(data: Record<string, unknown> = {}) {
  return {
    data: { classId: 'class-1', ...data },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  };
}

// ---- Tests ----

describe('processWorksheetPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: class found
    mockCourseClassFindFirst.mockResolvedValue(makeFakeClass());

    // Default: document built
    mockBuildClassDocument.mockResolvedValue({
      classId: 'class-1',
      title: 'Greetings',
      sections: [],
    });

    // Default: HTML rendered
    mockRenderWorksheetHtml.mockReturnValue('<html></html>');

    // Default: browser works
    mockPdf.mockResolvedValue(Buffer.from('pdf-bytes'));
    mockSetContent.mockResolvedValue(undefined);
    mockNewPage.mockResolvedValue({ setContent: mockSetContent, pdf: mockPdf });
    mockClose.mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ newPage: mockNewPage, close: mockClose });

    // Default: upload works
    mockUploadFile.mockResolvedValue('https://cdn.example.com/worksheets/class-1.pdf');

    // Default: DB update works
    mockCourseClassUpdate.mockResolvedValue({});
  });

  it('throws when class is not found', async () => {
    mockCourseClassFindFirst.mockResolvedValue(null);
    const { processWorksheetPdf } = await import('@/workers/worksheet-pdf.worker');
    await expect(processWorksheetPdf(makeFakeJob() as never)).rejects.toThrow(
      'CourseClass not found'
    );
  });

  it('uploads PDF and updates worksheetPdfUrl on success', async () => {
    const { processWorksheetPdf } = await import('@/workers/worksheet-pdf.worker');
    await processWorksheetPdf(makeFakeJob() as never);

    expect(mockUploadFile).toHaveBeenCalledWith(
      'worksheets/class-1.pdf',
      expect.any(Buffer),
      'application/pdf'
    );

    expect(mockCourseClassUpdate).toHaveBeenCalledWith({
      where: { id: 'class-1' },
      data: { worksheetPdfUrl: 'https://cdn.example.com/worksheets/class-1.pdf' },
    });
  });

  it('always closes the browser in the finally block', async () => {
    const { processWorksheetPdf } = await import('@/workers/worksheet-pdf.worker');
    await processWorksheetPdf(makeFakeJob() as never);
    expect(mockClose).toHaveBeenCalled();
  });

  it('does NOT throw and does NOT update DB when Chromium launch fails', async () => {
    mockLaunch.mockRejectedValue(new Error('Chromium not found'));
    const { processWorksheetPdf } = await import('@/workers/worksheet-pdf.worker');

    // Must not throw
    await expect(processWorksheetPdf(makeFakeJob() as never)).resolves.toBeUndefined();

    // Must not attempt upload or DB update
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(mockCourseClassUpdate).not.toHaveBeenCalled();
  });

  it('does NOT throw when page.pdf() fails (Chromium runtime error)', async () => {
    mockPdf.mockRejectedValue(new Error('PDF render failed'));
    const { processWorksheetPdf } = await import('@/workers/worksheet-pdf.worker');

    await expect(processWorksheetPdf(makeFakeJob() as never)).resolves.toBeUndefined();
    expect(mockCourseClassUpdate).not.toHaveBeenCalled();
  });

  it('still closes the browser even when pdf() throws', async () => {
    mockPdf.mockRejectedValue(new Error('PDF render failed'));
    const { processWorksheetPdf } = await import('@/workers/worksheet-pdf.worker');

    await processWorksheetPdf(makeFakeJob() as never);
    expect(mockClose).toHaveBeenCalled();
  });

  it('passes appBaseUrl to buildClassDocument', async () => {
    const { processWorksheetPdf } = await import('@/workers/worksheet-pdf.worker');
    await processWorksheetPdf(makeFakeJob({ appBaseUrl: 'https://app.example.com' }) as never);

    expect(mockBuildClassDocument).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ appBaseUrl: 'https://app.example.com', isAnswerKey: false })
    );
  });

  it('passes workbook writing prompts to buildClassDocument', async () => {
    const { processWorksheetPdf } = await import('@/workers/worksheet-pdf.worker');
    await processWorksheetPdf(makeFakeJob() as never);

    expect(mockBuildClassDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          expect.objectContaining({
            writingPrompts: [
              expect.objectContaining({
                task: 'Write a greeting.',
                guidance: 'Use two sentences.',
              }),
            ],
          }),
        ],
      }),
      expect.any(Object)
    );
  });

  it('uploads to the key worksheets/<classId>.pdf', async () => {
    const { processWorksheetPdf } = await import('@/workers/worksheet-pdf.worker');
    await processWorksheetPdf(makeFakeJob() as never);

    const [key] = mockUploadFile.mock.calls[0] as [string, ...unknown[]];
    expect(key).toBe('worksheets/class-1.pdf');
  });
});
