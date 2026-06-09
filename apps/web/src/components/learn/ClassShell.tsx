'use client';

/**
 * ClassShell — the full-screen two-panel class experience (left rail + stage)
 * and the view state machine (hub → hour → summary), ported from the design
 * bundle (`class-app.jsx`). Owns the class fetch, the cross-section answer map,
 * the gated advance flow, the final `/submit`, and failed-section regeneration.
 *
 * Skill mapping: our skills (GRAMMAR, READING, LISTENING, SPEAKING, WRITING)
 * map onto the design's module styles — grammar + reading render as the drill
 * MC card (reading shows its passage), listening is the waveform player + MCQ
 * wired to the real audio, speaking is record + rubric bars, writing is the
 * task card + textarea + inline corrections.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClassGlyph } from './ClassGlyph';
import { ClassHub } from './ClassHub';
import { ClassSummary } from './ClassSummary';
import { GrammarSection } from './GrammarSection';
import { ListeningSection } from './ListeningSection';
import { SpeakingSection } from './SpeakingSection';
import { WritingSection } from './WritingSection';
import { ClassSources } from './ClassSources';
import {
  SKILL_GLYPH,
  skillLabel,
  classRefToReferenceData,
  type ClassData,
  type ClassReference,
  type ClassSection,
  type ClassSubmitResult,
} from './classTypes';
import styles from './ClassShell.module.css';

type View = 'loading' | 'error' | 'hub' | 'hour' | 'submitting' | 'summary';

interface ClassShellProps {
  classId: string;
}

/** Order the sections so the hour runs grammar → reading → listening → speaking → writing. */
const SKILL_ORDER: Record<string, number> = {
  GRAMMAR: 0,
  READING: 1,
  LISTENING: 2,
  SPEAKING: 3,
  WRITING: 4,
};

function orderSections(sections: ClassSection[]): ClassSection[] {
  return [...sections].sort(
    (a, b) => (SKILL_ORDER[a.skill] ?? 99) - (SKILL_ORDER[b.skill] ?? 99),
  );
}

