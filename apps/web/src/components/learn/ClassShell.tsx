'use client';

/**
 * ClassShell renders the full-screen two-panel class experience (left rail + stage)
 * and the view state machine (hub → hour → summary), ported from the design
 * bundle (`class-app.jsx`). Owns the class fetch, the cross-section answer map,
 * the gated advance flow, the final `/submit`, and failed-section regeneration.
 *
 * Skill mapping: our skills (GRAMMAR, READING, LISTENING, SPEAKING, WRITING)
 * map onto the design's module styles. Grammar + reading render as the drill
 * MC card (reading shows its passage), listening is the waveform player + MCQ
 * wired to the real audio, speaking is record + rubric bars, writing is the
 * task card + textarea + inline corrections.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import { ClassGlyph } from './ClassGlyph';
import { ClassHub } from './ClassHub';
import { ClassSummary, FeedbackClinic } from './ClassSummary';
import { GrammarSection } from './GrammarSection';
import { ListeningSection } from './ListeningSection';
import { SpeakingSection } from './SpeakingSection';
import { WritingSection } from './WritingSection';
import { ClassSources } from './ClassSources';
import {
  SKILL_GLYPH,
  skillLabel,
  classRefToReferenceData,
  classPresentationIssues,
  classPresentationNeedsRegeneration,
  type ClassData,
  type ClassFeedbackNote,
  type ClassReference,
  type ClassSection,
  type ClassSpeakingRecording,
  type ClassSubmitResult,
  type WritingResponse,
} from './classTypes';
import styles from './ClassShell.module.css';

type View = 'loading' | 'error' | 'hub' | 'hour' | 'submitting' | 'summary';

interface ClassShellProps {
  classId: string;
  initialSectionId?: string;
}

/** Order the sections so the hour runs grammar → reading → listening → speaking → writing. */
const SKILL_ORDER: Record<string, number> = {
  GRAMMAR: 0,
  READING: 1,
  LISTENING: 2,
  SPEAKING: 3,
  WRITING: 4,
};

const CLASS_REFRESH_POLL_INTERVAL_MS = 2000;
const CLASS_REFRESH_TIMEOUT_MS = 10 * 60 * 1000;

