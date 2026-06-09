/**
 * lib/learn-api.ts
 *
 * Typed wrappers around the Sotto language-learning API endpoints.
 * All functions use the `api` Axios instance which auto-attaches the Bearer token.
 */

import { api } from './api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CourseSummary {
  id: string;
  pair: string;
  nativeLang: string;
  targetLang: string;
  currentLevel: string;
  activeClassId: string | null;
}

export interface PlacementQuestion {
  id: string;
  prompt: string;
  options: string[];
  audioUrl?: string | null;
  skill: string;
}

export interface ClassQuestion {
  id: string;
  order: number;
  question: string;
  options: string[];
  passageRef?: string | null;
  /** Sourced classes: the real CEFR-leveled reading passage (may contain [N] markers). */
  passageText?: string | null;
  correctIndex?: number;
  explanation?: string;
}

/** A verified source attached to a sourced class. */
export interface ClassReference {
  number: number;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  type: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'FAILED' | 'REPLACED' | 'REMOVED';
  contentDomain: string | null;
}

export interface ClassPrompt {
  id: string;
  order: number;
  targetPhrase: string;
  translation: string;
  ipa?: string | null;
  referenceTtsUrl?: string | null;
}

export interface ClassSectionData {
  id: string;
  skill: string;
  status: string;
  attempt: number;
  score: number | null;
  passed: boolean | null;
  podcast: { id: string; audioUrl: string | null; title: string; references?: ClassReference[] } | null;
  questions: ClassQuestion[];
  prompts: ClassPrompt[];
}

export interface ClassData {
  id: string;
  status: string;
  order: number;
  passThreshold: number;
  lesson: { title: string; level: string; objective: string };
  submitted: boolean;
  submission: { passed: boolean; overallScore: number } | null;
  /** Sourced classes: the real link/title this class was built from. */
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sections: ClassSectionData[];
}

export interface SpeakingScore {
  status: string;
  overallScore?: number;
  transcript?: string;
  rubricScores?: { accuracy: number; fluency: number; completeness: number };
  feedback?: string;
}

export interface SubmitResultData {
  passed: boolean;
  overallScore: number;
  passedSections: number;
  totalSections: number;
  sections: { id: string; skill: string; score: number; passed: boolean }[];
}

export interface MemoryGraphData {
  nodes: {
    id: string;
    kind: 'vocab' | 'grammar';
    label: string;
    translation?: string;
    strength: number;
    due: boolean;
  }[];
  edges: { source: string; target: string; type: string; weight: number }[];
}

export type NextClassResult =
  | { kind: 'created'; classId: string }
  | { kind: 'gated'; activeClassId: string; status: string }
  | { kind: 'done' };

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** GET /api/courses — list the signed-in learner's courses. */
export async function listCourses(): Promise<CourseSummary[]> {
  const res = await api.get<{ courses: CourseSummary[] }>('/api/courses');
  return res.data.courses;
}

/** GET /api/placement?pair=... — fetch an adaptive placement question batch. */
export async function fetchPlacement(pair: string): Promise<PlacementQuestion[]> {
  const res = await api.get<{ questions: PlacementQuestion[] }>('/api/placement', {
    params: { pair },
  });
  return res.data.questions;
}

/** POST /api/placement — submit placement answers, get courseId + level back. */
export async function submitPlacement(
  pair: string,
  responses: { questionId: string; selectedIndex: number }[],
): Promise<{ courseId: string; level: string }> {
  const res = await api.post<{ courseId: string; level: string }>('/api/placement', {
    pair,
    answers: responses.map(({ questionId, selectedIndex }) => ({
      id: questionId,
      selectedIndex,
    })),
  });
  return res.data;
}

/** POST /api/courses/[courseId]/next-class — create or resume the next gated class. */
export async function startNextClass(courseId: string): Promise<NextClassResult> {
  try {
    const res = await api.post<{ classId?: string; done?: boolean }>(
      `/api/courses/${courseId}/next-class`,
    );
    if (res.data.done) return { kind: 'done' };
    return { kind: 'created', classId: res.data.classId as string };
  } catch (err: unknown) {
    // 409 means gated — the server returns activeClassId + status in the error body
    const axiosErr = err as { response?: { status?: number; data?: { activeClassId?: string; status?: string } } };
    if (axiosErr.response?.status === 409) {
      const data = axiosErr.response.data ?? {};
      return {
        kind: 'gated',
        activeClassId: data.activeClassId ?? '',
        status: data.status ?? '',
      };
    }
    throw err;
  }
}

/** GET /api/classes/[classId] — full class with sections, questions, prompts. */
export async function fetchClass(classId: string): Promise<ClassData> {
  const res = await api.get<ClassData>(`/api/classes/${classId}`);
  return res.data;
}

/** POST /api/classes/[classId]/submit — grade MC answers. */
export async function submitClass(
  classId: string,
  answers: { questionId: string; selectedIndex: number }[],
): Promise<SubmitResultData> {
  const res = await api.post<SubmitResultData>(`/api/classes/${classId}/submit`, { answers });
  return res.data;
}

/** POST /api/classes/[classId]/speaking/[promptId] — upload a speaking recording. */
export async function uploadSpeaking(
  classId: string,
  promptId: string,
  fileUri: string,
): Promise<{ recordingId: string; status: string }> {
  const formData = new FormData();
  formData.append('audio', {
    uri: fileUri,
    name: 'speaking.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);

  const res = await api.post<{ recordingId: string; status: string }>(
    `/api/classes/${classId}/speaking/${promptId}`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data;
}

/** GET /api/classes/[classId]/speaking/[promptId]?recordingId=... — poll grading status. */
export async function pollSpeaking(
  classId: string,
  promptId: string,
  recordingId: string,
): Promise<SpeakingScore> {
  const res = await api.get<SpeakingScore>(
    `/api/classes/${classId}/speaking/${promptId}`,
    { params: { recordingId } },
  );
  return res.data;
}

/** GET /api/courses/[courseId]/graph — vocabulary + grammar memory graph. */
export async function fetchGraph(courseId: string): Promise<MemoryGraphData> {
  const res = await api.get<MemoryGraphData>(`/api/courses/${courseId}/graph`);
  return res.data;
}

/** POST /api/classes/[classId]/ink — upsert an ink/handwriting layer. */
export async function saveInk(
  classId: string,
  surface: string,
  strokes: string,
): Promise<void> {
  await api.post(`/api/classes/${classId}/ink`, { surface, strokes });
}
