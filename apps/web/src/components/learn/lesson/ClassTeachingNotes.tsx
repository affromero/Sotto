'use client';
import Image from 'next/image';
import type { ClassTeaching } from '@sotto/shared';
import { LearningSelectionMenu } from '../LearningSelectionMenu';
import type { ClassIntroData } from '../classTypes';
import styles from './ClassTeachingNotes.module.css';
import { ClassLanguageHelp } from './ClassLanguageHelp';
interface ClassTeachingNotesProps {
  classId: string;
  courseId: string;
  intro: ClassIntroData;
  teaching?: ClassTeaching;
  collapsible?: boolean;
}
/** Keep accepted teaching available before and throughout the class activities. */
export function ClassTeachingNotes({
  classId,
  courseId,
  intro,
  teaching,
  collapsible = false,
}: ClassTeachingNotesProps) {
  const visuals = intro.visuals;
  const showAbout = !intro.examples.some(
    (example) => intro.about === example.target || intro.about === example.meaning
  );
  const reminders = [
    ...intro.tips.map((text) => ({ label: '', text })),
    ...(visuals?.callouts ?? []),
  ].filter((item, index, items) => items.findIndex((other) => other.text === item.text) === index);
  const legacy = (
    <LearningSelectionMenu
      courseId={courseId}
      sourceType="CLASS"
      sourceId={classId}
      sourceLabel="Class"
    >
      <section className={styles.classNotes} aria-label="Class notes">
        {!teaching && (
          <section className={styles.readingSection} aria-labelledby="class-goal">
            <h2 id="class-goal" className={styles.sectionTitle}>
              Class goal
            </h2>
            <p className={styles.goal}>{intro.purpose}</p>
          </section>
        )}

        {showAbout && (
          <section className={styles.readingSection} aria-labelledby="class-overview">
            <h2 id="class-overview" className={styles.sectionTitle}>
              About this class
            </h2>
            <p>{intro.about}</p>
          </section>
        )}

        {intro.focus.length > 0 && (
          <section className={styles.readingSection} aria-labelledby="class-key-points">
            <h2 id="class-key-points" className={styles.sectionTitle}>
              Key points
            </h2>
            <ul className={styles.textList}>
              {intro.focus.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {intro.examples.length > 0 && (
          <section className={styles.readingSection} aria-labelledby="class-examples">
            <h2 id="class-examples" className={styles.sectionTitle}>
              Examples
            </h2>
            <ol className={styles.exampleList}>
              {intro.examples.map((example, index) => (
                <li className={styles.example} key={`${example.target}-${index}`}>
                  <h3>{example.target}</h3>
                  {example.meaning !== example.target && (
                    <p className={styles.exampleMeaning}>{example.meaning}</p>
                  )}
                  <p className={styles.exampleNote}>{example.note}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {reminders.length > 0 && (
          <section className={styles.readingSection} aria-labelledby="class-reminders">
            <h2 id="class-reminders" className={styles.sectionTitle}>
              Remember
            </h2>
            <ul className={styles.textList}>
              {reminders.map((reminder, index) => (
                <li key={`${reminder.text}-${index}`}>
                  {reminder.label && <strong>{reminder.label}: </strong>}
                  {reminder.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {!teaching && <ClassVisualSummary visuals={visuals} />}

        {!!visuals?.links.length && (
          <section className={styles.readingSection} aria-labelledby="class-reading-links">
            <h2 id="class-reading-links" className={styles.sectionTitle}>
              Further reading
            </h2>
            <ul className={styles.linkList}>
              {visuals.links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </LearningSelectionMenu>
  );
  const content = teaching ? (
    <div className={styles.root}>
      <ClassLanguageHelp classId={classId} teaching={teaching} />
      <LearningSelectionMenu
        courseId={courseId}
        sourceType="CLASS"
        sourceId={classId}
        sourceLabel="Lesson notes"
      >
        <section className={styles.classNotes} aria-label="Class notes">
          <header className={styles.lessonHeader}>
            <div>
              <p className={styles.lessonLabel}>The lesson</p>
              <h2 className={styles.teachingTitle}>{teaching.title}</h2>
              <p className={styles.lessonGoal}>{intro.purpose}</p>
            </div>
            <Image
              className={styles.illustration}
              src="/illustrations/class-conversation.svg"
              width={360}
              height={250}
              alt=""
            />
          </header>
          <div className={styles.lessonLayout}>
            <section className={styles.readingSection} aria-label="Lesson explanation">
              <h3 className={styles.sectionTitle}>How it works</h3>
              <div className={styles.explanation}>
                {teaching.explanation.split(/\n\s*\n/).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </section>
            <section className={styles.correction} aria-label="Common mistake">
              <p className={styles.lessonLabel}>Notice the difference</p>
              <h3 className={styles.correctionTitle}>Compare the sentences</h3>
              <div className={styles.incorrect}>
                <span className={styles.comparisonLabel}>Incorrect</span>
                <p>{teaching.commonMistake.incorrect}</p>
              </div>
              <span className={styles.correctionArrow} aria-hidden="true">
                ↓
              </span>
              <div className={styles.corrected}>
                <span className={styles.comparisonLabel}>Correction</span>
                <p>{teaching.commonMistake.correction}</p>
              </div>
              <p className={styles.correctionNote}>{teaching.commonMistake.explanation}</p>
            </section>
          </div>
          <ClassVisualSummary visuals={visuals} open />
          <section className={styles.readingSection} aria-label="Worked examples">
            <h3 className={styles.sectionTitle}>Worked examples</h3>
            <ol className={styles.workedExamples}>
              {teaching.workedExamples.map((example, index) => (
                <li className={styles.workedExample} key={index}>
                  <div className={styles.exampleSituation}>
                    <p className={styles.lessonLabel}>
                      Example {String(index + 1).padStart(2, '0')}
                    </p>
                    <h4>{example.prompt}</h4>
                  </div>
                  <div className={styles.exampleResponse}>
                    <p className={styles.comparisonLabel}>Say it</p>
                    <p className={styles.response}>{example.answer}</p>
                    <p className={styles.reasonLabel}>Why it works</p>
                    <p className={styles.exampleReason}>{example.explanation}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section
            className={`${styles.readingSection} ${styles.guidedPractice}`}
            aria-label="Try it first"
          >
            <h3 className={styles.sectionTitle}>Try it first</h3>
            <p>{teaching.guidedPractice.prompt}</p>
            <p className={styles.exampleNote}>
              <strong>Hint: </strong>
              {teaching.guidedPractice.hint}
            </p>
            <details className={styles.visualSummary}>
              <summary>Show the worked answer</summary>
              <div className={styles.guidedAnswer}>
                <p className={styles.answer}>{teaching.guidedPractice.answer}</p>
                <p>{teaching.guidedPractice.explanation}</p>
              </div>
            </details>
          </section>
        </section>
      </LearningSelectionMenu>
      <details className={styles.summary}>
        <summary>Class summary</summary>
        {legacy}
      </details>
    </div>
  ) : (
    legacy
  );
  return collapsible ? (
    <details className={styles.activeNotes} open>
      <summary>Lesson notes</summary>
      {content}
    </details>
  ) : (
    content
  );
}

function ClassVisualSummary({
  visuals,
  open = false,
}: {
  visuals: ClassIntroData['visuals'];
  open?: boolean;
}) {
  const hasVisuals = (visuals?.timeline?.steps.length ?? 0) >= 2 || !!visuals?.contrast;
  if (!hasVisuals) return null;
  return (
    <details className={styles.visualSummary} open={open}>
      <summary>Visual summary</summary>
      <div className={styles.visualDeck}>
        {visuals?.timeline && visuals.timeline.steps.length >= 2 && (
          <figure className={styles.timelineFigure}>
            <figcaption>{visuals.timeline.title}</figcaption>
            <ol>
              {visuals.timeline.steps.map((step, index) => (
                <li key={`${step}-${index}`}>
                  <span>{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </figure>
        )}
        {visuals?.contrast && (
          <figure className={styles.contrastFigure}>
            <figcaption>{visuals.contrast.title}</figcaption>
            <div className={styles.contrastGrid}>
              <div>
                <h3>{visuals.contrast.leftLabel}</h3>
                <ul>
                  {visuals.contrast.leftItems.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>{visuals.contrast.rightLabel}</h3>
                <ul>
                  {visuals.contrast.rightItems.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </figure>
        )}
      </div>
    </details>
  );
}
