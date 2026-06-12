'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SpeakingExercise } from '@/components/class/SpeakingExercise';
import { ExamDisclaimer } from './ExamDisclaimer';
import { CefrDisclaimer } from './CefrDisclaimer';
import styles from './ExamRunner.module.css';

interface ExamQuestion {
  id: string;
  order: number;
  question: string;
  options: string[];
  passageRef: string | null;
  passageText: string | null;
  correctIndex?: number;
  explanation?: string;
}
interface SpeakingPrompt {
  id: string;
  order: number;
  targetPhrase: string;
  translation: string;
  referenceTtsUrl: string | null;
}
interface WritingPrompt {
  id: string;
  order: number;
  task: string;
  guidance: string | null;
}
interface ExamSection {
  id: string;
  skill: string;
  part: string;
  order: number;
  format: string;
  weight: number;
  status: string;
  score: number | null;
  episode: { id: string; audioUrl: string | null; status: string } | null;
  questions: ExamQuestion[];
  speakingPrompts: SpeakingPrompt[];
  writingPrompts: WritingPrompt[];
}
export interface ExamData {
  id: string;
  institution: string;
  institutionLabel: string;
  level: string;
  status: string;
  examName: string;
  sections: ExamSection[];
  result: {
    overallScore: number | null;
    band: string | null;
    feedback: string | null;
    sectionResults: Array<{ sectionId: string; skill: string; score: number; feedback: string | null }>;
  } | null;
}

function pct(n: number | null | undefined): string {
  return n == null ? '' : `${Math.round(n * 100)}%`;
}

