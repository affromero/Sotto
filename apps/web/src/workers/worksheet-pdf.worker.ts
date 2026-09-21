import { isDeepStrictEqual } from 'node:util';
import type { Job } from 'bullmq';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { buildClassDocument } from '@/lib/class-document';
import { classIntroFromSeed } from '@/lib/classes/class-intro';
import { renderWorksheetHtml } from '@/lib/worksheet-html';
import { logger } from '@/lib/logger';
import { readSottoWorkerJob, sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { worksheetPdfPayloadSchema } from '@/lib/sidedoor/jobs/stitch/worksheet-pdf-work';
import { captureCourseStorage } from '@/lib/sidedoor/storage/core/course-storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { writeStorageReference } from '@/lib/sidedoor/storage/core/storage-write';

async function readWork(database: Prisma.TransactionClient, job: Job<unknown>) {
  const durable = await readSottoWorkerJob(database, job, {
    handler: 'worksheet-pdf',
    version: 1,
    payload: worksheetPdfPayloadSchema,
  });
  if (durable.complete) return durable;
  const cls = await database.courseClass.findFirst({
    where: { id: durable.payload.classId },
    include: {
      course: { select: { nativeLang: true, targetLang: true } },
      lesson: {
        select: {
          title: true,
          level: true,
          objective: true,
          grammarPoints: true,
          targetVocab: true,
        },
      },
      sections: {
        include: {
          questions: { orderBy: { order: 'asc' } },
          prompts: { orderBy: { order: 'asc' } },
          writingPrompts: { orderBy: { order: 'asc' } },
        },
      },
    },
  });
  if (!cls) throw new Error(`CourseClass not found: ${durable.payload.classId}`);
  if (cls.updatedAt.getTime() !== durable.payload.classUpdatedAt)
    throw new Error('Worksheet class changed before generation');
  const ownership = await captureCourseStorage(database, cls.courseId);
  if (!isDeepStrictEqual(ownership.scopes, durable.scopes))
    throw new Error('Worksheet ownership changed before generation');
  return { ...durable, cls, ownership };
}

export async function processWorksheetPdf(
  job: Job<unknown>,
  signal: AbortSignal = AbortSignal.timeout(600_000)
): Promise<void> {
  signal.throwIfAborted();
  const work = await sottoTransaction(prisma, (database) => readWork(database, job), { signal });
  if (work.complete) {
    await job.updateProgress(100);
    return;
  }
  const { cls, ownership } = work;
  const { classId, appBaseUrl } = work.payload;

  logger.info('Processing worksheet PDF', { classId });
  await job.updateProgress(5);

  await job.updateProgress(15);

  const grammarPoints = Array.isArray(cls.lesson.grammarPoints)
    ? (cls.lesson.grammarPoints as string[])
    : [];
  const targetVocab = Array.isArray(cls.lesson.targetVocab)
    ? (cls.lesson.targetVocab as Array<{ lemma: string; gloss: string; pos?: string }>)
    : [];
  const intro = classIntroFromSeed(cls.adaptiveSeed, {
    level: cls.lesson.level,
    nativeLang: cls.course.nativeLang,
    targetLang: cls.course.targetLang,
    title: cls.lesson.title,
    objective: cls.lesson.objective,
    grammarPoints,
    targetVocab,
    sourceTitle: cls.sourceTitle,
  });

  const input = {
    id: cls.id,
    nativeLang: cls.course.nativeLang,
    targetLang: cls.course.targetLang,
    lesson: {
      title: cls.lesson?.title ?? '',
      level: cls.lesson?.level ?? '',
      objective: cls.lesson?.objective ?? '',
    },
    intro,
    sections: cls.sections.map((s) => ({
      id: s.id,
      skill: s.skill,
      questions: s.questions.map((q) => ({
        id: q.id,
        order: q.order,
        question: q.question,
        options: q.options,
        passageRef: q.passageRef,
        passageText: q.passageText,
        correctIndex: q.correctIndex,
        explanation: q.explanation ?? '',
      })),
      prompts: s.prompts.map((p) => ({
        id: p.id,
        order: p.order,
        targetPhrase: p.targetPhrase,
        translation: p.translation,
        ipa: p.ipa,
      })),
      writingPrompts: s.writingPrompts.map((p) => ({
        id: p.id,
        order: p.order,
        task: p.task,
        guidance: p.guidance,
      })),
    })),
  };

  const doc = await buildClassDocument(input, {
    isAnswerKey: false,
    appBaseUrl: appBaseUrl ?? undefined,
  });

  await job.updateProgress(30);

  const html = renderWorksheetHtml(doc);

  await job.updateProgress(40);

  let pdfBuffer: Buffer;
  let browser = null;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBytes = await page.pdf({ format: 'A4', printBackground: true });
    pdfBuffer = Buffer.from(pdfBytes);
  } catch (err) {
    logger.error('Worksheet PDF rendering failed', {
      classId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error('Worksheet PDF rendering requires a working Chromium installation', {
      cause: err,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  await job.updateProgress(80);

  const pdfUrl = await writeStorageReference({
    database: prisma,
    signal,
    prefix: `worksheets/${classId}`,
    extension: 'pdf',
    body: pdfBuffer,
    contentType: 'application/pdf',
    captureAdmission: async (database) => {
      const current = await readWork(database, job);
      if (current.complete || !isDeepStrictEqual(current, work))
        throw new Error('Worksheet changed during publication');
      return {
        instanceId: ownership.instanceId,
        scopes: ownership.scopes,
        consumer: `class:${classId}:worksheet`,
        snapshot: cls,
      };
    },
    validateAdmission: async (database, admission, committedReference) => {
      if (committedReference) {
        const receipt = await sottoJobOutbox(database).receipt(work.operationId);
        const current = await database.courseClass.findUnique({
          where: { id: classId },
          select: { worksheetPdfUrl: true },
        });
        if (
          receipt?.status !== 'complete' ||
          receipt.fingerprint !== work.fingerprint ||
          current?.worksheetPdfUrl !== committedReference
        )
          throw new Error('Worksheet publication cannot be verified');
        return;
      }
      const current = await readWork(database, job);
      if (current.complete || !isDeepStrictEqual(current.cls, admission.snapshot))
        throw new Error('Worksheet changed during publication');
    },
    previousReference: (snapshot) => snapshot.worksheetPdfUrl,
    commit: async (database, reference) => {
      if (!(await sottoJobOutbox(database).complete(work.operationId, work.fingerprint)))
        throw new Error('Worksheet work was already completed');
      await database.courseClass.update({
        where: { id: classId },
        data: { worksheetPdfUrl: reference },
      });
    },
  });

  await job.updateProgress(100);
  logger.info('Worksheet PDF generated', { classId, pdfUrl });
}
