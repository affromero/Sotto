// The render contract for a class workbook, consumed by the web
// print-optimized iPad/PDF page. The learner variant omits answer-key fields;
// the answer-key variant keeps them.
import type { SkillType } from './enums';

export interface ClassDocumentQuestion {
  id: string;
  order: number;
  question: string;
  options: string[];
  passageRef?: string | null;
  passageText?: string | null;
  // Answer-key-only — present only when the document is built as an answer key.
  correctIndex?: number;
  explanation?: string;
}

export interface ClassDocumentPrompt {
  id: string;
  order: number;
  targetPhrase: string;
  translation: string;
  ipa?: string | null;
}

export interface ClassDocumentWritingPrompt {
  id: string;
  order: number;
  task: string;
  guidance?: string | null;
}

export interface ClassDocumentSection {
  id: string;
  skill: SkillType;
  title: string;
  instructions: string;
  questions: ClassDocumentQuestion[];
  prompts: ClassDocumentPrompt[];
  writingPrompts: ClassDocumentWritingPrompt[];
  // Deep link + QR that take the printed sheet back into the app (listening
  // playback / speaking recording / writing grading). Null when there is no
  // in-app counterpart.
  appLink: string | null;
  qrDataUrl: string | null;
}

export interface ClassDocument {
  classId: string;
  title: string;
  level: string;
  objective: string;
  nativeLang: string;
  targetLang: string;
  isAnswerKey: boolean;
  sections: ClassDocumentSection[];
}
