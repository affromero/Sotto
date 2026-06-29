/**
 * Shared types for the class flow. Mirrors the API contract returned by
 * `GET /api/v1/classes/[classId]` (see the route + class-service). Kept in one
 * place so ClassShell and every section module agree on shapes.
 */

import type { ReferenceData } from '@/types/reference';
import type { ReferenceType, VerificationStatus } from '@/generated/prisma/client';

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
 * A class's verified source, surfaced from the LISTENING episode's references.
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
  latestRecording?: ClassSpeakingRecording | null;
}

export interface ClassSpeakingAlignmentToken {
  op: 'match' | 'substitute' | 'delete' | 'insert';
  expected?: string;
  actual?: string;
}

export interface ClassSpeakingRecording {
  id: string;
  status: 'PENDING' | 'GRADING' | 'SCORED' | 'FAILED';
  transcript?: string | null;
  overallScore?: number | null;
  rubricScores?: {
    accuracy?: number;
    fluency?: number;
    completeness?: number;
  } | null;
  phonemeScores?: ClassSpeakingAlignmentToken[] | null;
  feedback?: string | null;
}

export interface ClassSectionEpisode {
  id: string;
  audioUrl: string | null;
  status: string;
  title: string;
  failureReason?: string | null;
  technicalError?: string | null;
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
  episode: ClassSectionEpisode | null;
  questions: ClassQuestion[];
  prompts: ClassSpeakingPrompt[];
  writingPrompts: WritingPromptData[];
}

export interface ClassIntroExample {
  target: string;
  meaning: string;
  note: string;
}

export interface ClassIntroVisuals {
  timeline: {
    title: string;
    steps: string[];
  } | null;
  contrast: {
    title: string;
    leftLabel: string;
    leftItems: string[];
    rightLabel: string;
    rightItems: string[];
  } | null;
  callouts: Array<{
    label: string;
    text: string;
    tone: 'blue' | 'teal' | 'rose' | 'amber';
  }>;
  links: Array<{
    label: string;
    url: string;
  }>;
}

export interface ClassIntroData {
  purpose: string;
  about: string;
  focus: string[];
  examples: ClassIntroExample[];
  tips: string[];
  visuals?: ClassIntroVisuals;
}

export interface ClassVocabularyItem {
  lemma: string;
  gloss: string;
  pos?: string | null;
}

export interface ClassFeedbackNote {
  id: string;
  skill: string;
  title: string;
  body: string;
  score?: number | null;
  returnHref: string;
  tone: 'good' | 'review';
}

export interface ClassData {
  id: string;
  courseId: string;
  status: string;
  order: number;
  passThreshold: number;
  /** Sourced classes: the real link/paper this class was built from (null = curriculum). */
  sourceUrl: string | null;
  /** Human-readable source title for the "Built from …" attribution. */
  sourceTitle: string | null;
  lesson: { title: string; level: string; objective: string };
  intro: ClassIntroData;
  vocabulary: ClassVocabularyItem[];
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

export const REQUIRED_CLASS_SKILLS: ClassSkill[] = [
  'GRAMMAR',
  'READING',
  'LISTENING',
  'SPEAKING',
  'WRITING',
];

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

export function classPresentationIssues(cls: ClassData): string[] {
  const issues: string[] = [];
  const sectionsBySkill = new Map(cls.sections.map((section) => [section.skill, section]));

  for (const skill of REQUIRED_CLASS_SKILLS) {
    if (!sectionsBySkill.has(skill)) {
      issues.push(`Missing ${skillLabel(skill)} section.`);
    }
  }

  const reading = sectionsBySkill.get('READING');
  if (reading && !reading.questions.some((question) => question.passageText?.trim())) {
    issues.push('Reading section has no full reading passage.');
  }

  const listening = sectionsBySkill.get('LISTENING');
  if (listening && !listening.episode) {
    issues.push('Listening section has no audio episode.');
  } else if (listening?.episode && !listening.episode.audioUrl) {
    if (listening.episode.status === 'FAILED') {
      const detail = listening.episode.failureReason ?? listening.episode.technicalError;
      issues.push(`Listening section audio failed${detail ? `: ${detail}` : '.'}`);
    } else {
      issues.push('Listening section audio is not ready yet.');
    }
  }

  const speaking = sectionsBySkill.get('SPEAKING');
  if (speaking && speaking.prompts.length === 0) {
    issues.push('Speaking section has no speaking prompts.');
  }

  const writing = sectionsBySkill.get('WRITING');
  if (writing && writing.writingPrompts.length === 0) {
    issues.push('Writing section has no writing prompts.');
  }

  return issues;
}

export function classPresentationNeedsRegeneration(cls: ClassData): boolean {
  const sectionsBySkill = new Map(cls.sections.map((section) => [section.skill, section]));

  for (const skill of REQUIRED_CLASS_SKILLS) {
    if (!sectionsBySkill.has(skill)) return true;
  }

  const reading = sectionsBySkill.get('READING');
  if (reading && !reading.questions.some((question) => question.passageText?.trim())) {
    return true;
  }

  const listening = sectionsBySkill.get('LISTENING');
  if (!listening?.episode || listening.episode.status === 'FAILED') {
    return true;
  }

  const speaking = sectionsBySkill.get('SPEAKING');
  if (speaking && speaking.prompts.length === 0) {
    return true;
  }

  const writing = sectionsBySkill.get('WRITING');
  if (writing && writing.writingPrompts.length === 0) {
    return true;
  }

  return false;
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
