'use client';

import { ClassGlyph } from './ClassGlyph';
import { LearningSelectionMenu } from './LearningSelectionMenu';
import { SKILL_GLYPH, skillLabel, type ClassIntroData, type ClassSection } from './classTypes';
import styles from './ClassHub.module.css';

interface ClassHubProps {
  classId: string;
  courseId: string;
  lesson: { title: string; level: string; objective: string };
  intro: ClassIntroData;
  order: number;
  sections: ClassSection[];
  /** committed 0..100 score per section id */
  scores: Record<string, number>;
  started: boolean;
  regenerating?: boolean;
  onBegin: () => void;
  onRegenerate: () => void;
}

export function ClassHub({
  classId,
  courseId,
  lesson,
  intro,
  order,
  sections,
  scores,
  started,
  regenerating = false,
  onBegin,
  onRegenerate,
}: ClassHubProps) {
  const doneCount = sections.filter(
    (section) => (scores[section.id] ?? section.score ?? 0) > 0
  ).length;
  const totalActivities = sections.length;
  const visuals = intro.visuals;
  const showAbout = !intro.examples.some(
    (example) => intro.about === example.target || intro.about === example.meaning
  );
  const reminders = [
    ...intro.tips.map((text) => ({ label: '', text })),
    ...(visuals?.callouts ?? []),
  ].filter((item, index, items) => items.findIndex((other) => other.text === item.text) === index);
  const hasVisuals = (visuals?.timeline?.steps.length ?? 0) >= 2 || !!visuals?.contrast;

  return (
    <article className={styles.root}>
      <div className={styles.segEnter}>
        <header>
          <p className={styles.eyebrow}>
            Class {order} · {lesson.level}
          </p>
          <h1 className={styles.title}>{lesson.title}</h1>
          <p className={styles.readingGuide}>Read the class notes, then begin the activities.</p>
        </header>

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

        <section className={styles.practiceSection} aria-labelledby="class-activities">
          <h2 id="class-activities" className={styles.practiceTitle}>
            Practice this class
          </h2>
          <p className={styles.practiceGuide}>Work through the activities in order.</p>
          <div className={styles.startRow}>
            <button type="button" className={styles.beginButton} onClick={onBegin}>
              {started ? 'Resume the class' : 'Begin the class'}
              <ClassGlyph name="arrow" size={17} />
            </button>
            <div className={styles.activityProgress}>
              <label htmlFor="class-progress">
                {doneCount} of {totalActivities} activities
              </label>
              <progress
                id="class-progress"
                value={doneCount}
                max={Math.max(totalActivities, 1)}
                aria-label="Class activity progress"
              />
            </div>
          </div>

          <ol className={styles.activityList} aria-label="Class activities">
            {sections.map((section) => {
              const score =
                scores[section.id] ?? (section.score == null ? null : section.score * 100);
              const itemCount =
                section.questions.length || section.prompts.length || section.writingPrompts.length;
              return (
                <li className={styles.activity} key={section.id}>
                  <span className={styles.activityIcon}>
                    <ClassGlyph name={SKILL_GLYPH[section.skill] ?? 'gate'} size={19} />
                  </span>
                  <div className={styles.activityName}>
                    <span>{skillLabel(section.skill)}</span>
                    <span className={styles.activityCount}>{itemCount} exercises</span>
                  </div>
                  {score !== null && score !== undefined && (
                    <span className={score ? styles.activityScored : styles.activityScore}>
                      {Math.round(score * 10) / 10}%
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <div className={styles.classTools}>
            <a className={styles.toolButton} href={`/classes/${classId}/worksheet`}>
              <ClassGlyph name="pen" size={17} /> Export / print
            </a>
            <button
              type="button"
              className={styles.toolButton}
              onClick={onRegenerate}
              disabled={regenerating}
              aria-busy={regenerating}
            >
              <ClassGlyph name="spark" size={17} />
              {regenerating ? 'Regenerating...' : 'Regenerate class'}
            </button>
          </div>
        </section>
      </div>
    </article>
  );
}
