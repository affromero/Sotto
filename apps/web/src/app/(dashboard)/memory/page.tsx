'use client';

import { useEffect, useState, useCallback } from 'react';
import { MemoryGraph } from '@/components/memory/MemoryGraph';
import type { MemoryGraphData } from '@/components/memory/MemoryGraph';
import styles from './memory.module.css';

// Shape returned by GET /api/courses
interface CourseItem {
  id: string;
  pair: string;
  nativeLang: string;
  targetLang: string;
  currentLevel: string;
  activeClassId: string | null;
  curriculum: { title: string } | null;
  placement: { level: string; createdAt: string } | null;
}

type LoadState = 'idle' | 'loading' | 'error';

const LANG_LABELS: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  it: 'Italian',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
};

function langLabel(code: string): string {
  return LANG_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

function courseLabel(course: CourseItem): string {
  if (course.curriculum?.title) return course.curriculum.title;
  return `${langLabel(course.targetLang)} from ${langLabel(course.nativeLang)}`;
}

export default function MemoryPage() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [coursesState, setCoursesState] = useState<LoadState>('loading');

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [graph, setGraph] = useState<MemoryGraphData | null>(null);
  const [graphState, setGraphState] = useState<LoadState>('idle');

  // Load courses on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/courses');
        if (!res.ok) throw new Error('Failed to load courses');
        const data = (await res.json()) as { courses: CourseItem[] };
        setCourses(data.courses);
        setCoursesState('idle');
        if (data.courses.length > 0) {
          setSelectedCourseId(data.courses[0].id);
        }
      } catch {
        setCoursesState('error');
      }
    })();
  }, []);

  const loadGraph = useCallback(async (courseId: string) => {
    setGraphState('loading');
    setGraph(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/graph`);
      if (!res.ok) throw new Error('Failed to load graph');
      const data = (await res.json()) as MemoryGraphData;
      setGraph(data);
      setGraphState('idle');
    } catch {
      setGraphState('error');
    }
  }, []);

  // Load graph whenever course selection changes
  useEffect(() => {
    if (!selectedCourseId) return;
    void loadGraph(selectedCourseId);
  }, [selectedCourseId, loadGraph]);

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Memory Graph</h1>
        <p className={styles.subtitle}>
          Your vocabulary and grammar connections, visualised.
        </p>
      </header>

      {/* Course states */}
      {coursesState === 'loading' && (
        <div className={styles.statusRow} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Loading courses…</span>
        </div>
      )}

      {coursesState === 'error' && (
        <div className={styles.errorBox} role="alert">
          Could not load your courses. Please refresh and try again.
        </div>
      )}

      {coursesState === 'idle' && courses.length === 0 && (
        <div className={styles.emptyState} role="status">
          <p className={styles.emptyHeading}>No courses yet.</p>
          <p className={styles.emptyBody}>
            Take a placement test to start a course and build your memory graph.
          </p>
        </div>
      )}

      {coursesState === 'idle' && courses.length > 0 && (
        <div className={styles.body}>
          {/* Course selector — only shown when the learner has more than one */}
          {courses.length > 1 && (
            <div className={styles.selectorRow}>
              <label htmlFor="course-select" className={styles.selectorLabel}>
                Course
              </label>
              <select
                id="course-select"
                className={styles.selector}
                value={selectedCourseId ?? ''}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                aria-label="Select course to view memory graph"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {courseLabel(c)} — {c.currentLevel}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Graph area */}
          <div className={styles.graphWrapper}>
            {graphState === 'loading' && (
              <div className={styles.graphOverlay} role="status" aria-live="polite">
                <span className={styles.spinner} aria-hidden="true" />
                <span>Loading graph…</span>
              </div>
            )}

            {graphState === 'error' && (
              <div className={styles.errorBox} role="alert">
                Could not load the memory graph. Please try again.
              </div>
            )}

            {graphState === 'idle' && graph && (
              <MemoryGraph graph={graph} />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
