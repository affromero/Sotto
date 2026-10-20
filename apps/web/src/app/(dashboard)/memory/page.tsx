'use client';

import { useEffect, useState } from 'react';
import { memoryGraphResponseSchema, type LearningObjectiveMemory } from '@sotto/shared';
import { MemoryGraph } from '@/components/memory/MemoryGraph';
import { ObjectiveMemorySummary } from '@/components/memory/ObjectiveMemorySummary';
import { SottoSpinner } from '@/components/ui/SottoSpinner';
import type { MemoryGraphData } from '@/components/memory/MemoryGraph';
import styles from './memory.module.css';

// Shape returned by GET /api/v1/courses
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
  const [graphResult, setGraphResult] = useState<{
    courseId: string;
    graph: (MemoryGraphData & { objectives: LearningObjectiveMemory[] }) | null;
    state: LoadState;
  } | null>(null);
  const graph = graphResult?.courseId === selectedCourseId ? graphResult?.graph : null;
  const graphState = graphResult?.courseId === selectedCourseId ? graphResult.state : 'loading';

  // Load courses on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/v1/courses');
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

  // Load graph whenever course selection changes
  useEffect(() => {
    if (!selectedCourseId) return;
    const courseId = selectedCourseId;
    const controller = new AbortController();
    void fetch(`/api/v1/courses/${courseId}/graph`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load graph');
        const data = memoryGraphResponseSchema.parse(await res.json());
        if (!controller.signal.aborted) setGraphResult({ courseId, graph: data, state: 'idle' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setGraphResult({ courseId, graph: null, state: 'error' });
      });
    return () => controller.abort();
  }, [selectedCourseId]);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Memory Graph</h1>
        <p className={styles.subtitle}>
          Objective progress and your vocabulary and grammar review network.
        </p>
      </header>

      {/* Course states */}
      {coursesState === 'loading' && (
        <div className={styles.statusRow} role="status" aria-live="polite">
          <SottoSpinner size="small" label="Loading courses" />
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
                onChange={(e) => {
                  setSelectedCourseId(e.target.value);
                  setGraphResult(null);
                }}
                aria-label="Select course to view memory graph"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {courseLabel(c)}, {c.currentLevel}
                  </option>
                ))}
              </select>
            </div>
          )}

          {graphState === 'idle' && graph && selectedCourseId && (
            <ObjectiveMemorySummary courseId={selectedCourseId} objectives={graph.objectives} />
          )}

          <section aria-labelledby="review-network-heading">
            <h2 id="review-network-heading">Vocabulary and grammar review network</h2>
            <p className={styles.subtitle}>
              Graph strengths summarize vocabulary and broad grammar reviews. See the learning map
              for assessed objectives and level requirements.
            </p>
            {/* Graph area */}
            <div className={styles.graphWrapper}>
              {graphState === 'loading' && (
                <div className={styles.graphOverlay} role="status" aria-live="polite">
                  <SottoSpinner size="medium" label="Loading graph" />
                </div>
              )}

              {graphState === 'error' && (
                <div className={styles.errorBox} role="alert">
                  Could not load the memory graph. Please try again.
                </div>
              )}

              {graphState === 'idle' && graph && (
                <MemoryGraph
                  graph={graph}
                  courseId={selectedCourseId ?? undefined}
                  courseTitle={selectedCourse ? courseLabel(selectedCourse) : undefined}
                />
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
