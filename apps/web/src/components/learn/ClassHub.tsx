'use client';

import { ClassGlyph } from './ClassGlyph';
import type { ClassTeaching } from '@sotto/shared';
import { ClassTeachingNotes } from './lesson/ClassTeachingNotes';
import { SKILL_GLYPH, skillLabel, type ClassIntroData, type ClassSection } from './classTypes';
import styles from './ClassHub.module.css';

interface ClassHubProps {
  classId: string;
  courseId: string;
  lesson: { title: string; level: string; objective: string };
  intro: ClassIntroData;
  teaching?: ClassTeaching;
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
  teaching,
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

        <ClassTeachingNotes
          classId={classId}
          courseId={courseId}
          intro={intro}
          teaching={teaching}
        />

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
