'use client';
import type { ClassTeaching } from '@sotto/shared';
import { LearningSelectionMenu } from '../LearningSelectionMenu';
import type { ClassIntroData } from '../classTypes';
import styles from './ClassTeachingNotes.module.css';
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
  const hasVisuals = (visuals?.timeline?.steps.length ?? 0) >= 2 || !!visuals?.contrast;
  const legacy = (
    <LearningSelectionMenu
      courseId={courseId}
      sourceType="CLASS"
      sourceId={classId}
      sourceLabel="Class"
    >
      <section className={styles.classNotes} aria-label="Class notes">
        <section className={styles.readingSection} aria-labelledby="class-goal">
          <h2 id="class-goal" className={styles.sectionTitle}>
            Class goal
          </h2>
          <p className={styles.goal}>{intro.purpose}</p>
        </section>

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

        {hasVisuals && (
          <details className={styles.visualSummary}>
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
        )}

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
      <LearningSelectionMenu
        courseId={courseId}
        sourceType="CLASS"
        sourceId={classId}
        sourceLabel="Lesson notes"
      >
        <section className={styles.classNotes} aria-label="Class notes">
          <section className={styles.readingSection}>
            <h2 className={styles.teachingTitle}>{teaching.title}</h2>
            <p className={styles.explanation}>{teaching.explanation}</p>
          </section>
          <section className={styles.readingSection} aria-label="Worked examples">
            <h3 className={styles.sectionTitle}>Worked examples</h3>
            <ol className={styles.exampleList}>
              {teaching.workedExamples.map((example, index) => (
                <li className={styles.example} key={index}>
                  <h4>{example.prompt}</h4>
                  <p className={styles.answer}>{example.answer}</p>
                  <p className={styles.exampleNote}>{example.explanation}</p>
                </li>
              ))}
            </ol>
          </section>
          <section className={styles.readingSection} aria-label="Common mistake">
            <h3 className={styles.sectionTitle}>Common mistake</h3>
            <p>
              <strong>Incorrect: </strong>
              {teaching.commonMistake.incorrect}
            </p>
            <p className={styles.answer}>
              <strong>Correction: </strong>
              {teaching.commonMistake.correction}
            </p>
            <p className={styles.exampleNote}>{teaching.commonMistake.explanation}</p>
          </section>
          <section className={styles.readingSection} aria-label="Try it first">
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
