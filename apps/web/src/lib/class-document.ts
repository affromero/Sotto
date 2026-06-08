// Builds the ClassDocument render contract from a loaded class. Both the web
// worksheet page and the iPad ClassWorksheet render this single shape. The
// learner variant strips answer-key fields (correctIndex/explanation); the
// answer-key variant keeps them so a teacher/self-hoster can print a key.
import type { ClassDocument, ClassDocumentSection } from '@sotto/shared';
import { generateQrDataUrl } from './qr';

const SKILL_META: Record<string, { title: string; instructions: string }> = {
  GRAMMAR: { title: 'Grammar', instructions: 'Choose the correct option for each item.' },
  READING: { title: 'Reading', instructions: 'Read the passage, then choose the best answer for each item.' },
  LISTENING: { title: 'Listening', instructions: 'Scan the code to play the audio, then choose the best answer.' },
  SPEAKING: { title: 'Speaking', instructions: 'Scan the code to record. Say each phrase aloud and check your pronunciation.' },
};

// Sections that have an in-app counterpart worth deep-linking from print.
const APP_LINKED_SKILLS = new Set(['LISTENING', 'SPEAKING']);

export interface BuildClassDocumentInput {
  id: string;
  nativeLang: string;
  targetLang: string;
  lesson: { title: string; level: string; objective: string };
  sections: Array<{
    id: string;
    skill: string;
    questions: Array<{
      id: string;
      order: number;
      question: string;
      options: unknown;
      passageRef: string | null;
      correctIndex: number;
      explanation: string;
    }>;
    prompts: Array<{
      id: string;
      order: number;
      targetPhrase: string;
      translation: string;
      ipa: string | null;
    }>;
  }>;
}

export interface BuildClassDocumentOptions {
  isAnswerKey: boolean;
  /** App origin used to build deep links + QR codes; omit to skip QR generation. */
  appBaseUrl?: string;
}

export async function buildClassDocument(
  cls: BuildClassDocumentInput,
  opts: BuildClassDocumentOptions,
): Promise<ClassDocument> {
  const sections: ClassDocumentSection[] = await Promise.all(
    cls.sections.map(async (s) => {
      const meta = SKILL_META[s.skill] ?? { title: s.skill, instructions: '' };
      const appLink =
        APP_LINKED_SKILLS.has(s.skill) && opts.appBaseUrl
          ? `${opts.appBaseUrl}/classes/${cls.id}?section=${s.id}`
          : null;
      const qrDataUrl = appLink ? await generateQrDataUrl(appLink) : null;

      return {
        id: s.id,
        skill: s.skill as ClassDocumentSection['skill'],
        title: meta.title,
        instructions: meta.instructions,
        questions: s.questions.map((q) => ({
          id: q.id,
          order: q.order,
          question: q.question,
          options: Array.isArray(q.options) ? (q.options as string[]) : [],
          passageRef: q.passageRef,
          ...(opts.isAnswerKey ? { correctIndex: q.correctIndex, explanation: q.explanation } : {}),
        })),
        prompts: s.prompts.map((p) => ({
          id: p.id,
          order: p.order,
          targetPhrase: p.targetPhrase,
          translation: p.translation,
          ipa: p.ipa,
        })),
        appLink,
        qrDataUrl,
      };
    }),
  );

  return {
    classId: cls.id,
    title: cls.lesson.title,
    level: cls.lesson.level,
    objective: cls.lesson.objective,
    nativeLang: cls.nativeLang,
    targetLang: cls.targetLang,
    isAnswerKey: opts.isAnswerKey,
    sections,
  };
}
