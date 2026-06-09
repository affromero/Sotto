'use client';

/**
 * ClassHub — the "Today" entry view from the design bundle (`class-hub.jsx`),
 * adapted to our class data. Shows the lesson header, a skill-chip sequence
 * card with Begin/Resume, and a roster of the four skills with their status.
 *
 * Adaptation: the design's "practice one skill" grid launches free practice;
 * inside a gated class that doesn't exist, so the grid here is a read-only
 * roster (status + score), keeping the layout without dead launchers. Free
 * single-skill practice lives on the separate /learn/practice route.
 */

import { ClassGlyph } from './ClassGlyph';
import { SKILL_GLYPH, skillLabel, type ClassSection } from './classTypes';
import styles from './ClassHub.module.css';

interface ClassHubProps {
  lesson: { title: string; level: string; objective: string };
  order: number;
  sections: ClassSection[];
  /** committed 0..100 score per section id */
  scores: Record<string, number>;
  started: boolean;
  onBegin: () => void;
}

export function ClassHub({ lesson, order, sections, scores, started, onBegin }: ClassHubProps) {
  const doneCount = sections.filter((s) => (scores[s.id] ?? 0) > 0).length;
  const totalSkills = sections.length;

  return (
    <div className={styles.root}>
      <div className={styles.segEnter}>
        <div className={styles.eyebrow}>
          <span className={styles.eyebrowIdx}>Today ·</span> Class {order} · {lesson.level}
        </div>
        <h1 className={styles.title}>{lesson.title}</h1>
        <p className={styles.modLede}>{lesson.objective}</p>

        <div className={styles.drawn}>
          <ClassGlyph name="spark" size={16} />
          {totalSkills} skills, composed for you — then loosed into the day.
        </div>

        <div className={styles.hourCard}>
          <div className={styles.hourCardTop}>
            <span className={styles.hourLabel}>Your class</span>
            <span className={styles.hourDur}>
              <ClassGlyph name="clock" size={14} /> {totalSkills} skills · mastery-gated
            </span>
          </div>

          <div className={styles.segSeq}>
            {sections.map((s) => {
              const done = (scores[s.id] ?? 0) > 0;
              return (
                <div className={`${styles.segChip} ${done ? styles.segChipDone : ''}`} key={s.id}>
                  <div className={styles.segConn} aria-hidden="true" />
                  <div className={styles.segChipIco}>
                    <ClassGlyph name={done ? 'check' : SKILL_GLYPH[s.skill] ?? 'gate'} size={18} />
                  </div>
                  <div className={styles.segChipName}>{skillLabel(s.skill)}</div>
                </div>
              );
            })}
          </div>

          <div className={styles.hourFoot}>
            <div className={styles.hourProg}>
              <div className={styles.hpTop}>
                <span>
                  {doneCount} of {totalSkills} skills
                </span>
                <span>mastery-gated</span>
              </div>
              <div className={styles.hpBar}>
                <i style={{ width: `${totalSkills > 0 ? (doneCount / totalSkills) * 100 : 0}%` }} />
              </div>
            </div>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onBegin}>
              {started ? 'Resume the class' : 'Begin the class'} <ClassGlyph name="arrow" size={17} />
            </button>
          </div>
        </div>

        <div className={styles.practiceHead}>
          <span className={styles.phTitle}>The hour ahead</span>
          <span className={styles.phSub}>four skills, in order</span>
        </div>
        <div className={styles.practiceGrid}>
          {sections.map((s) => {
            const sc = scores[s.id] ?? 0;
            return (
              <div className={styles.practiceTile} key={s.id}>
                <span className={styles.ptIco}>
                  <ClassGlyph name={SKILL_GLYPH[s.skill] ?? 'gate'} size={20} />
                </span>
                <div>
                  <div className={styles.ptName}>{skillLabel(s.skill)}</div>
                  <div className={styles.ptSub}>{s.questions.length || s.prompts.length} items</div>
                </div>
                <span className={`${styles.ptScore} ${sc ? styles.ptScoreHas : ''}`}>
                  {sc ? `${sc}%` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