export function ClassShell({ classId }: ClassShellProps) {
  const [view, setView] = useState<View>('loading');
  const [cls, setCls] = useState<ClassData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const [segIdx, setSegIdx] = useState(0);
  // running 0..100 score for the active segment (drives the rail + gate)
  const [curScore, setCurScore] = useState(0);
  // committed 0..100 score per section id, max-kept
  const [scores, setScores] = useState<Record<string, number>>({});
  // selected option index per questionId, accumulated across all sections
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const [result, setResult] = useState<ClassSubmitResult | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const sections = useMemo(() => (cls ? orderSections(cls.sections) : []), [cls]);
  const gate = cls ? Math.round(cls.passThreshold * 100) : 70;

  // The class's verified sources live on the LISTENING podcast (sourced classes).
  // Collected once for the Sources panel + READING citation resolution.
  const classReferences = useMemo<ClassReference[]>(() => {
    const podcast = sections.find((s) => (s.podcast?.references?.length ?? 0) > 0)?.podcast;
    return podcast?.references ?? [];
  }, [sections]);

  const passageReferences = useMemo(
    () => classReferences.map(classRefToReferenceData),
    [classReferences],
  );

  const loadClass = useCallback(async () => {
    try {
      const res = await fetch(`/api/classes/${classId}`);
      if (res.status === 404) {
        setErrorMessage('Class not found.');
        setView('error');
        return;
      }
      if (!res.ok) {
        setErrorMessage('Failed to load class. Please refresh.');
        setView('error');
        return;
      }
      const data = (await res.json()) as ClassData;
      setCls(data);

      if (data.submitted && data.submission) {
        const ordered = orderSections(data.sections);
        setResult({
          passed: data.submission.passed,
          overallScore: data.submission.overallScore,
          passedSections: ordered.filter((s) => s.passed).length,
          totalSections: ordered.length,
          sections: ordered.map((s) => ({
            id: s.id,
            skill: s.skill,
            score: s.score ?? 0,
            passed: s.passed ?? false,
          })),
        });
        setView('summary');
      } else {
        setView('hub');
      }
    } catch {
      setErrorMessage('Network error. Please refresh.');
      setView('error');
    }
  }, [classId]);

  useEffect(() => {
    void (async () => {
      await loadClass();
    })();
  }, [loadClass]);

  function commit(sectionId: string, value: number) {
    setScores((prev) => ({ ...prev, [sectionId]: Math.max(prev[sectionId] ?? 0, Math.round(value)) }));
  }

  function recordAnswer(questionId: string, selectedIndex: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: selectedIndex }));
  }

  function beginHour() {
    setView('hour');
    setSegIdx(0);
    setCurScore(0);
  }

  async function submitClass() {
    if (!cls) return;
    setView('submitting');
    setErrorMessage('');

    const answerList = Object.entries(answers).map(([questionId, selectedIndex]) => ({
      questionId,
      selectedIndex,
    }));

    try {
      const res = await fetch(`/api/classes/${classId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: answerList }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(body.error ?? 'Failed to submit. Please try again.');
        setView('hour');
        return;
      }
      const submitResult = (await res.json()) as ClassSubmitResult;
      setResult(submitResult);
      // Reload so correctIndex + explanation are available if the learner reopens.
      const classRes = await fetch(`/api/classes/${classId}`);
      if (classRes.ok) {
        const updated = (await classRes.json()) as ClassData;
        setCls(updated);
      }
      setView('summary');
    } catch {
      setErrorMessage('Network error. Please try again.');
      setView('hour');
    }
  }

  function advanceHour() {
    const seg = sections[segIdx];
    if (seg) commit(seg.id, curScore);
    if (segIdx < sections.length - 1) {
      setSegIdx(segIdx + 1);
      setCurScore(0);
    } else {
      void submitClass();
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/classes/${classId}`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(body.error ?? 'Failed to regenerate. Please try again.');
        setRegenerating(false);
        return;
      }
      setAnswers({});
      setScores({});
      setResult(null);
      setSegIdx(0);
      setCurScore(0);
      await loadClass();
    } catch {
      setErrorMessage('Network error. Please try again.');
    } finally {
      setRegenerating(false);
    }
  }

  // ---- elapsed progress for the rail (committed sections + live segment) ----
  const committedCount = sections.filter((s) => (scores[s.id] ?? 0) > 0).length;
  const startedHour = committedCount > 0;

  // ---- loading / error ----
  if (view === 'loading') {
    return (
      <div className={styles.fullState} role="status" aria-label="Loading class">
        <span className={styles.spinner} aria-hidden="true" />
        <p>Loading your class…</p>
      </div>
    );
  }

  if (view === 'error' || !cls) {
    return (
      <div className={styles.fullState} role="alert">
        <p>{errorMessage || 'An unexpected error occurred.'}</p>
        <button
          type="button"
          className={styles.retryBtn}
          onClick={() => {
            setView('loading');
            setErrorMessage('');
            void loadClass();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  // ---- stage content ----
  let stage: React.ReactNode = null;
  const nextName =
    segIdx < sections.length - 1 ? skillLabel(sections[segIdx + 1].skill) : null;

  const sourcesPanel =
    classReferences.length > 0 || cls.sourceUrl ? (
      <ClassSources
        references={classReferences}
        sourceUrl={cls.sourceUrl}
        sourceTitle={cls.sourceTitle}
      />
    ) : null;

  if (view === 'hub') {
    stage = (
      <>
        <ClassHub
          lesson={cls.lesson}
          order={cls.order}
          sections={sections}
          scores={scores}
          started={startedHour}
          onBegin={beginHour}
        />
        {sourcesPanel}
      </>
    );
  } else if (view === 'summary' && result) {
    stage = (
      <>
        <ClassSummary
          lesson={cls.lesson}
          order={cls.order}
          result={result}
          regenerating={regenerating}
          onRetryFailed={() => void handleRegenerate()}
        />
        {sourcesPanel}
      </>
    );
  } else if (view === 'submitting') {
    stage = (
      <div className={styles.stageState} role="status" aria-label="Submitting answers">
        <span className={styles.spinner} aria-hidden="true" />
        <p>Grading your class…</p>
      </div>
    );
  } else if (view === 'hour') {
    const seg = sections[segIdx];
    if (seg) {
      if (seg.skill === 'GRAMMAR' || seg.skill === 'READING') {
        stage = (
          <GrammarSection
            key={seg.id}
            skill={seg.skill}
            questions={seg.questions}
            gate={gate}
            nextName={nextName}
            references={passageReferences}
            onAnswer={recordAnswer}
            onScore={setCurScore}
            onContinue={advanceHour}
          />
        );
      } else if (seg.skill === 'LISTENING') {
        stage = (
          <ListeningSection
            key={seg.id}
            podcast={seg.podcast}
            questions={seg.questions}
            gate={gate}
            nextName={nextName}
            onAnswer={recordAnswer}
            onScore={setCurScore}
            onContinue={advanceHour}
          />
        );
      } else if (seg.skill === 'SPEAKING') {
        stage = (
          <SpeakingSection
            key={seg.id}
            endpointBase={`/api/classes/${classId}/speaking`}
            prompts={seg.prompts}
            gate={gate}
            nextName={nextName}
            onScore={setCurScore}
            onContinue={advanceHour}
          />
        );
      } else if (seg.skill === 'WRITING') {
        stage = (
          <WritingSection
            key={seg.id}
            endpointBase={`/api/classes/${classId}/writing`}
            prompts={seg.writingPrompts}
            gate={gate}
            nextName={nextName}
            onScore={setCurScore}
            onContinue={advanceHour}
          />
        );
      }
    }
  }

  const onHub = view === 'hub';

  return (
    <div className={styles.cshell}>
      <aside className={styles.crail} aria-label="Class navigation">
        <div className={styles.crailGlow} aria-hidden="true" />
        <div className={styles.cbrand}>
          <div className={styles.cwordmark}>
            <span className={styles.wordmarkDot} aria-hidden="true" />
            sotto
          </div>
          <div className={styles.cwordmarkSub}>v0 · self-hosted</div>
        </div>

        {onHub ? (
          <HubRail level={cls.lesson.level} sections={sections} scores={scores} />
        ) : (
          <TimelineRail
            sections={sections}
            segIdx={segIdx}
            scores={scores}
            curScore={curScore}
            gate={gate}
            isSummary={view === 'summary'}
            onLeave={() => setView('hub')}
            onJump={(i) => {
              if (view === 'hour' && i <= segIdx) {
                setSegIdx(i);
                setCurScore(scores[sections[i].id] ?? 0);
              }
            }}
          />
        )}
      </aside>

      <main className={styles.cstage}>
        <div className={styles.cstageInner}>
          {errorMessage && view === 'hour' && (
            <p className={styles.errorBanner} role="alert">
              {errorMessage}
            </p>
          )}
          {stage}
        </div>
      </main>
    </div>
  );
}

// ---- rail: hub mode (level + progress) ----

interface HubRailProps {
  level: string;
  sections: ClassSection[];
  scores: Record<string, number>;
}

function HubRail({ level, sections, scores }: HubRailProps) {
  const vals = sections.map((s) => scores[s.id] ?? 0).filter((v) => v > 0);
  const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  const pct = Math.max(8, Math.min(96, avg || 8));
  return (
    <>
      <nav className={styles.cnav} aria-label="Class sections">
        {sections.map((s) => {
          const done = (scores[s.id] ?? 0) > 0;
          return (
            <div className={styles.cnavItem} key={s.id}>
              <span className={styles.cnavIco}>
                <ClassGlyph name={done ? 'check' : SKILL_GLYPH[s.skill] ?? 'gate'} size={18} />
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
            <span>Level</span>
            <span>
              <b>{level}</b>
            </span>
          </div>
          <div className={styles.lvlBar}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className={styles.lvlNote}>one rung above your reach</div>
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
  gate: number;
  isSummary: boolean;
  onLeave: () => void;
  onJump: (index: number) => void;
}

function TimelineRail({
  sections,
  segIdx,
  scores,
  curScore,
  gate,
  isSummary,
  onLeave,
  onJump,
}: TimelineRailProps) {
  return (
    <>
      <div className={styles.ctlHead}>
        <button type="button" className={styles.ctlLeave} onClick={onLeave}>
          <ClassGlyph name="back" size={13} /> Leave class
        </button>
      </div>

      <div className={styles.ctl}>
        {sections.map((s, i) => {
          let state: 'done' | 'active' | 'locked';
          if (isSummary) state = 'done';
          else if (i < segIdx) state = 'done';
          else if (i === segIdx) state = 'active';
          else state = 'locked';

          const clickable = !isSummary && state === 'done';
          const committed = scores[s.id] ?? 0;
          const mini =
            state === 'done'
              ? committed || 100
              : state === 'active'
                ? curScore
                : 0;

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
                : SKILL_GLYPH[s.skill] ?? 'gate';

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
                <span className={styles.ctlMeta}>gate {gate}%</span>
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
