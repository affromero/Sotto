import { generateSectionQuestions } from '../class-generation';
import type { VocabularyTarget } from '../learning/vocabulary/selection';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import type { PracticeMcItem } from './types';

/** Generate only the word selection captured before practice admission. */
export async function buildVocabItems(
  course: {
    id: string;
    userId: string;
    currentLevel: string;
    nativeLang: string;
    targetLang: string;
  },
  words: readonly VocabularyTarget[],
  count: number,
  idPrefix: string,
  execution: SottoProviderExecution,
  note = ''
): Promise<
  | { status: 'ready'; items: PracticeMcItem[]; lemmas: string[] }
  | { status: 'unavailable'; reason: 'not_enough_vocab' }
> {
  const review = words.slice(0, count);
  if (!review.length) return { status: 'unavailable', reason: 'not_enough_vocab' };
  const items: PracticeMcItem[] = [];
  for (let offset = 0; offset < review.length; offset += 5) {
    const batch = review.slice(offset, offset + 5);
    const questions = await generateSectionQuestions({
      userId: course.userId,
      execution,
      skill: 'GRAMMAR',
      vocabularyReview: true,
      level: course.currentLevel,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      objective: 'Choose words that complete meaningful sentences in context.',
      grammarPoints: [],
      targetVocab: batch,
      note,
      seed: `${course.id}-vocab-${Date.now()}-${offset}`,
    });
    for (const word of batch) {
      const question = questions.find(
        (q) =>
          q.options[q.correctIndex] === word.lemma &&
          q.question.includes('_____') &&
          q.question.replace(/_+/g, '').trim().length >= 8
      );
      if (!question)
        throw new Error(
          `Vocabulary generation produced no contextual exercise for "${word.lemma}".`
        );
      items.push({
        id: `${idPrefix}${items.length}`,
        prompt: question.question,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        vocabLemma: word.lemma,
        focusTargetId: null,
      });
    }
  }
  return { status: 'ready', items, lemmas: review.map((word) => word.lemma) };
}
