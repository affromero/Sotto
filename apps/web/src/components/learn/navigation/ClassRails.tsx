'use client';

import { ClassGlyph } from '../ClassGlyph';
import { SKILL_GLYPH, skillLabel, type ClassSection } from '../classTypes';
import styles from '../ClassShell.module.css';

// ---- rail: hub mode (level + progress) ----

interface HubRailProps {
  level: string;
  sections: ClassSection[];
  scores: Record<string, number>;
  completionPct: number;
}

export function HubRail({ level, sections, scores, completionPct }: HubRailProps) {
  return (
    <>
      <nav className={styles.cnav} aria-label="Class sections">
        <p className={styles.cnavItem} aria-current="step">
          Lesson overview
        </p>
        {sections.map((s) => {
          const done = (scores[s.id] ?? 0) > 0;
          return (
            <div className={styles.cnavItem} key={s.id}>
              <span className={styles.cnavIco}>
                <ClassGlyph name={done ? 'check' : (SKILL_GLYPH[s.skill] ?? 'gate')} size={18} />
              </span>
              {skillLabel(s.skill)}
            </div>
          );
        })}
      </nav>

      <div className={styles.crailFoot}>
        <div className={styles.crailDiv} />
        <div className={styles.lvlStrip}>
          <div className={styles.lvlTop}>
            <span>Class completion</span>
            <span>
              <b>{completionPct}%</b>
            </span>
          </div>
          <div
            className={styles.lvlBar}
            role="progressbar"
            aria-label="Class completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completionPct}
          >
            <i style={{ width: `${completionPct}%` }} />
          </div>
          <div className={styles.lvlNote}>{level} · one rung above your reach</div>
        </div>
      </div>
    </>
  );
}

// ---- rail: hour / summary mode (timeline) ----

interface TimelineRailProps {
  sections: ClassSection[];
  segIdx: number;
  scores: Record<string, number>;
  curScore: number;
  completionPct: number;
  gate: number;
  isSummary: boolean;
  busy: boolean;
  onJump: (index: number) => void;
}

export function TimelineRail({
  sections,
  segIdx,
  scores,
  curScore,
  completionPct,
  gate,
  isSummary,
  busy,
  onJump,
}: TimelineRailProps) {
  return (
    <>
      <div className={styles.classProgress}>
        <div className={styles.lvlTop}>
          <span>Class completion</span>
          <span>
            <b>{completionPct}%</b>
          </span>
        </div>
        <div
          className={styles.lvlBar}
          role="progressbar"
          aria-label="Class completion"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completionPct}
        >
          <i style={{ width: `${completionPct}%` }} />
        </div>
      </div>

      <div className={styles.ctl}>
        {sections.map((s, i) => {
          const sectionGate = s.passThreshold === undefined ? gate : s.passThreshold * 100;
          let state: 'done' | 'active' | 'locked';
          if (isSummary) state = 'done';
          else if (i < segIdx) state = 'done';
          else if (i === segIdx) state = 'active';
          else state = 'locked';

          const clickable = !busy && !isSummary && state === 'done';
          const committed = scores[s.id] ?? 0;
          const mini = state === 'done' ? committed || 100 : state === 'active' ? curScore : 0;

          const segClass = [
            styles.ctlSeg,
            state === 'done' ? styles.ctlSegDone : '',
            state === 'active' ? styles.ctlSegActive : '',
            state === 'locked' ? styles.ctlSegLocked : '',
            clickable ? styles.ctlSegClickable : '',
          ]
            .filter(Boolean)
            .join(' ');

          const glyph =
            state === 'done'
              ? 'check'
              : state === 'locked'
                ? 'lock'
                : (SKILL_GLYPH[s.skill] ?? 'gate');

          return (
            <button
              key={s.id}
              type="button"
              className={segClass}
              disabled={!clickable}
              aria-current={state === 'active' ? 'step' : undefined}
              onClick={() => clickable && onJump(i)}
            >
              <span className={styles.ctlIco}>
                <ClassGlyph name={glyph} size={15} />
              </span>
              <span className={styles.ctlBody}>
                <span className={styles.ctlName}>{skillLabel(s.skill)}</span>
                <span className={styles.ctlMeta}>gate {sectionGate}%</span>
                <span className={styles.ctlMini}>
                  <i style={{ width: `${Math.min(100, mini)}%` }} />
                </span>
                {state === 'done' && committed > 0 && (
                  <span className={styles.ctlScore}>{committed}% cleared</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