// Listening audio: the episode finishes generating asynchronously, so poll for it.
function ListeningAudio({ episodeId, initialUrl }: { episodeId: string; initialUrl: string | null }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(initialUrl);
  useEffect(() => {
    if (audioUrl) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/v1/episodes/${episodeId}`);
        if (res.ok) {
          const data = (await res.json()) as { audioUrl?: string | null };
          if (active && data.audioUrl) {
            setAudioUrl(data.audioUrl);
            return;
          }
        }
      } catch {
        // keep polling
      }
      if (active) timer = setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [episodeId, audioUrl]);

  if (!audioUrl) {
    return (
      <p className={styles.audioGenerating} role="status">
        The audio is still being generated. It will appear here shortly.
      </p>
    );
  }
  return <audio className={styles.audio} controls preload="metadata" src={audioUrl} aria-label="Listening audio" />;
}

interface Props {
  exam: ExamData;
}

export function ExamRunner({ exam: initialExam }: Props) {
  const router = useRouter();
  const [exam, setExam] = useState<ExamData>(initialExam);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scored = exam.status === 'SCORED';
  const resultBySection = new Map((exam.result?.sectionResults ?? []).map((r) => [r.sectionId, r]));

  const choose = useCallback((questionId: string, index: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: index }));
  }, []);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        answers: Object.entries(answers).map(([questionId, selectedIndex]) => ({ questionId, selectedIndex })),
      };
      const res = await fetch(`/api/v1/exams/${exam.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        setError(typeof body.error === 'string' ? body.error : 'Could not submit the exam.');
        setSubmitting(false);
        return;
      }
      // Re-fetch the now-SCORED exam so the answer key + per-section results show.
      const fresh = await fetch(`/api/v1/exams/${exam.id}`);
      if (fresh.ok) setExam((await fresh.json()) as ExamData);
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.root}>
      <header className={styles.head}>
        <div className={styles.eyebrow}>{scored ? 'Exam result' : 'Practice exam'}</div>
        <h1 className={styles.title}>{exam.examName}</h1>
        <p className={styles.sub}>{exam.level} · modeled on the real exam format</p>
      </header>

      <ExamDisclaimer examName={exam.examName} institutionLabel={exam.institutionLabel} />

      {scored && exam.result && (
        <section className={styles.results}>
          <div className={styles.band}>{exam.result.band}</div>
          <div className={styles.overall}>Overall {pct(exam.result.overallScore)}</div>
          {exam.result.feedback && <p className={styles.feedback}>{exam.result.feedback}</p>}
        </section>
      )}

      {exam.sections.map((section) => {
        const result = resultBySection.get(section.id);
        return (
          <section key={section.id} className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.part}>{section.part}</h2>
              {scored && result && <span className={styles.sectionScore}>{pct(result.score)}</span>}
            </div>
            {scored && result?.feedback && <p className={styles.sectionFeedback}>{result.feedback}</p>}

            {section.status === 'FAILED' && (
              <p className={styles.failed} role="status">
                This section could not be generated. The rest of the exam still counts.
              </p>
            )}

            {section.format === 'listening' && section.episode && (
              <ListeningAudio episodeId={section.episode.id} initialUrl={section.episode.audioUrl} />
            )}

            {section.format === 'speaking' ? (
              <SpeakingExercise
                endpointBase={`/api/v1/exams/${exam.id}/speaking`}
                prompts={section.speakingPrompts}
              />
            ) : section.format === 'writing' ? (
              <ExamWriting examId={exam.id} prompts={section.writingPrompts} disabled={scored} />
            ) : (
              <ol className={styles.questions}>
                {section.questions.map((q) => (
                  <li key={q.id} className={styles.question}>
                    {q.passageText && <p className={styles.passage}>{q.passageText}</p>}
                    <fieldset className={styles.field}>
                      <legend className={styles.prompt}>{q.question}</legend>
                      {q.options.map((opt, i) => {
                        const chosen = answers[q.id] === i;
                        const isCorrect = scored && q.correctIndex === i;
                        const isWrongChoice = scored && chosen && q.correctIndex !== i;
                        return (
                          <label
                            key={i}
                            className={`${styles.option} ${isCorrect ? styles.optionCorrect : ''} ${
                              isWrongChoice ? styles.optionWrong : ''
                            }`}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              checked={chosen}
                              disabled={scored}
                              onChange={() => choose(q.id, i)}
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                      {scored && q.explanation && <p className={styles.explanation}>{q.explanation}</p>}
                    </fieldset>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}

      {!scored && (
        <div className={styles.submitRow}>
          <button type="button" className={styles.submitBtn} onClick={submit} disabled={submitting}>
            {submitting ? 'Scoring…' : 'Submit exam'}
          </button>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {scored && (
        <div className={styles.submitRow}>
          <button type="button" className={styles.againBtn} onClick={() => router.push('/learn/exams')}>
            Back to exams
          </button>
        </div>
      )}

      <CefrDisclaimer variant="compact" />
    </main>
  );
}

// Inline writing: each prompt is graded synchronously on submit.
function ExamWriting({ examId, prompts, disabled }: { examId: string; prompts: WritingPrompt[]; disabled: boolean }) {
  return (
    <div className={styles.writing}>
      {prompts.map((p) => (
        <ExamWritingPrompt key={p.id} examId={examId} prompt={p} disabled={disabled} />
      ))}
    </div>
  );
}

function ExamWritingPrompt({ examId, prompt, disabled }: { examId: string; prompt: WritingPrompt; disabled: boolean }) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'grading' | 'done' | 'error'>('idle');
  const [score, setScore] = useState<number | null>(null);

  async function submit() {
    setPhase('grading');
    try {
      const res = await fetch(`/api/v1/exams/${examId}/writing/${prompt.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        setPhase('error');
        return;
      }
      const grade = (await res.json()) as { overallScore?: number | null };
      setScore(grade.overallScore ?? null);
      setPhase('done');
    } catch {
      setPhase('error');
    }
  }

  return (
    <div className={styles.writingPrompt}>
      <p className={styles.writingTask}>{prompt.task}</p>
      {prompt.guidance && <p className={styles.writingGuidance}>{prompt.guidance}</p>}
      <textarea
        className={styles.writingInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        disabled={disabled || phase === 'grading' || phase === 'done'}
        placeholder="Write your response here."
        aria-label="Your writing response"
      />
      {phase === 'done' ? (
        <p className={styles.writingDone}>Submitted{score != null ? ` · ${pct(score)}` : ''}.</p>
      ) : (
        <button
          type="button"
          className={styles.writingBtn}
          onClick={submit}
          disabled={disabled || !text.trim() || phase === 'grading'}
        >
          {phase === 'grading' ? 'Grading…' : 'Submit response'}
        </button>
      )}
      {phase === 'error' && (
        <p className={styles.error} role="alert">
          Could not grade that response. Try again.
        </p>
      )}
    </div>
  );
}
