import { notFound } from 'next/navigation';
import Image from 'next/image';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildClassDocument, type BuildClassDocumentInput } from '@/lib/class-document';
import type { ClassDocument, ClassDocumentSection } from '@sotto/shared';
import { PrintButton } from './PrintButton';
import styles from './worksheet.module.css';

export const dynamic = 'force-dynamic';

interface WorksheetPageProps {
  params: Promise<{ classId: string }>;
}

export async function generateMetadata({ params }: WorksheetPageProps) {
  const { classId } = await params;
  const session = await auth();
  if (!session?.user?.id) return { title: 'iPad Workbook' };

  const cls = await prisma.courseClass.findFirst({
    where: { id: classId, course: { userId: session.user.id } },
    select: { lesson: { select: { title: true } } },
  });

  return { title: cls ? `${cls.lesson.title}: iPad Workbook` : 'iPad Workbook' };
}

// Letter labels for MC options
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function SkillBadge({ skill }: { skill: string }) {
  const labels: Record<string, string> = {
    GRAMMAR: 'Grammar',
    READING: 'Reading',
    LISTENING: 'Listening',
    SPEAKING: 'Speaking',
  };
  return (
    <span className={`${styles.skillBadge} ${styles[`skill_${skill.toLowerCase()}`]}`}>
      {labels[skill] ?? skill}
    </span>
  );
}

function QuestionBlock({
  question,
  index,
}: {
  question: ClassDocumentSection['questions'][number];
  index: number;
}) {
  return (
    <li className={styles.questionItem} aria-label={`Question ${index + 1}`}>
      {question.passageText ? (
        <blockquote className={styles.passageBlock}>
          {question.passageRef && (
            <cite className={styles.passageLabel}>{question.passageRef}</cite>
          )}
          <span>{question.passageText}</span>
        </blockquote>
      ) : (
        question.passageRef && <p className={styles.passageRef}>{question.passageRef}</p>
      )}
      <p className={styles.questionText}>
        <span className={styles.questionNumber} aria-hidden="true">
          {index + 1}.
        </span>
        {question.question}
      </p>
      {question.options.length > 0 && (
        <ol
          className={styles.optionList}
          role="list"
          aria-label={`Options for question ${index + 1}`}
        >
          {question.options.map((option, oi) => (
            <li key={oi} className={styles.optionItem}>
              <label className={styles.optionLabel}>
                <span className={styles.optionCheckbox} aria-hidden="true" />
                <span className={styles.optionLetter} aria-hidden="true">
                  {OPTION_LETTERS[oi] ?? String(oi + 1)}.
                </span>
                <span className={styles.optionText}>{option}</span>
              </label>
            </li>
          ))}
        </ol>
      )}
      <div className={styles.pencilLines} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </li>
  );
}

function PromptBlock({
  prompt,
  index,
}: {
  prompt: ClassDocumentSection['prompts'][number];
  index: number;
}) {
  return (
    <li className={styles.promptItem} aria-label={`Phrase ${index + 1}`}>
      <div className={styles.promptNumber} aria-hidden="true">
        {index + 1}
      </div>
      <div className={styles.promptContent}>
        <p className={styles.targetPhrase} lang="und">
          {prompt.targetPhrase}
        </p>
        {prompt.ipa && (
          <p className={styles.ipa} aria-label="Pronunciation">
            {prompt.ipa}
          </p>
        )}
        <p className={styles.translation}>{prompt.translation}</p>
        <div className={styles.pencilLinesCompact} aria-hidden="true">
          <span />
          <span />
        </div>
      </div>
    </li>
  );
}

function WritingPromptBlock({
  prompt,
  index,
}: {
  prompt: ClassDocumentSection['writingPrompts'][number];
  index: number;
}) {
  return (
    <li className={styles.writingItem} aria-label={`Writing prompt ${index + 1}`}>
      <p className={styles.writingTask}>
        <span className={styles.questionNumber} aria-hidden="true">
          {index + 1}.
        </span>
        {prompt.task}
      </p>
      {prompt.guidance && <p className={styles.writingGuidance}>{prompt.guidance}</p>}
      <div className={styles.writingLines} aria-hidden="true">
        {Array.from({ length: 10 }).map((_, lineIndex) => (
          <span key={lineIndex} />
        ))}
      </div>
    </li>
  );
}

