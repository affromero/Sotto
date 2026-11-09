import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cls = {
    id: 'class-1',
    courseId: 'course-1',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    worksheetPdfUrl: null,
    adaptiveSeed: null,
    sourceTitle: null,
    course: { nativeLang: 'en', targetLang: 'de' },
    lesson: {
      title: 'Greetings',
      level: 'A1',
      objective: 'Learn greetings',
      grammarPoints: [],
      targetVocab: [],
    },
    sections: [
      {
        id: 'sec-1',
        skill: 'WRITING',
        questions: [],
        prompts: [],
        writingPrompts: [
          { id: 'w-1', order: 1, task: 'Write a greeting.', guidance: 'Use two sentences.' },
        ],
      },
    ],
  };
  const database = { courseClass: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() } };
  return {
    cls,
    database,
    complete: vi.fn(),
    writeStorageReference: vi.fn(),
    buildClassDocument: vi.fn(),
    renderWorksheetHtml: vi.fn(),
    pdf: vi.fn(),
    setContent: vi.fn(),
    newPage: vi.fn(),
    close: vi.fn(),
    launch: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: mocks.database }));
vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: (_database: unknown, operation: (database: typeof mocks.database) => unknown) =>
    operation(mocks.database),
}));
vi.mock('@/lib/sidedoor/jobs/core/job-delivery', () => ({
  readSottoWorkerJob: vi.fn(async (_database, job) => ({
    complete: false,
    operationId: '10000000-0000-4000-8000-000000000001',
    fingerprint: 'f'.repeat(64),
    scopes:
      job.name === 'worksheet-pdf.v2'
        ? [
            { subjectId: 'class:class-1', generation: 2 },
            { subjectId: 'course:course-1', generation: 1 },
          ]
        : [{ subjectId: 'course:course-1', generation: 1 }],
    payload: {
      classId: 'class-1',
      classUpdatedAt: mocks.cls.updatedAt.getTime(),
      appBaseUrl: job.data.appBaseUrl ?? null,
    },
  })),
  sottoJobOutbox: vi.fn(() => ({
    complete: mocks.complete,
    receipt: vi.fn().mockResolvedValue({ status: 'complete', fingerprint: 'f'.repeat(64) }),
  })),
}));
vi.mock('@/lib/sidedoor/storage/core/course-storage', () => ({
  captureCourseStorage: vi.fn().mockResolvedValue({
    instanceId: 'instance-1',
    userId: 'user-1',
    scopes: [{ subjectId: 'course:course-1', generation: 1 }],
  }),
}));
vi.mock('@/lib/classes/help/lifecycle/prerequisite-ownership', () => ({
  capturePrerequisiteOwnership: vi.fn().mockResolvedValue({
    instanceId: 'instance-1',
    userId: 'user-1',
    scopes: [
      { subjectId: 'class:class-1', generation: 2 },
      { subjectId: 'course:course-1', generation: 1 },
    ],
  }),
}));
vi.mock('@/lib/sidedoor/storage/core/storage-write', () => ({
  writeStorageReference: (...args: unknown[]) => mocks.writeStorageReference(...args),
}));
vi.mock('@/lib/class-document', () => ({
  buildClassDocument: (...args: unknown[]) => mocks.buildClassDocument(...args),
}));
vi.mock('@/lib/worksheet-html', () => ({
  renderWorksheetHtml: (...args: unknown[]) => mocks.renderWorksheetHtml(...args),
}));
vi.mock('@/lib/classes/class-intro', () => ({ classIntroFromSeed: vi.fn(() => null) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('playwright', () => ({
  chromium: { launch: (...args: unknown[]) => mocks.launch(...args) },
}));

import { processWorksheetPdf } from '@/workers/worksheet-pdf.worker';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';

function job(appBaseUrl = 'https://selfhost.example.com') {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'worksheet-pdf.v1',
    data: { appBaseUrl },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  };
}

describe('durable worksheet PDF generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.database.courseClass.findFirst.mockResolvedValue(mocks.cls);
    mocks.database.courseClass.findUnique.mockResolvedValue({
      worksheetPdfUrl: 'https://storage.example/worksheet.pdf',
    });
    mocks.database.courseClass.update.mockResolvedValue({});
    mocks.buildClassDocument.mockResolvedValue({ classId: 'class-1', sections: [] });
    mocks.renderWorksheetHtml.mockReturnValue('<html></html>');
    mocks.pdf.mockResolvedValue(Buffer.from('pdf'));
    mocks.setContent.mockResolvedValue(undefined);
    mocks.newPage.mockResolvedValue({ setContent: mocks.setContent, pdf: mocks.pdf });
    mocks.close.mockResolvedValue(undefined);
    mocks.launch.mockResolvedValue({ newPage: mocks.newPage, close: mocks.close });
    mocks.complete.mockResolvedValue(true);
    mocks.writeStorageReference.mockImplementation(async (options) => {
      const admission = await options.captureAdmission(mocks.database);
      await options.validateAdmission(mocks.database, admission);
      const reference = 'https://storage.example/worksheet.pdf';
      await options.commit(mocks.database, reference, admission);
      return reference;
    });
  });

  it('publishes the PDF and durable receipt in one storage transaction', async () => {
    await processWorksheetPdf(job() as never);
    expect(mocks.writeStorageReference).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: 'worksheets/class-1',
        contentType: 'application/pdf',
      })
    );
    expect(mocks.complete).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      'f'.repeat(64)
    );
    expect(mocks.database.courseClass.update).toHaveBeenCalledWith({
      where: { id: 'class-1' },
      data: { worksheetPdfUrl: 'https://storage.example/worksheet.pdf' },
    });
  });

  it('publishes new worksheets under their class ownership', async () => {
    let capturedScopes: unknown;
    mocks.writeStorageReference.mockImplementation(async (options) => {
      const admission = await options.captureAdmission(mocks.database);
      capturedScopes = admission.scopes;
      await options.validateAdmission(mocks.database, admission);
      await options.commit(mocks.database, 'https://storage.example/worksheet.pdf', admission);
      return 'https://storage.example/worksheet.pdf';
    });
    await processWorksheetPdf({ ...job(), name: 'worksheet-pdf.v2' } as never);
    expect(capturedScopes).toEqual([
      { subjectId: 'class:class-1', generation: 2 },
      { subjectId: 'course:course-1', generation: 1 },
    ]);
    expect(mocks.database.courseClass.update).toHaveBeenCalledWith({
      where: { id: 'class-1' },
      data: { worksheetPdfUrl: 'https://storage.example/worksheet.pdf' },
    });
  });

  it('rejects a worksheet when its class ownership changed before generation', async () => {
    vi.mocked(capturePrerequisiteOwnership).mockResolvedValueOnce({
      instanceId: 'instance-1',
      userId: 'user-1',
      scopes: [
        { subjectId: 'class:class-1', generation: 3 },
        { subjectId: 'course:course-1', generation: 1 },
      ],
    });
    await expect(
      processWorksheetPdf({ ...job(), name: 'worksheet-pdf.v2' } as never)
    ).rejects.toThrow('Worksheet ownership changed before generation');
    expect(mocks.writeStorageReference).not.toHaveBeenCalled();
  });

  it('keeps durable work retryable when Chromium is unavailable', async () => {
    mocks.launch.mockRejectedValue(new Error('Chromium unavailable'));
    await expect(processWorksheetPdf(job() as never)).rejects.toThrow(
      'Worksheet PDF rendering requires a working Chromium installation'
    );
    expect(mocks.writeStorageReference).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('closes the browser and surfaces uncertain cleanup', async () => {
    mocks.close.mockRejectedValue(new Error('Browser close failed'));
    await expect(processWorksheetPdf(job() as never)).rejects.toThrow('Browser close failed');
    expect(mocks.writeStorageReference).not.toHaveBeenCalled();
  });

  it('passes the captured application origin and worksheet content', async () => {
    await processWorksheetPdf(job('https://app.example.com') as never);
    expect(mocks.buildClassDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          expect.objectContaining({
            writingPrompts: [expect.objectContaining({ task: 'Write a greeting.' })],
          }),
        ],
      }),
      { isAnswerKey: false, appBaseUrl: 'https://app.example.com' }
    );
  });
});