function orderSections(sections: ClassSection[]): ClassSection[] {
  return [...sections].sort((a, b) => (SKILL_ORDER[a.skill] ?? 99) - (SKILL_ORDER[b.skill] ?? 99));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function ClassShell({ classId, initialSectionId }: ClassShellProps) {
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
  const [feedbackNotes, setFeedbackNotes] = useState<ClassFeedbackNote[]>([]);
  const [liveSpeakingRecordings, setLiveSpeakingRecordings] = useState<
    Record<string, ClassSpeakingRecording>
  >({});
  const [liveWritingResponses, setLiveWritingResponses] = useState<Record<string, WritingResponse>>(
    {}
  );

  const [result, setResult] = useState<ClassSubmitResult | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const attemptedAutoRefreshRef = useRef(false);

  const sections = useMemo(() => (cls ? orderSections(cls.sections) : []), [cls]);
  const feedbackSections = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        prompts: section.prompts.map((prompt) => ({
          ...prompt,
          latestRecording: liveSpeakingRecordings[prompt.id] ?? prompt.latestRecording,
        })),
        writingPrompts: section.writingPrompts.map((prompt) => ({
          ...prompt,
          response: liveWritingResponses[prompt.id] ?? prompt.response,
        })),
      })),
    [liveSpeakingRecordings, liveWritingResponses, sections]
  );
  const gate = cls ? Math.round(cls.passThreshold * 100) : 70;

  // The class's verified sources live on the LISTENING episode (sourced classes).
  // Collected once for the Sources panel + READING citation resolution.
  const classReferences = useMemo<ClassReference[]>(() => {
    const episode = sections.find((s) => (s.episode?.references?.length ?? 0) > 0)?.episode;
    return episode?.references ?? [];
  }, [sections]);

  const passageReferences = useMemo(
    () => classReferences.map(classRefToReferenceData),
    [classReferences]
  );

  const resetClassProgress = useCallback(() => {
    setAnswers({});
    setScores({});
    setFeedbackNotes([]);
    setLiveSpeakingRecordings({});
    setLiveWritingResponses({});
    setResult(null);
    setSegIdx(0);
    setCurScore(0);
  }, []);

  const fetchClassData = useCallback(async (): Promise<ClassData> => {
    const res = await fetch(`/api/v1/classes/${classId}`);
    if (res.status === 404) {
      throw new Error('Class not found.');
    }
    if (!res.ok) {
      throw new Error('Failed to load class. Please refresh.');
    }
    return (await res.json()) as ClassData;
  }, [classId]);

  const regenerateWholeClass = useCallback(async () => {
    const res = await fetch(`/api/v1/classes/${classId}?background=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'respond-async' },
      body: JSON.stringify({ scope: 'class' }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Failed to regenerate class.');
    }
  }, [classId]);

  const applyLoadedClass = useCallback(
    (data: ClassData) => {
      setCls(data);
      const ordered = orderSections(data.sections);

      if (data.submitted && data.submission) {
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
        return;
      }

      if (initialSectionId) {
        const initialIndex = ordered.findIndex((s) => s.id === initialSectionId);
        if (initialIndex >= 0) {
          setSegIdx(initialIndex);
          setCurScore(0);
          setView('hour');
          return;
        }
      }
      setView('hub');
    },
    [initialSectionId]
  );

  const waitForClassRefresh = useCallback(async (): Promise<ClassData> => {
    const startedAt = Date.now();
    let lastIssues: string[] = [];

    while (Date.now() - startedAt < CLASS_REFRESH_TIMEOUT_MS) {
      await wait(CLASS_REFRESH_POLL_INTERVAL_MS);
      const data = await fetchClassData();
      const issues = data.submitted ? [] : classPresentationIssues(data);
      lastIssues = issues;

      if (data.status === 'FAILED') {
        throw new Error(`Class refresh failed: ${issues.join(' ') || 'generation failed.'}`);
      }
      if (data.status !== 'GENERATING' && issues.length === 0) {
        return data;
      }
    }

    throw new Error(
      `Class refresh timed out before required material was ready: ${
        lastIssues.join(' ') || 'class is still incomplete.'
      }`
    );
  }, [fetchClassData]);

  const loadClass = useCallback(async () => {
    try {
      let data = await fetchClassData();

      const issues = classPresentationIssues(data);
      if (!data.submitted && (issues.length > 0 || data.status === 'GENERATING')) {
        const needsRegeneration = classPresentationNeedsRegeneration(data);
        setAutoRefreshing(true);
        setView('loading');
        resetClassProgress();
        if (needsRegeneration && data.status !== 'GENERATING') {
          if (!attemptedAutoRefreshRef.current) {
            attemptedAutoRefreshRef.current = true;
            await regenerateWholeClass();
          } else {
            setErrorMessage(
              `This class is missing required presentation material: ${issues.join(' ')}`
            );
            setView('error');
            return;
          }
        }
        data = await waitForClassRefresh();
      }

      const remainingIssues = !data.submitted ? classPresentationIssues(data) : [];
      if (remainingIssues.length > 0) {
        setErrorMessage(
          `This class is missing required presentation material: ${remainingIssues.join(' ')}`
        );
        setView('error');
        return;
      }

      applyLoadedClass(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Network error. Please refresh.');
      setView('error');
    } finally {
      setAutoRefreshing(false);
    }
  }, [
    applyLoadedClass,
    fetchClassData,
    regenerateWholeClass,
    resetClassProgress,
    waitForClassRefresh,
  ]);

  useEffect(() => {
    void (async () => {
      await loadClass();
    })();
  }, [loadClass]);

  function commit(sectionId: string, value: number) {
    setScores((prev) => ({
      ...prev,
      [sectionId]: Math.max(prev[sectionId] ?? 0, Math.round(value)),
    }));
  }

  function recordAnswer(questionId: string, selectedIndex: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: selectedIndex }));
  }

  const upsertFeedbackNote = useCallback((note: ClassFeedbackNote) => {
    setFeedbackNotes((prev) => [note, ...prev.filter((item) => item.id !== note.id)].slice(0, 12));
  }, []);

  const recordSpeakingFeedback = useCallback(
    (promptId: string, recording: ClassSpeakingRecording) => {
      setLiveSpeakingRecordings((prev) => ({ ...prev, [promptId]: recording }));
      const prompt = sections
        .flatMap((section) => section.prompts)
        .find((item) => item.id === promptId);
      upsertFeedbackNote({
        id: `SPEAKING:${promptId}`,
        skill: 'SPEAKING',
        title: prompt ? `Speaking: ${prompt.targetPhrase}` : 'Speaking feedback',
        body:
          recording.feedback ??
          (recording.transcript ? `You said: "${recording.transcript}"` : 'Pronunciation scored.'),
        score: recording.overallScore,
        returnHref: '#class-active-stage',
        tone:
          typeof recording.overallScore === 'number' &&
          recording.overallScore >= (cls?.passThreshold ?? 0.7)
            ? 'good'
            : 'review',
      });
    },
    [cls?.passThreshold, sections, upsertFeedbackNote]
  );

  const recordWritingFeedback = useCallback(
    (promptId: string, response: WritingResponse) => {
      setLiveWritingResponses((prev) => ({ ...prev, [promptId]: response }));
      upsertFeedbackNote({
        id: `WRITING:${promptId}`,
        skill: 'WRITING',
        title: 'Writing feedback',
        body: response.feedback,
        score: response.overallScore,
        returnHref: '#class-active-stage',
        tone: response.overallScore >= (cls?.passThreshold ?? 0.7) ? 'good' : 'review',
      });
    },
    [cls?.passThreshold, upsertFeedbackNote]
  );

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
      const res = await fetch(`/api/v1/classes/${classId}/submit`, {
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
      const classRes = await fetch(`/api/v1/classes/${classId}`);
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

  async function handleRetryFailed() {
    setRegenerating(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/v1/classes/${classId}`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(body.error ?? 'Failed to regenerate. Please try again.');
        setRegenerating(false);
        return;
      }
      resetClassProgress();
      await loadClass();
    } catch {
      setErrorMessage('Network error. Please try again.');
    } finally {
      setRegenerating(false);
    }
  }

  async function handleRegenerateClass() {
    setRegenerating(true);
    setErrorMessage('');
    try {
      await regenerateWholeClass();
      attemptedAutoRefreshRef.current = true;
      resetClassProgress();
      setView('loading');
      const data = await waitForClassRefresh();
      applyLoadedClass(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Network error. Please try again.');
      setView('error');
    } finally {
      setRegenerating(false);
    }
  }

  // ---- elapsed progress for the rail (committed sections + live segment) ----
  const committedCount = sections.filter((s) => (scores[s.id] ?? 0) > 0).length;
  const startedHour = committedCount > 0;
  const activeSectionProgress =
    view === 'hour' && sections.length > 0 ? Math.min(curScore / Math.max(gate, 1), 1) : 0;
  const completionPct =
    view === 'summary'
      ? 100
      : sections.length > 0
        ? Math.round(((committedCount + activeSectionProgress) / sections.length) * 100)
        : 0;

  // ---- loading / error ----
  if (view === 'loading') {
    return (
      <div className={styles.fullState} role="status" aria-label="Loading class">
        <SottoSpinner
          size="large"
          label={autoRefreshing ? 'Refreshing this class' : 'Loading your class'}
          orientation="stack"
        />
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
  const nextName = segIdx < sections.length - 1 ? skillLabel(sections[segIdx + 1].skill) : null;
  const activeSection = sections[segIdx];
  const hasLiveFeedback =
    feedbackNotes.length > 0 ||
    feedbackSections.some(
      (section) =>
        section.prompts.some((prompt) => prompt.latestRecording?.status === 'SCORED') ||
        section.writingPrompts.some((prompt) => prompt.response)
    );

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
          classId={classId}
          courseId={cls.courseId}
          lesson={cls.lesson}
          intro={cls.intro}
          order={cls.order}
          sections={sections}
          scores={scores}
          started={startedHour}
          regenerating={regenerating}
          onBegin={beginHour}
          onRegenerate={() => void handleRegenerateClass()}
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
          sections={feedbackSections}
          vocabulary={cls.vocabulary}
          feedbackNotes={feedbackNotes}
          regenerating={regenerating}
          onRetryFailed={() => void handleRetryFailed()}
        />
        {sourcesPanel}
      </>
    );
  } else if (view === 'submitting') {
    stage = (
      <div className={styles.stageState} role="status" aria-label="Submitting answers">
        <SottoSpinner size="large" label="Grading your class" orientation="stack" />
      </div>
    );
  } else if (view === 'hour') {
    const seg = sections[segIdx];
    if (seg) {
      if (seg.skill === 'GRAMMAR' || seg.skill === 'READING') {
        stage = (
          <GrammarSection
            key={seg.id}
            courseId={cls.courseId}
            sourceId={seg.id}
            skill={seg.skill}
            questions={seg.questions}
            gate={gate}
            nextName={nextName}
            references={passageReferences}
            onAnswer={recordAnswer}
            onScore={setCurScore}
            onFeedback={upsertFeedbackNote}
            feedbackHref="#feedback-clinic"
            onContinue={advanceHour}
          />
        );
      } else if (seg.skill === 'LISTENING') {
        stage = (
          <ListeningSection
            key={seg.id}
            courseId={cls.courseId}
            sourceId={seg.id}
            episode={seg.episode}
            questions={seg.questions}
            gate={gate}
            nextName={nextName}
            onAnswer={recordAnswer}
            onScore={setCurScore}
            onFeedback={upsertFeedbackNote}
            feedbackHref="#feedback-clinic"
            onContinue={advanceHour}
          />
        );
      } else if (seg.skill === 'SPEAKING') {
        stage = (
          <SpeakingSection
            key={seg.id}
            endpointBase={`/api/v1/classes/${classId}/speaking`}
            prompts={seg.prompts}
            gate={gate}
            nextName={nextName}
            onScore={setCurScore}
            onFeedback={recordSpeakingFeedback}
            feedbackHref="#feedback-clinic"
            onContinue={advanceHour}
          />
        );
      } else if (seg.skill === 'WRITING') {
        stage = (
          <WritingSection
            key={seg.id}
            endpointBase={`/api/v1/classes/${classId}/writing`}
            prompts={seg.writingPrompts}
            gate={gate}
            nextName={nextName}
            onScore={setCurScore}
            onFeedback={recordWritingFeedback}
            feedbackHref="#feedback-clinic"
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
          <div className={styles.cwordmarkSub}>v0 · self hosted</div>
        </div>

        {onHub ? (
          <HubRail
            level={cls.lesson.level}
            sections={sections}
            scores={scores}
            completionPct={completionPct}
          />
        ) : (
          <TimelineRail
            sections={sections}
            segIdx={segIdx}
            scores={scores}
            curScore={curScore}
            completionPct={completionPct}
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
          {errorMessage && (view === 'hour' || view === 'hub' || view === 'summary') && (
            <p className={styles.errorBanner} role="alert">
              {errorMessage}
            </p>
          )}
          <div id="class-active-stage">{stage}</div>
          {view === 'hour' && hasLiveFeedback && (
            <FeedbackClinic
              result={null}
              sections={feedbackSections}
              vocabulary={cls.vocabulary}
              feedbackNotes={feedbackNotes}
              returnHref="#class-active-stage"
              returnLabel={
                activeSection ? `Back to ${skillLabel(activeSection.skill)}` : 'Back to class'
              }
            />
          )}
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
  completionPct: number;
}

function HubRail({ level, sections, scores, completionPct }: HubRailProps) {
  return (
    <>
      <nav className={styles.cnav} aria-label="Class sections">
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
  onLeave: () => void;
  onJump: (index: number) => void;
}

function TimelineRail({
  sections,
  segIdx,
  scores,
  curScore,
  completionPct,
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
          let state: 'done' | 'active' | 'locked';
          if (isSummary) state = 'done';
          else if (i < segIdx) state = 'done';
          else if (i === segIdx) state = 'active';
          else state = 'locked';

          const clickable = !isSummary && state === 'done';
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
