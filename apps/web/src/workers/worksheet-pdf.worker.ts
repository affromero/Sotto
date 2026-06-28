import { Job } from 'bullmq';
import { WorksheetPdfPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { buildClassDocument } from '@/lib/class-document';
import { classIntroFromSeed } from '@/lib/classes/class-intro';
import { renderWorksheetHtml } from '@/lib/worksheet-html';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';

export async function processWorksheetPdf(job: Job<WorksheetPdfPayload>): Promise<void> {
  const { classId, appBaseUrl } = job.data;

  logger.info('Processing worksheet PDF', { classId });
  await job.updateProgress(5);

  // Load the class (owner-agnostic — worker runs server-side with full access)
  const cls = await prisma.courseClass.findFirst({
    where: { id: classId },
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

  if (!cls) {
    throw new Error(`CourseClass not found: ${classId}`);
  }

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

  const doc = await buildClassDocument(input, { isAnswerKey: false, appBaseUrl });

  await job.updateProgress(30);

  const html = renderWorksheetHtml(doc);

  await job.updateProgress(40);

  // Graceful degradation: if Chromium is unavailable on a self-host, log and
  // return without failing the job — the browser-print page is the fallback.
  let pdfBuffer: Buffer | null = null;
  let browser = null;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBytes = await page.pdf({ format: 'A4', printBackground: true });
    pdfBuffer = Buffer.from(pdfBytes);
  } catch (err) {
    logger.warn('Chromium unavailable — skipping PDF generation for worksheet', {
      classId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  } finally {
    if (browser) {
      await browser.close().catch((err: unknown) => {
        logger.warn('Failed to close browser', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  await job.updateProgress(80);

  const pdfUrl = await uploadFile(`worksheets/${classId}.pdf`, pdfBuffer, 'application/pdf');

  await prisma.courseClass.update({
    where: { id: classId },
    data: { worksheetPdfUrl: pdfUrl },
  });

  await job.updateProgress(100);
  logger.info('Worksheet PDF generated', { classId, pdfUrl });
}
