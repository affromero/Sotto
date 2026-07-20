'use client';

/**
 * ClassWidgets — shared visual widgets for the class flow modules.
 * Ported from the design bundle (`class-widgets.jsx`) to CSS Modules and our
 * data shapes. Scores here are 0..100 integers (the design's scale).
 */

import { ClassGlyph } from './ClassGlyph';
import styles from './ClassWidgets.module.css';

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// ---- Mastery meter ----

interface MasteryMeterProps {
  value: number;
  gate: number;
  label?: string;
}

export function MasteryMeter({ value, gate, label = 'Recall' }: MasteryMeterProps) {
  const v = clampScore(value);
  const passed = v >= gate;
  return (
    <div className={styles.meterWrap}>
      <div className={styles.meterTop}>
        <span>{label}</span>
        <span>
          <b className={passed ? styles.metPass : undefined}>{v}%</b>
          &nbsp;/ gate {gate}%
        </span>
      </div>
      <div
        className={styles.meter}
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${v}% of gate ${gate}%`}
      >
        <div
          className={`${styles.meterFill} ${passed ? styles.meterFillPass : ''}`}
          style={{ width: `${v}%` }}
        />
        <div className={styles.meterGate} style={{ left: `${gate}%` }} />
      </div>
    </div>
  );
}

// ---- Score dial (SVG ring) ----

interface ScoreDialProps {
  value: number;
  size?: number;
  stroke?: number;
}

export function ScoreDial({ value, size = 64, stroke = 6 }: ScoreDialProps) {
  const v = clampScore(value);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - v / 100);
  // good >= 85 / accent >= 70 / bad < 70
  const col = v >= 85 ? 'var(--good)' : v >= 70 ? 'var(--accent)' : 'var(--bad)';
  return (
    <div
      className={styles.dial}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Score ${v} percent`}
    >
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--line-strong)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={styles.dialRing}
        />
      </svg>
      <span className={styles.dialNum} style={{ fontSize: size * 0.26 }} aria-hidden="true">
        {v}
        <small style={{ fontSize: size * 0.16 }}>%</small>
      </span>
    </div>
  );
}

// ---- Dot-rail progress ----

export type DotState = 'now' | 'done' | 'miss' | 'idle';

interface DotRailProps {
  states: DotState[];
  countLabel: string;
}

export function DotRail({ states, countLabel }: DotRailProps) {
  return (
    <div className={styles.drillRail}>
      {states.map((state, i) => {
        const stateClass =
          state === 'now'
            ? styles.drillDotNow
            : state === 'done'
              ? styles.drillDotDone
              : state === 'miss'
                ? styles.drillDotMiss
                : '';
        return <span key={i} className={`${styles.drillDot} ${stateClass}`} aria-hidden="true" />;
      })}
      <span className={styles.drillCount}>{countLabel}</span>
    </div>
  );
}

// ---- Continue bar (gated footer) ----

interface ContinueBarProps {
  passed: boolean;
  gate: number;
  score: number;
  nextName: string | null;
  onContinue: () => void;
  gated?: boolean;
}

export function ContinueBar({
  passed,
  gate,
  score,
  nextName,
  onContinue,
  gated = true,
}: ContinueBarProps) {
  const v = clampScore(score);
  return (
    <div className={styles.cactions}>
      <span className={styles.grow} />
      {gated &&
        (passed ? (
          <span className={`${styles.lockedNote} ${styles.passNote}`}>
            <ClassGlyph name="check" size={14} /> {v}% · gate cleared
          </span>
        ) : (
          <span className={styles.lockedNote}>
            <ClassGlyph name="lock" size={14} /> reach {gate}% to unlock {nextName ?? 'the wrap-up'}
          </span>
        ))}
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        disabled={gated && !passed}
        aria-disabled={gated && !passed}
        onClick={onContinue}
      >
        {nextName ? `Continue · ${nextName}` : 'Finish class'} <ClassGlyph name="arrow" size={16} />
      </button>
    </div>
  );
}
