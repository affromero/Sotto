'use client';

/**
 * ClassHub renders the "Today" entry view from the design bundle (`class-hub.jsx`),
 * adapted to our class data. Shows the lesson header, a skill-chip sequence
 * card with Begin/Resume, and a roster of the four skills with their status.
 *
 * Adaptation: the design's "practice one skill" grid launches free practice;
 * inside a gated class that doesn't exist, so the grid here is a read-only
 * roster (status + score), keeping the layout without dead launchers. Free
 * single-skill practice lives on the separate /learn/practice route.
 */

import type { CSSProperties } from 'react';
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
  const doneCount = sections.filter((s) => (scores[s.id] ?? 0) > 0).length;
  const totalSkills = sections.length;
  const visuals = intro.visuals;
  const hasExamples = intro.examples.length > 0;
  const sequenceStyle = { '--skill-count': Math.max(totalSkills, 1) } as CSSProperties;

  return (
    <div className={styles.root}>
      <div className={styles.segEnter}>
        <div className={styles.eyebrow}>
          <span className={styles.eyebrowIdx}>Today ·</span> Class {order} · {lesson.level}
        </div>
        <h1 className={styles.title}>{lesson.title}</h1>
        <LearningSelectionMenu
          courseId={courseId}
          sourceType="CLASS"
          sourceId={classId}
          sourceLabel="Class"
        >
          <div className={styles.introBlock}>
            <div className={styles.introLead}>
              <span className={styles.introNumber}>01</span>
              <p>{intro.purpose}</p>
            </div>
            <div className={styles.introAbout}>
              <span className={styles.introNumber}>02</span>
              <p>{intro.about}</p>
            </div>
            {(visuals?.timeline || visuals?.contrast) && (
              <div className={styles.visualDeck}>
                {visuals.timeline && visuals.timeline.steps.length >= 2 && (
                  <figure className={styles.timelineFigure}>
                    <figcaption>{visuals.timeline.title}</figcaption>
                    <ol>
                      {visuals.timeline.steps.map((step, index) => (
                        <li key={`${step}-${index}`}>
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <p>{step}</p>
                        </li>
                      ))}
                    </ol>
                  </figure>
                )}
                {visuals.contrast && (
                  <figure className={styles.contrastFigure}>
                    <figcaption>{visuals.contrast.title}</figcaption>
                    <div className={styles.contrastGrid}>
                      <div>
                        <b>{visuals.contrast.leftLabel}</b>
                        <ul>
                          {visuals.contrast.leftItems.map((item, index) => (
                            <li key={`${item}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <b>{visuals.contrast.rightLabel}</b>
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
            )}
            <div className={`${styles.introGrid} ${hasExamples ? '' : styles.introGridSolo}`}>
              <div className={styles.introPanel}>
                <span className={styles.introNumber}>03</span>
                <ul>
                  {intro.focus.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
              {hasExamples && (
                <div className={styles.introPanel}>
                  <span className={styles.introNumber}>04</span>
                  <div className={styles.exampleList}>
                    {intro.examples.map((example, index) => (
                      <details
                        className={styles.example}
                        key={`${example.target}-${index}`}
                        open={index === 0}
                      >
                        <summary>
                          <b>{example.target}</b>
                          <span>{example.meaning}</span>
                        </summary>
                        <small>{example.note}</small>
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className={styles.tipLine}>
              {(visuals?.callouts?.length
                ? visuals.callouts
                : intro.tips.map((tip, index) => ({
                    label: `Tip ${index + 1}`,
                    text: tip,
                    tone: 'blue' as const,
                  }))
              ).map((callout, index) => (
                <span
                  className={styles[`tone_${callout.tone}`]}
                  key={`${callout.label}-${callout.text}-${index}`}
                >
                  <b>{callout.label}</b>
                  {callout.text}
                </span>
              ))}
            </div>
            {visuals?.links && visuals.links.length > 0 && (
              <div className={styles.linkStrip}>
                {visuals.links.map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </LearningSelectionMenu>

        <div className={styles.drawn}>
          <ClassGlyph name="spark" size={16} />
          {totalSkills} skills, composed for you, then loosed into the day.
        </div>

        <div className={styles.hourCard}>
          <div className={styles.hourCardTop}>
            <span className={styles.hourLabel}>Your class</span>
            <span className={styles.hourDur}>
              <ClassGlyph name="clock" size={14} /> {totalSkills} skills · gated by mastery
            </span>
          </div>

          <div className={styles.segSeq} style={sequenceStyle}>
            {sections.map((s) => {
              const done = (scores[s.id] ?? 0) > 0;
              return (
                <div className={`${styles.segChip} ${done ? styles.segChipDone : ''}`} key={s.id}>
                  <div className={styles.segChipIco}>
                    <ClassGlyph
                      name={done ? 'check' : (SKILL_GLYPH[s.skill] ?? 'gate')}
                      size={18}
                    />
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
                <span>gated by mastery</span>
              </div>
              <div className={styles.hpBar}>
                <i style={{ width: `${totalSkills > 0 ? (doneCount / totalSkills) * 100 : 0}%` }} />
              </div>
            </div>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onBegin}
            >
              {started ? 'Resume the class' : 'Begin the class'}{' '}
              <ClassGlyph name="arrow" size={17} />
            </button>
            <a
              className={`${styles.btn} ${styles.btnSecondary}`}
              href={`/classes/${classId}/worksheet`}
            >
              <ClassGlyph name="pen" size={17} /> Export / print
            </a>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={onRegenerate}
              disabled={regenerating}
              aria-busy={regenerating}
            >
              <ClassGlyph name="spark" size={17} />{' '}
              {regenerating ? 'Regenerating...' : 'Regenerate class'}
            </button>
          </div>
        </div>

        <div className={styles.practiceHead}>
          <span className={styles.phTitle}>The hour ahead</span>
          <span className={styles.phSub}>{totalSkills} skills, in order</span>
        </div>
        <div className={styles.practiceGrid}>
          {sections.map((s) => {
            const sc = scores[s.id] ?? 0;
            const itemCount = s.questions.length || s.prompts.length || s.writingPrompts.length;
            return (
              <div className={styles.practiceTile} key={s.id}>
                <span className={styles.ptIco}>
                  <ClassGlyph name={SKILL_GLYPH[s.skill] ?? 'gate'} size={20} />
                </span>
                <div>
                  <div className={styles.ptName}>{skillLabel(s.skill)}</div>
                  <div className={styles.ptSub}>{itemCount} items</div>
                </div>
                <span className={`${styles.ptScore} ${sc ? styles.ptScoreHas : ''}`}>
                  {sc ? `${sc}%` : 'n/a'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
