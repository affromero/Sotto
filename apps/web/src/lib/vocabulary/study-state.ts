import { z } from 'zod';
import {
  vocabularyStudyModeSchema,
  vocabularyStudySessionSchema,
  vocabularyStudyReceiptSchema,
  vocabularySupportSchema,
  type VocabularyStudyMode,
} from '@sotto/shared';

const responseSchema = z
  .object({
    outcome: z.enum(['STUDIED', 'ANSWERED', 'REVEALED']),
    answer: z.string().max(1000),
    correct: z.boolean().nullable(),
    reviewedAt: z.iso.datetime(),
  })
  .strict()
  .refine((response) => {
    if (response.outcome === 'STUDIED') return response.correct === null && response.answer === '';
    if (response.outcome === 'REVEALED')
      return response.correct === false && response.answer === '';
    return response.correct !== null && response.answer.trim().length > 0;
  }, 'Study and assessed responses must retain their original evidence type.');

export const vocabularyStudyStateSchema = z
  .object({
    version: z.literal(1),
    normalization: z.literal('unicode-v1'),
    requestId: z.uuid(),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    mode: vocabularyStudyModeSchema,
    support: vocabularySupportSchema.nullable(),
    nativeLang: z.string().min(1),
    targetLang: z.string().min(1),
    requestedWordIds: z.array(z.string().min(1)).max(24),
    cards: z
      .array(
        z
          .object({
            id: z.uuid(),
            wordId: z.string().min(1),
            lemma: z.string().trim().min(1).max(500),
            meaning: z.string().trim().min(1).max(2000),
            acceptedMeanings: z.array(z.string().trim().min(1).max(2000)).max(20),
            listeningPresentedAt: z.iso.datetime().nullable(),
            response: responseSchema.nullable(),
          })
          .strict()
      )
      .min(1)
      .max(24),
  })
  .strict()
  .refine(
    (state) =>
      new Set(state.cards.map((card) => card.id)).size === state.cards.length &&
      new Set(state.cards.map((card) => card.wordId)).size === state.cards.length &&
      state.cards.every(
        (card) =>
          !card.response || (state.mode === 'FLASHCARDS') === (card.response.outcome === 'STUDIED')
      ),
    'Study card identities must be unique.'
  );
export type VocabularyStudyState = z.infer<typeof vocabularyStudyStateSchema>;

export class VocabularyStudyConflict extends Error {}
export class VocabularyStudyNotFound extends Error {}
export class VocabularyStudyUnavailable extends Error {}

export function assertVocabularyStudyOwner(
  state: VocabularyStudyState,
  session: { id: string; courseId: string; kind: string },
  userId: string
) {
  if (
    session.kind !== 'VOCAB' ||
    state.requestId !== session.id ||
    state.courseId !== session.courseId ||
    state.userId !== userId
  )
    throw new VocabularyStudyNotFound('Vocabulary study not found.');
}

export function recommendedVocabularyMode(
  support: z.infer<typeof vocabularySupportSchema> | null
): VocabularyStudyMode {
  if (support === 'WORD_RECALL') return 'WORD_RECALL';
  if (support === 'LISTENING_RECOGNITION') return 'LISTENING_RECALL';
  return 'MEANING_RECALL';
}

/** Meaning aliases are explicit dictionary data. Punctuation never invents additional answers. */
export function vocabularyAnswerMatches(
  card: Pick<VocabularyStudyState['cards'][number], 'lemma' | 'meaning' | 'acceptedMeanings'>,
  mode: Exclude<VocabularyStudyMode, 'FLASHCARDS'>,
  answer: string,
  nativeLang: string
): boolean {
  const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (mode === 'WORD_RECALL') return normalize(answer) === normalize(card.lemma);
  const folded = normalize(answer).toLocaleLowerCase(nativeLang);
  return [card.meaning, ...card.acceptedMeanings].some(
    (meaning) => normalize(meaning).toLocaleLowerCase(nativeLang) === folded
  );
}

export function publicVocabularyStudy(
  state: VocabularyStudyState,
  session: {
    id: string;
    progressRevision: number;
    writingDrafts: unknown;
    submissionResult: unknown;
  }
) {
  const drafts = z.record(z.string(), z.string()).safeParse(session.writingDrafts);
  const receipt = vocabularyStudyReceiptSchema.nullable().parse(session.submissionResult);
  return vocabularyStudySessionSchema.parse({
    status: 'ready_vocabulary',
    kind: 'VOCAB',
    sessionId: session.id,
    courseId: state.courseId,
    mode: state.mode,
    nativeLang: state.nativeLang,
    targetLang: state.targetLang,
    progressRevision: session.progressRevision,
    writingDrafts: drafts.success ? drafts.data : {},
    cards: state.cards.map((card) => ({
      id: card.id,
      prompt:
        state.mode === 'LISTENING_RECALL'
          ? 'Listen, then write its meaning.'
          : state.mode === 'WORD_RECALL'
            ? card.meaning
            : card.lemma,
      feedback: card.response && {
        ...card.response,
        lemma: card.lemma,
        meaning: card.meaning,
        acceptedMeanings: card.acceptedMeanings,
      },
    })),
    receipt,
  });
}
