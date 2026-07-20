'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CefrDisclaimer } from './CefrDisclaimer';
import { ExamDisclaimer } from './ExamDisclaimer';
import styles from './ExamHub.module.css';

interface Available {
  institution: string;
  institutionLabel: string;
  examName: string;
  level: string;
  sectionCount: number;
}

interface HistoryItem {
  id: string;
  examName: string;
  level: string;
  status: string;
  band: string | null;
  overallScore: number | null;
  createdAt: string;
}

interface Props {
  courseId: string;
  available: Available;
  history: HistoryItem[];
}

function pct(n: number | null): string {
  return n == null ? '' : `${Math.round(n * 100)}%`;
}

export function ExamHub({ courseId, available, history }: Props) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        setError(typeof body.error === 'string' ? body.error : 'Could not start the exam.');
        setStarting(false);
        return;
      }
      const { examId } = (await res.json()) as { examId: string };
      router.push(`/learn/exams/${examId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  return (
    <main className={styles.root}>
      <header className={styles.head}>
        <div className={styles.eyebrow}>Practice exam</div>
        <h1 className={styles.title}>
          Sit a full <em>{available.examName}</em>.
        </h1>
        <p className={styles.sub}>
          {available.sectionCount} sections, modeled on the real exam format at {available.level}.
          You get a mock band and section-by-section feedback at the end.
        </p>
      </header>

      <ExamDisclaimer examName={available.examName} institutionLabel={available.institutionLabel} />

      <div className={styles.startRow}>
        <button type="button" className={styles.startBtn} onClick={start} disabled={starting}>
          {starting ? 'Building your exam…' : 'Start the exam'}
        </button>
        {starting && (
          <span className={styles.startNote}>Generating all sections. This can take a minute.</span>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {history.length > 0 && (
        <section className={styles.history}>
          <h2 className={styles.historyTitle}>Past attempts</h2>
          <ul className={styles.historyList} role="list">
            {history.map((h) => (
              <li key={h.id} className={styles.historyItem}>
                <button
                  type="button"
                  className={styles.historyLink}
                  onClick={() => router.push(`/learn/exams/${h.id}`)}
                >
                  <span className={styles.historyName}>{h.examName}</span>
                  <span className={styles.historyMeta}>
                    {h.status === 'SCORED' && h.band ? (
                      <>
                        <b>{h.band}</b>
                        {h.overallScore != null && <> · {pct(h.overallScore)}</>}
                      </>
                    ) : (
                      h.status.toLowerCase()
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CefrDisclaimer variant="compact" />
    </main>
  );
}
