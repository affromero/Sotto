'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { learningObjectiveHistorySchema, type CefrLevel } from '@sotto/shared';
import styles from './ObjectiveHistory.module.css';

type History = z.infer<typeof learningObjectiveHistorySchema>;
interface Props {
  courseId: string;
  objectiveId: string;
  level: CefrLevel;
}

export function ObjectiveHistory(props: Props) {
  return (
    <OwnedObjectiveHistory
      key={`${props.courseId}:${props.objectiveId}:${props.level}`}
      {...props}
    />
  );
}

function OwnedObjectiveHistory({ courseId, objectiveId, level }: Props) {
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function load(cursor?: string) {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams({
        level,
        ...(cursor ? { after: cursor } : {}),
      });
      const response = await fetch(
        `/api/v1/courses/${encodeURIComponent(courseId)}/learning-map/objectives/${encodeURIComponent(objectiveId)}/history?${query}`,
        { signal: current.signal, cache: 'no-store' }
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(body);
        throw new Error(
          failure.success ? failure.data.error : 'Could not load assessment history.'
        );
      }
      const result = learningObjectiveHistorySchema.parse(body);
      if (current.signal.aborted || controller.current !== current) return;
      if (result.courseId !== courseId || result.objectiveId !== objectiveId)
        throw new Error('This history belongs to another objective.');
      setHistory((previous) =>
        cursor && previous ? { ...result, items: [...previous.items, ...result.items] } : result
      );
    } catch (cause) {
      if (!current.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not read history.');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section className={styles.root} aria-label="Objective assessment history">
      {!history && (
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? 'Loading assessment history...' : 'Show assessment history'}
        </button>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {history && (
        <>
          <h4>Assessment history</h4>
          {history.items.length === 0 ? (
            <p>
              This objective has no qualifying assessment yet. Uploaded material and level placement
              do not create mastery.
            </p>
          ) : (
            <ol>
              {history.items.map((item) => (
                <li key={item.id}>
                  <div className={styles.meta}>
                    <time dateTime={item.observedAt}>
                      {new Date(item.observedAt).toLocaleDateString()}
                    </time>
                    <span>{item.skill.toLowerCase()}</span>
                    <strong>{Math.round(item.quality * 100)}%</strong>
                  </div>
                  <p>{item.rationale}</p>
                  <details>
                    <summary>Criterion and task</summary>
                    <p>{item.assessment}</p>
                    <p>
                      Session {item.sessionId}, task {item.taskId}.
                    </p>
                  </details>
                </li>
              ))}
            </ol>
          )}
          {history.nextCursor && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void load(history.nextCursor ?? undefined)}
            >
              {busy ? 'Loading...' : 'More assessment history'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
