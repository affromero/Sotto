'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classFocusSnapshotSchema } from '@sotto/shared';
import { LearningSaveRecovery, RetainedClassWork } from './progress/LearningSaveRecovery';
import {
  classProgressBlocked,
  flushLearningProgress,
  pauseClassLearningProgress,
  retainedLearningProgress,
  useLearningProgress,
} from './progress/useLearningProgress';
import { useRouter } from 'next/navigation';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import { HubRail, TimelineRail } from './navigation/ClassRails';
import { ClassLoadingState, ClassErrorState, ClassRecoveryState } from './recovery/ClassShellState';
import { ClassHub } from './ClassHub';
import { ClassNavigation } from './navigation/ClassNavigation';
import { isClassPresentationStillRendering, orderSections } from './navigation/classSections';
import { ClassTeachingNotes } from './lesson/ClassTeachingNotes';
import { ClassTeachingPrelude } from './lesson/ClassTeachingPrelude';
import { useClassPrelude } from './lesson/ClassPreludeContext';
import { classFocusAuthorizationMatches } from './lesson/classFocusAuthorization';
import type { ClassPrerequisiteDirections } from './lesson/prerequisiteTypes';
import { ClassSummary, FeedbackClinic } from './ClassSummary';
import { ClassAssessment } from './assessment/ClassAssessment';
import { clearConfirmedAssessmentWork } from './assessment/assessment-retention';
import { GrammarSection } from './GrammarSection';
import { ListeningSection } from './ListeningSection';
import { SpeakingSection } from './SpeakingSection';
import { ClassWritingStage } from './WritingSection';
import { ClassSources } from './ClassSources';
import {
  waitForClassRefresh as pollClassRefresh,
  type ClassRefreshOptions,
} from './recovery/classRefresh';
import {
  skillLabel,
  classRefToReferenceData,
  classPresentationIssues,
  type ClassData,
  type ClassFeedbackNote,
  type ClassReference,
  type ClassSpeakingRecording,
  type ClassSubmitResult,
  type WritingResponse,
} from './classTypes';
import styles from './ClassShell.module.css';

type View = 'loading' | 'error' | 'hub' | 'hour' | 'submitting' | 'assessment' | 'summary';

interface ClassShellProps {
  classId: string;
  initialSectionId?: string;
}

class ClassLoadSuperseded extends Error {}

export function ClassShell({ classId, initialSectionId }: ClassShellProps) {
  return (
    <ClassTeachingPrelude key={classId} classId={classId} quarantineOnEntry>
      <ClassShellContent classId={classId} initialSectionId={initialSectionId} />
    </ClassTeachingPrelude>
  );
}

