'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import {
  addLearningTargetRequestSchema,
  coursesListResponseSchema,
  learningTargetSchema,
  playPhraseListSchema,
  type PlayPhraseView,
} from '@sotto/shared';
import { PlayHttpError, playErrorMessage } from './client/api';
import { usePlayProfileGuard, usePlayRequest } from './client/profile';
import styles from './PlayNotebook.module.css';

type Course = z.infer<typeof coursesListResponseSchema>['courses'][number];

export function PlayNotebook() {
  const playFetch = usePlayRequest();
  const verifyProfile = usePlayProfileGuard();
  const [phrases, setPhrases] = useState<PlayPhraseView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [coursesBusy, setCoursesBusy] = useState(false);
  const [studyError, setStudyError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  const load = useCallback(
    async (beforeId: string | null, signal?: AbortSignal) => {
      setBusy(true);
      setError(null);
      try {
        const page = await playFetch(
          `/api/v1/play/phrases${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ''}`,
          playPhraseListSchema,
          { signal }
        );
        if (signal?.aborted) return;
        setPhrases((previous) =>
          beforeId
            ? [
                ...new Map(
                  [...previous, ...page.phrases].map((phrase) => [phrase.id, phrase])
                ).values(),
              ]
            : page.phrases
        );
        setCursor(page.nextCursor);
      } catch (caught) {
        if (!signal?.aborted) {
          if (caught instanceof PlayHttpError && [401, 403].includes(caught.status)) {
            setPhrases([]);
            setCursor(null);
            setCourses(null);
            setChosen({});
            setSaved({});
          }
          setError(playErrorMessage(caught));
        }
      } finally {
        if (!signal?.aborted) setBusy(false);
      }
    },
    [playFetch]
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void load(null, controller.signal);
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const loadCourses = async () => {
    if (coursesBusy) return;
    setCoursesBusy(true);
    setStudyError(null);
    try {
      await verifyProfile();
      const response = await fetch('/api/v1/courses', {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok)
        throw new Error('Could not load your courses. Your phrases are still in the notebook.');
      const parsed = coursesListResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('Could not read your course list. Try again.');
      await verifyProfile();
      setCourses(parsed.data.courses);
    } catch (caught) {
      setStudyError(playErrorMessage(caught));
    } finally {
      setCoursesBusy(false);
    }
  };

  const addToStudy = async (phrase: PlayPhraseView) => {
    const courseId = chosen[phrase.id];
    if (
      !courseId ||
      saving ||
      !courses?.some((course) => course.id === courseId && course.targetLang === phrase.targetLang)
    )
      return;
    setSaving(phrase.id);
    setStudyError(null);
    try {
      await verifyProfile();
      const body = addLearningTargetRequestSchema.parse({
        text: phrase.text,
        kind: phrase.kind,
        contextText: phrase.contextText,
        sourceType: 'MANUAL',
        sourceId: phrase.id,
        sourceLabel: 'Partner play',
      });
      const response = await fetch(
        `/api/v1/courses/${encodeURIComponent(courseId)}/learning-targets`,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!response.ok)
        throw new Error('Could not add this to study. The phrase remains in your notebook.');
      if (!learningTargetSchema.safeParse(await response.json()).success)
        throw new Error(
          'The study response was incomplete. Check your course before adding again.'
        );
      setSaved((previous) => ({ ...previous, [phrase.id]: courseId }));
    } catch (caught) {
      setStudyError(playErrorMessage(caught));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className={styles.root} aria-labelledby="play-notebook-heading">
      <div className={styles.heading}>
        <h2 id="play-notebook-heading">Your phrase notebook</h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void load(null);
          }}
        >
          Refresh notebook
        </button>
      </div>
      <p className={styles.note}>Words and sentences you chose to keep. Only you can see these.</p>
      {error && <p role="alert">{error}</p>}
      {!busy && !error && phrases.length === 0 && (
        <p className={styles.empty}>
          Keep a word or sentence during a game. It will be here when you come back.
        </p>
      )}
      {busy && phrases.length === 0 && <p role="status">Loading your notebook…</p>}
      <ol className={styles.list}>
        {phrases.map((phrase) => (
          <li key={phrase.id} className={styles.phrase}>
            <span className={styles.meta}>
              {phrase.targetLang.toUpperCase()} · {phrase.kind.toLowerCase()}
            </span>
            <p lang={phrase.targetLang} className={styles.text}>
              {phrase.text}
            </p>
            {phrase.contextText && (
              <p lang={phrase.targetLang} className={styles.context}>
                {phrase.contextText}
              </p>
            )}
            <details
              onToggle={(event) => {
                if (event.currentTarget.open && courses === null) void loadCourses();
              }}
            >
              <summary>Add to study</summary>
              {coursesBusy && <p role="status">Loading your courses…</p>}
              {courses && (
                <>
                  {courses.some((course) => course.targetLang === phrase.targetLang) ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void addToStudy(phrase);
                      }}
                    >
                      <label htmlFor={`study-${phrase.id}`}>
                        Choose your course
                        <select
                          id={`study-${phrase.id}`}
                          value={chosen[phrase.id] ?? ''}
                          onChange={(event) =>
                            setChosen((previous) => ({
                              ...previous,
                              [phrase.id]: event.target.value,
                            }))
                          }
                          disabled={saving !== null}
                        >
                          <option value="">Choose a course</option>
                          {courses
                            .filter((course) => course.targetLang === phrase.targetLang)
                            .map((course) => (
                              <option key={course.id} value={course.id}>
                                {course.curriculum.title} · {course.currentLevel}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button
                        type="submit"
                        disabled={
                          !chosen[phrase.id] ||
                          saving !== null ||
                          (!!chosen[phrase.id] && saved[phrase.id] === chosen[phrase.id])
                        }
                      >
                        {saving === phrase.id
                          ? 'Adding…'
                          : chosen[phrase.id] && saved[phrase.id] === chosen[phrase.id]
                            ? 'Added to study'
                            : 'Add this phrase'}
                      </button>
                      {chosen[phrase.id] && saved[phrase.id] === chosen[phrase.id] && (
                        <p role="status">Added to your course.</p>
                      )}
                    </form>
                  ) : (
                    <p>
                      No course in {phrase.targetLang.toUpperCase()} yet. Your phrase stays here.{' '}
                      <Link href="/learn">Open your courses</Link>
                    </p>
                  )}
                </>
              )}
            </details>
          </li>
        ))}
      </ol>
      {studyError && (
        <div role="alert">
          <p>{studyError}</p>
          {courses === null && (
            <button
              type="button"
              disabled={coursesBusy}
              onClick={() => {
                void loadCourses();
              }}
            >
              Retry course list
            </button>
          )}
        </div>
      )}
      {cursor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void load(cursor);
          }}
        >
          {busy ? 'Loading…' : 'Older phrases'}
        </button>
      )}
    </section>
  );
}