function SectionBlock({ section }: { section: ClassDocumentSection }) {
  return (
    <section className={styles.sectionBlock} aria-labelledby={`section-title-${section.id}`}>
      <header className={styles.sectionHeader}>
        <div className={styles.sectionMeta}>
          <SkillBadge skill={section.skill} />
          <h2 id={`section-title-${section.id}`} className={styles.sectionTitle}>
            {section.title}
          </h2>
        </div>
        {section.qrDataUrl && (
          <div className={styles.qrWrapper} aria-label="Scan to open in app">
            {/* eslint-disable-next-line @next/next/no-img-element -- data-URL QR cannot be optimized by next/image */}
            <img
              src={section.qrDataUrl}
              alt={`QR code to open ${section.title} section in app`}
              className={styles.qrImage}
              width={80}
              height={80}
            />
            <p className={styles.qrCaption}>Open web class</p>
          </div>
        )}
      </header>

      {section.instructions && <p className={styles.instructions}>{section.instructions}</p>}

      {section.questions.length > 0 && (
        <ol className={styles.questionList} aria-label={`${section.title} questions`}>
          {section.questions.map((q, i) => (
            <QuestionBlock key={q.id} question={q} index={i} />
          ))}
        </ol>
      )}

      {section.prompts.length > 0 && (
        <ol className={styles.promptList} aria-label={`${section.title} speaking phrases`}>
          {section.prompts.map((p, i) => (
            <PromptBlock key={p.id} prompt={p} index={i} />
          ))}
        </ol>
      )}

      {section.writingPrompts.length > 0 && (
        <ol className={styles.writingList} aria-label={`${section.title} writing prompts`}>
          {section.writingPrompts.map((p, i) => (
            <WritingPromptBlock key={p.id} prompt={p} index={i} />
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function WorksheetPage({ params }: WorksheetPageProps) {
  const { classId } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();

  const cls = await prisma.courseClass.findFirst({
    where: { id: classId, course: { userId: session.user.id } },
    include: {
      course: { select: { nativeLang: true, targetLang: true } },
      lesson: { select: { title: true, level: true, objective: true } },
      sections: {
        include: {
          questions: { orderBy: { order: 'asc' } },
          prompts: { orderBy: { order: 'asc' } },
          writingPrompts: { orderBy: { order: 'asc' } },
        },
      },
    },
  });

  if (!cls) notFound();

  const input: BuildClassDocumentInput = {
    id: cls.id,
    nativeLang: cls.course.nativeLang,
    targetLang: cls.course.targetLang,
    lesson: {
      title: cls.lesson.title,
      level: cls.lesson.level,
      objective: cls.lesson.objective,
    },
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
        explanation: q.explanation,
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

  const doc: ClassDocument = await buildClassDocument(input, {
    isAnswerKey: false,
    appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
  });

  return (
    <div className={styles.root}>
      {/* Screen-only toolbar */}
      <div className={styles.toolbar} aria-label="Workbook controls">
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <a href="/learn" className={styles.breadcrumbLink}>
            Learn
          </a>
          <span aria-hidden="true" className={styles.breadcrumbSep}>
            /
          </span>
          <span className={styles.breadcrumbCurrent}>{doc.title}</span>
        </nav>
        <PrintButton />
      </div>

      {/* Printable iPad workbook */}
      <main className={styles.worksheet} aria-label="iPad workbook">
        <header className={styles.worksheetHeader}>
          <div className={styles.worksheetBrand}>
            <Image
              src="/logo.svg"
              alt="Sotto"
              width={64}
              height={20}
              className={styles.brandLogo}
              unoptimized
            />
          </div>

          <div className={styles.worksheetMeta}>
            <p className={styles.workbookKicker}>iPad workbook</p>
            <h1 className={styles.worksheetTitle}>{doc.title}</h1>
            <div className={styles.worksheetDetails}>
              <span className={styles.worksheetLevel}>{doc.level}</span>
              <span className={styles.worksheetDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.worksheetLang}>
                {doc.nativeLang.toUpperCase()} → {doc.targetLang.toUpperCase()}
              </span>
            </div>
            {doc.objective && <p className={styles.worksheetObjective}>{doc.objective}</p>}
          </div>

          <div className={styles.worksheetNameLine} aria-label="Name field">
            <span className={styles.worksheetNameLabel}>Name</span>
            <span className={styles.worksheetNameUnderline} aria-hidden="true" />
            <span className={styles.worksheetNameLabel}>Date</span>
            <span className={styles.worksheetDateUnderline} aria-hidden="true" />
          </div>
        </header>

        <div className={styles.sectionsGrid}>
          {doc.sections.map((section) => (
            <SectionBlock key={section.id} section={section} />
          ))}
        </div>

        <footer className={styles.worksheetFooter}>
          <p className={styles.footerText}>
            Pencil-first workbook. Use the web class for audio, recording, and grading.
          </p>
        </footer>
      </main>
    </div>
  );
}