function ClassShellContent({ classId, initialSectionId }: ClassShellProps) {
  const router = useRouter();
  const prelude = useClassPrelude();
  const [view, setView] = useState<View>('loading');
  const [cls, setCls] = useState<ClassData | null>(null);
  useEffect(() => {
    if (!cls?.submitted || !cls.attempt || cls.submission?.receipt?.source !== 'ASSESSMENT') return;
    const controller = new AbortController();
    void clearConfirmedAssessmentWork({
      classId,
      attempt: cls.attempt,
      receipt: cls.submission.receipt,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [classId, cls?.attempt, cls?.submitted, cls?.submission?.receipt]);
  const initialClassLoaded = useRef(false);
  const classLoadGeneration = useRef(0);
  const cancelClassLoad = useRef<(() => void) | null>(null);
  const classLifetime = useRef<AbortController | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [, setRecoveryVersion] = useState(0);
  const [prerequisiteDirections, setPrerequisiteDirections] =
    useState<ClassPrerequisiteDirections | null>(null);

  const [segIdx, setSegIdx] = useState(0);
  const [visitedSection, setVisitedSection] = useState(false);
  // running 0..100 score for the active segment (drives the rail + gate)
  const [curScore, setCurScore] = useState(0);
  const [mcCompletion, setMcCompletion] = useState<{
    sectionId: string;
    complete: boolean;
    passed: boolean;
  } | null>(null);
  // committed 0..100 score per section id, max-kept
  const [scores, setScores] = useState<Record<string, number>>({});
  // selected option index per questionId, accumulated across all sections
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const saveError = useLearningProgress(
    `/api/v1/classes/${classId}`,
    { answers },
    Boolean(cls && !cls.submitted),
    cls?.progressRevision ?? 0,
    String(cls?.attempt ?? 1),
    cls?.attempt && cls.taskMaterialRevision
      ? { expectedAttempt: cls.attempt, taskMaterialRevision: cls.taskMaterialRevision }
      : null,
    Object.fromEntries(
      (cls?.sections ?? []).flatMap((section) =>
        section.questions.flatMap((question) => {
          const option = question.options[answers[question.id]];
          return option === undefined
            ? []
            : [[question.id, { question: question.question, option }]];
        })
      )
    )
  );
  const [feedbackNotes, setFeedbackNotes] = useState<ClassFeedbackNote[]>([]);
  const [liveSpeakingRecordings, setLiveSpeakingRecordings] = useState<
    Record<string, ClassSpeakingRecording>
  >({});
  const [liveWritingResponses, setLiveWritingResponses] = useState<Record<string, WritingResponse>>(
    {}
  );

  const [result, setResult] = useState<ClassSubmitResult | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const retryInFlight = useRef(false);
  const [autoRefreshing, setAutoRefreshing] = useState(false);

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
  const gate = (sections[segIdx]?.passThreshold ?? cls?.passThreshold ?? 0.7) * 100;
  const recordMcCompletion = useCallback(
    (complete: boolean, passed: boolean) => {
      const sectionId = sections[segIdx]?.id;
      if (sectionId) setMcCompletion({ sectionId, complete, passed });
    },
    [sections, segIdx]
  );

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
    setVisitedSection(false);
    setCurScore(0);
  }, []);

  const fetchClassData = useCallback(async (): Promise<ClassData> => {
    const endpoint = `/api/v1/classes/${classId}`;
    cancelClassLoad.current?.();
    const generation = ++classLoadGeneration.current;
    const controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimeout(
      () => controller.abort(new Error('Class status check timed out.')),
      30_000
    );
    const checkCurrent = () => {
      if (classLoadGeneration.current !== generation) throw new ClassLoadSuperseded();
      signal.throwIfAborted();
    };
    const hold =
      prelude && !initialClassLoaded.current ? pauseClassLearningProgress(endpoint) : null;
    let finished = false;
    const cancel = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      controller.abort();
      hold?.();
      if (cancelClassLoad.current === cancel) cancelClassLoad.current = null;
    };
    cancelClassLoad.current = cancel;
    try {
      const res = await fetch(endpoint, { cache: 'no-store', signal });
      checkCurrent();
      if (res.status === 404) throw new Error('Class not found.');
      if (!res.ok) throw new Error('Failed to load class. Please refresh.');
      const data = (await res.json()) as ClassData;
      checkCurrent();
      if (data.id !== classId)
        throw new Error('Class status could not be verified. Your local work is retained.');
      if (!hold || !prelude || data.status === 'GENERATING') return data;
      const response = await fetch(`${endpoint}/focus-snapshot`, {
        cache: 'no-store',
        signal,
      });
      checkCurrent();
      if (!response.ok)
        throw new Error('Class status could not be checked. Your local work is retained.');
      const snapshot = classFocusSnapshotSchema.parse(await response.json());
      checkCurrent();
      const binding = {
        classId: data.id,
        attempt: data.attempt,
        taskMaterialRevision: data.taskMaterialRevision,
        replay: prelude.kind === 'REPLAY',
      };
      if (
        !classFocusAuthorizationMatches({
          binding,
          originalPrelude: prelude,
          currentPrelude: snapshot.prelude,
          currentProgress: snapshot.progress,
        })
      )
        throw new Error(
          'The class changed. Copy any retained work, then return to Learn and reopen the class.'
        );
      if (prelude.kind !== 'REPLAY' && data.attempt && data.taskMaterialRevision)
        hold.verify({
          expectedAttempt: data.attempt,
          taskMaterialRevision: data.taskMaterialRevision,
        });
      return data;
    } catch (error) {
      if (classLoadGeneration.current !== generation) throw new ClassLoadSuperseded();
      throw error;
    } finally {
      cancel();
    }
  }, [classId, prelude]);

  const regenerateWholeClass = useCallback(async () => {
    const res = await fetch(`/api/v1/classes/${classId}?background=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'respond-async' },
      body: JSON.stringify({ scope: 'class', expectedAttempt: cls?.attempt ?? 1 }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Failed to regenerate class.');
    }
  }, [classId, cls?.attempt]);

  const applyLoadedClass = useCallback(
    (data: ClassData) => {
      initialClassLoaded.current = true;
      setCls(data);
      setAnswers(
        retainedLearningProgress(
          `/api/v1/classes/${classId}`,
          { answers: data.learnerAnswers ?? {} },
          data.progressRevision ?? 0,
          String(data.attempt ?? 1),
          data.attempt && data.taskMaterialRevision
            ? { expectedAttempt: data.attempt, taskMaterialRevision: data.taskMaterialRevision }
            : null
        ).answers ?? {}
      );
      const ordered = orderSections(data.sections);

      if (data.submitted && data.submission) {
        setResult(
          data.submission.receipt ?? {
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
          }
        );
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
    [classId, initialSectionId]
  );

  const waitForClassRefresh = useCallback(
    (options?: ClassRefreshOptions) => pollClassRefresh(fetchClassData, options),
    [fetchClassData]
  );

  const loadClass = useCallback(
    async (signal = classLifetime.current?.signal) => {
      try {
        let data = await fetchClassData();
        signal?.throwIfAborted();

        if (
          !data.submitted &&
          (data.status === 'GENERATING' || isClassPresentationStillRendering(data))
        ) {
          setAutoRefreshing(true);
          setView('loading');
          resetClassProgress();
          data = await waitForClassRefresh({ signal });
        }
        signal?.throwIfAborted();

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
        if (error instanceof ClassLoadSuperseded || signal?.aborted) return;
        setErrorMessage(error instanceof Error ? error.message : 'Network error. Please refresh.');
        setView('error');
      } finally {
        setAutoRefreshing(false);
      }
    },
    [applyLoadedClass, fetchClassData, resetClassProgress, waitForClassRefresh]
  );

  useEffect(() => {
    const lifetime = new AbortController();
    classLifetime.current = lifetime;
    void (async () => {
      await loadClass(lifetime.signal);
    })();
    return () => {
      lifetime.abort();
      if (classLifetime.current === lifetime) classLifetime.current = null;
      classLoadGeneration.current += 1;
      cancelClassLoad.current?.();
    };
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
      if (prelude?.kind === 'BASE' || prelude?.kind === 'ADDENDUM') {
        await flushLearningProgress(
          `/api/v1/classes/${classId}`,
          String(cls.attempt ?? 1),
          cls.progressRevision ?? 0
        );
        setView('assessment');
        return;
      }
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
      const res = await fetch(`/api/v1/classes/${classId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'sections', expectedAttempt: cls?.attempt ?? 1 }),
      });
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

  async function handleRetrySection() {
    const lifetime = classLifetime.current?.signal;
    const section = sections[segIdx];
    if (!cls || !section || retryInFlight.current) return;
    retryInFlight.current = true;
    setRegenerating(true);
    setErrorMessage('');
    try {
      const expectedRevision = await flushLearningProgress(
        `/api/v1/classes/${classId}`,
        String(cls.attempt ?? 1),
        cls.progressRevision ?? 0
      );
      const res = await fetch(`/api/v1/classes/${classId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'section',
          sectionId: section.id,
          expectedAttempt: cls.attempt ?? 1,
          expectedRevision,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'New questions could not be prepared. Please try again.');
      }
      const accepted = (await res.json()) as { operationId?: string };
      if (!accepted.operationId)
        throw new Error(
          'Preparation was accepted without an operation ID. Please reload the class to check its status.'
        );
      const applyMaterial = (data: ClassData) => {
        const questionIds = new Set(
          data.sections.flatMap((item) => item.questions.map((question) => question.id))
        );
        const sectionIds = new Set(data.sections.map((item) => item.id));
        setCls(data);
        setAnswers((previous) =>
          Object.fromEntries(
            Object.entries({ ...previous, ...data.learnerAnswers }).filter(([id]) =>
              questionIds.has(id)
            )
          )
        );
        setScores((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([id]) => sectionIds.has(id)))
        );
      };
      const retainedIds = new Set(
        sections.filter((item) => item.id !== section.id).map((item) => item.id)
      );
      const replacementIn = (data: ClassData) =>
        data.sections.find(
          (item) =>
            item.skill === section.skill &&
            item.id !== section.id &&
            !retainedIds.has(item.id) &&
            item.attempt > section.attempt
        );
      const data = await waitForClassRefresh({
        signal: lifetime,
        isExpectedMaterial: (candidate) =>
          (candidate.attempt ?? 1) > (cls.attempt ?? 1) && Boolean(replacementIn(candidate)),
        operation: { id: accepted.operationId, courseId: cls.courseId, onStopped: applyMaterial },
      });
      const ordered = orderSections(data.sections);
      const replacement = replacementIn(data);
      if (!replacement)
        throw new Error('The new questions are not ready. Please reload the class.');
      const oldQuestionNotes = new Set(
        section.questions.map((question) => `${section.skill}:${question.id}`)
      );
      applyMaterial(data);
      setFeedbackNotes((previous) => previous.filter((note) => !oldQuestionNotes.has(note.id)));
      setMcCompletion(null);
      setSegIdx(ordered.findIndex((item) => item.id === replacement.id));
      setCurScore(0);
      setView('hour');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Network error. Please try again.');
    } finally {
      retryInFlight.current = false;
      setRegenerating(false);
    }
  }

  async function handleRegenerateClass() {
    const lifetime = classLifetime.current?.signal;
    setRegenerating(true);
    setErrorMessage('');
    try {
      await regenerateWholeClass();
      resetClassProgress();
      setView('loading');
      const data = await waitForClassRefresh({ signal: lifetime });
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
  const startedHour = committedCount > 0 || visitedSection;
  const activeSectionProgress =
    view === 'hour' && sections.length > 0 ? Math.min(curScore / Math.max(gate, 1), 1) : 0;
  const completionPct =
    view === 'summary'
      ? 100
      : sections.length > 0
        ? Math.round(((committedCount + activeSectionProgress) / sections.length) * 100)
        : 0;

  if (view === 'loading') return <ClassLoadingState autoRefreshing={autoRefreshing} />;
  if (view === 'error' || !cls) {
    return (
      <ClassErrorState
        classId={classId}
        errorMessage={errorMessage}
        regenerating={regenerating}
        onRegenerate={() => void handleRegenerateClass()}
        onBack={() => router.push('/learn')}
        onRetry={() => {
          setView('loading');
          setErrorMessage('');
          void loadClass();
        }}
      />
    );
  }

  const classEndpoint = `/api/v1/classes/${classId}`;
  const classAttempt = String(cls.attempt ?? 1);
  if (classProgressBlocked(classEndpoint, classAttempt)) {
    return (
      <ClassRecoveryState
        endpoint={classEndpoint}
        attempt={classAttempt}
        saveError={saveError}
        onArchived={() => setRecoveryVersion((value) => value + 1)}
        onRetry={() => {
          setView('loading');
          void loadClass();
        }}
      />
    );
  }

  // ---- stage content ----
  let stage: React.ReactNode = null;
  const nextName = segIdx < sections.length - 1 ? skillLabel(sections[segIdx + 1].skill) : null;
  const activeSection = sections[segIdx];
  const liveMcResult =
    activeSection && mcCompletion?.sectionId === activeSection.id
      ? { id: activeSection.id, skill: activeSection.skill, score: curScore / 100, ...mcCompletion }
      : null;
  const hasLiveFeedback =
    Boolean(liveMcResult?.complete) ||
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
  const currentDirections =
    prerequisiteDirections?.classId === classId &&
    prerequisiteDirections.classId === cls.id &&
    prerequisiteDirections.sourceHash === cls.prerequisiteSourceHash
      ? prerequisiteDirections
      : null;

  if (view === 'hub') {
    stage = (
      <>
        <ClassHub
          classId={classId}
          courseId={cls.courseId}
          lesson={cls.lesson}
          intro={cls.intro}
          teaching={cls.teaching}
          prerequisiteSourceHash={cls.prerequisiteSourceHash}
          lessonHelpRevision={cls.lessonHelpRevision}
          prerequisiteDirections={currentDirections}
          onDirectionsChange={setPrerequisiteDirections}
          order={cls.order}
          sections={sections}
          writingHistory={cls.writingHistory}
          speakingHistory={cls.speakingHistory}
          speakingHistoryUnlinked={cls.speakingHistoryUnlinked}
          orphanWritingDrafts={cls.orphanWritingDrafts}
          quizHistory={cls.quizHistory}
          orphanQuizAnswers={cls.orphanQuizAnswers}
          quizHistoryUnreadable={cls.quizHistoryUnreadable}
          quizSubmissionReceipts={cls.quizSubmissionReceipts}
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
  } else if (view === 'assessment') {
    stage = (
      <ClassAssessment
        classId={classId}
        classAttempt={cls.attempt ?? 1}
        onBack={() => setView('hour')}
        onComplete={(receipt) => {
          setResult(receipt);
          setCls((previous) =>
            previous
              ? {
                  ...previous,
                  submitted: true,
                  status: receipt.passed ? 'PASSED' : 'FAILED',
                  submission: {
                    passed: receipt.passed,
                    overallScore: receipt.overallScore,
                    receipt,
                  },
                }
              : previous
          );
          setView('summary');
        }}
      />
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
            key={`${seg.id}:${seg.attempt}`}
            courseId={cls.courseId}
            sourceId={seg.id}
            skill={seg.skill}
            questions={seg.questions}
            prerequisiteDirections={currentDirections}
            savedAnswers={answers}
            gate={gate}
            nextName={nextName}
            references={passageReferences}
            onAnswer={recordAnswer}
            onScore={setCurScore}
            onFeedback={upsertFeedbackNote}
            feedbackHref="#feedback-clinic"
            onContinue={advanceHour}
            onCompletionChange={recordMcCompletion}
            onRetry={() => void handleRetrySection()}
            retrying={regenerating}
          />
        );
      } else if (seg.skill === 'LISTENING') {
        stage = (
          <ListeningSection
            key={`${seg.id}:${seg.attempt}`}
            courseId={cls.courseId}
            sourceId={seg.id}
            episode={seg.episode}
            questions={seg.questions}
            prerequisiteDirections={currentDirections}
            savedAnswers={answers}
            gate={gate}
            nextName={nextName}
            onAnswer={recordAnswer}
            onScore={setCurScore}
            onFeedback={upsertFeedbackNote}
            feedbackHref="#feedback-clinic"
            onContinue={advanceHour}
            onCompletionChange={recordMcCompletion}
            onRetry={() => void handleRetrySection()}
            retrying={regenerating}
          />
        );
      } else if (seg.skill === 'SPEAKING') {
        stage = (
          <SpeakingSection
            key={seg.id}
            endpointBase={`/api/v1/classes/${classId}/speaking`}
            classBinding={
              cls.attempt && cls.taskMaterialRevision
                ? { expectedAttempt: cls.attempt, taskMaterialRevision: cls.taskMaterialRevision }
                : null
            }
            prompts={seg.prompts}
            sectionId={seg.id}
            prerequisiteDirections={currentDirections}
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
          <ClassWritingStage
            key={seg.id}
            classId={classId}
            progressRevision={cls?.progressRevision ?? 0}
            attempt={cls?.attempt ?? 1}
            taskMaterialRevision={cls?.taskMaterialRevision ?? null}
            prompts={seg.writingPrompts}
            sectionId={seg.id}
            prerequisiteDirections={currentDirections}
            gate={gate}
            nextName={nextName}
            onScore={setCurScore}
            onFeedback={recordWritingFeedback}
            onContinue={advanceHour}
          />
        );
      }
    }
  }

  const onHub = view === 'hub';

  return (
    <div className={styles.cshell}>
      <ClassNavigation
        classInfo={cls}
        currentSection={
          view === 'hour' && activeSection
            ? skillLabel(activeSection.skill)
            : view === 'assessment'
              ? 'Independent assessment'
              : view === 'summary'
                ? 'Class results'
                : view === 'submitting'
                  ? 'Grading class'
                  : 'Lesson overview'
        }
        onOverview={
          view === 'hour'
            ? () => {
                setVisitedSection(true);
                setView('hub');
              }
            : undefined
        }
        busy={regenerating}
      />
      <aside className={styles.crail} aria-label="Class navigation">
        <div className={styles.crailGlow} aria-hidden="true" />

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
            busy={regenerating}
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
          <RetainedClassWork endpoint={classEndpoint} attempt={classAttempt} />
          {saveError && (
            <LearningSaveRecovery
              endpoint={`/api/v1/classes/${classId}`}
              material={String(cls?.attempt ?? 1)}
              error={saveError}
            />
          )}
          {errorMessage && (view === 'hour' || view === 'hub' || view === 'summary') && (
            <p className={styles.errorBanner} role="alert">
              {errorMessage}
            </p>
          )}
          <div id="class-active-stage">
            {view === 'hour' && (
              <ClassTeachingNotes
                key={`${cls.id}:${cls.attempt ?? 1}`}
                classId={cls.id}
                courseId={cls.courseId}
                intro={cls.intro}
                teaching={cls.teaching}
                prerequisiteSourceHash={cls.prerequisiteSourceHash}
                lessonHelpRevision={cls.lessonHelpRevision}
                prerequisiteDirections={currentDirections}
                onDirectionsChange={setPrerequisiteDirections}
                collapsible
              />
            )}
            {stage}
          </div>
          {view === 'hour' && hasLiveFeedback && (
            <FeedbackClinic
              result={null}
              sections={feedbackSections}
              vocabulary={cls.vocabulary}
              feedbackNotes={feedbackNotes}
              liveSection={liveMcResult}
              retrying={regenerating}
              onRetrySection={() => void handleRetrySection()}
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
