/**
 * Shared types for the class flow. Mirrors the API contract returned by
 * `GET /api/classes/[classId]` (see the route + class-service). Kept in one
 * place so ClassShell and every section module agree on shapes.
 */

import type { ReferenceData } from '@/types/reference';
import type { ReferenceType, VerificationStatus } from '@prisma/client';

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
  /** Sourced-class READING: the full CEFR-leveled passage, may contain `[N]` markers. */
  passageText?: string | null;
  correctIndex?: number;
  explanation?: string | null;
}

/**
 * A class's verified source, surfaced from the LISTENING podcast's references.
 * Narrower than {@link ReferenceData} — the class API omits `publisher`, `doi`,
 * `verificationDetails`, and a stable `id`. Use {@link classRefToReferenceData}
 * to adapt these for the shared citation/reference UI.
 */
export interface ClassReference {
  number: number;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  type: ReferenceType;
  verificationStatus: VerificationStatus;
  contentDomain: string | null;
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
  /** The class's verified sources (sourced classes); empty for curriculum classes. */
  references: ClassReference[];
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
  /** Sourced classes: the real link/paper this class was built from (null = curriculum). */
  sourceUrl: string | null;
  /** Human-readable source title for the "Built from …" attribution. */
  sourceTitle: string | null;
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

/**
 * Adapt a class's narrow {@link ClassReference} into the shared {@link ReferenceData}
 * shape consumed by the citation parser + `CitationMarker`. The class API doesn't
 * carry `publisher`/`doi`/`verificationDetails`/a stable `id`, so those are synthesized
 * (id derived from the reference number, the rest null).
 */
export function classRefToReferenceData(ref: ClassReference): ReferenceData {
  return {
    id: `class-ref-${ref.number}`,
    number: ref.number,
    title: ref.title,
    authors: ref.authors,
    year: ref.year,
    url: ref.url,
    type: ref.type,
    publisher: null,
    doi: null,
    verificationStatus: ref.verificationStatus,
    verificationDetails: null,
    contentDomain: ref.contentDomain,
  };
}

export type VerificationTone = 'verified' | 'checking' | 'unverified';

/**
 * Map a reference's verification status onto a display tone:
 * VERIFIED / REPLACED → a confirmed source (success check);
 * PENDING → still checking; FAILED / REMOVED → a muted "unverified" note.
 */
export function verificationTone(status: VerificationStatus): VerificationTone {
  if (status === 'VERIFIED' || status === 'REPLACED') return 'verified';
  if (status === 'PENDING') return 'checking';
  return 'unverified';
}

export const VERIFICATION_LABEL: Record<VerificationTone, string> = {
  verified: 'Verified',
  checking: 'Checking',
  unverified: 'Unverified',
};

const DOMAIN_LABELS: Record<string, string> = {
  ACADEMIC: 'Academic',
  NEWS: 'News',
  GOVERNMENT: 'Government',
  EDUCATIONAL: 'Educational',
  GENERAL: 'General',
};

/** Human label for a reference's content domain, or null when unknown/absent. */
export function domainLabel(domain: string | null): string | null {
  if (!domain) return null;
  return DOMAIN_LABELS[domain] ?? domain;
}
