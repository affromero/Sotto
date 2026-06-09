/**
 * Shared types for the class flow. Mirrors the API contract returned by
 * `GET /api/classes/[classId]` (see the route + class-service). Kept in one
 * place so ClassShell and every section module agree on shapes.
 */

export type ClassSkill = 'GRAMMAR' | 'READING' | 'LISTENING' | 'SPEAKING' | 'WRITING';

export interface WritingCorrection {
  old: string;
  new: string;
  why: string;
}

export interface WritingResponse {
  text: string;
  overallScore: number;
  corrections: WritingCorrection[];
  feedback: string;
}

export interface WritingPromptData {
  id: string;
  order: number;
  task: string;
  guidance?: string | null;
  response: WritingResponse | null;
}

export interface ClassQuestion {
  id: string;
  order: number;
  question: string;
  options: string[];
  passageRef?: string | null;
  correctIndex?: number;
  explanation?: string | null;
}

export interface ClassSpeakingPrompt {
  id: string;
  order: number;
  targetPhrase: string;
  translation: string;
  ipa?: string | null;
  referenceTtsUrl?: string | null;
}

export interface ClassSectionPodcast {
  id: string;
  audioUrl: string | null;
  title: string;
}

export interface ClassSection {
  id: string;
  skill: string;
  status: string;
  attempt: number;
  score: number | null;
  passed: boolean | null;
  podcast: ClassSectionPodcast | null;
  questions: ClassQuestion[];
  prompts: ClassSpeakingPrompt[];
  writingPrompts: WritingPromptData[];
}

export interface ClassData {
  id: string;
  status: string;
  order: number;
  passThreshold: number;
  lesson: { title: string; level: string; objective: string };
  submitted: boolean;
  submission: { passed: boolean; overallScore: number } | null;
  sections: ClassSection[];
}

export interface ClassSectionResult {
  id: string;
  skill: string;
  score: number;
  passed: boolean;
}

export interface ClassSubmitResult {
  passed: boolean;
  overallScore: number;
  passedSections: number;
  totalSections: number;
  sections: ClassSectionResult[];
}

export const SKILL_LABELS: Record<string, string> = {
  GRAMMAR: 'Grammar',
  READING: 'Reading',
  LISTENING: 'Listening',
  SPEAKING: 'Speaking',
  WRITING: 'Writing',
};

export const SKILL_GLYPH: Record<string, 'gate' | 'book' | 'wave' | 'mic' | 'pen'> = {
  GRAMMAR: 'gate',
  READING: 'book',
  LISTENING: 'wave',
  SPEAKING: 'mic',
  WRITING: 'pen',
};

export function skillLabel(skill: string): string {
  return SKILL_LABELS[skill] ?? skill;
}

/** Format seconds as m:ss. */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
