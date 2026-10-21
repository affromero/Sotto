import { prismaUnfiltered } from '../prisma';
import { getDueItems } from '../knowledge-graph';
import { normalizeLearningTargetText } from '../learning-targets';
import { formatNotesForPrompt, getEditableCourseNote } from '../course-notes';
import { readCourseMaterialContext } from './context';
import { extractSourceVocabulary, type SourceVocabularyWord } from '../learning/reading-vocabulary';
import { buildReadingVocabularyWordTable } from '../learning/reading/vocabulary-protocol';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import {
  resolveStorageInput,
  validateStorageInputs,
} from '../sidedoor/storage/core/storage-inputs';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';

/** Match literal lexical units on word boundaries; inflections require canonical author/reviewer proof. */
function literalSourceForm(lemma: string, fragments: readonly string[], targetLang: string) {
  const expected = buildReadingVocabularyWordTable(lemma, targetLang).map((word) =>
    normalizeLearningTargetText(word.surface)
  );
  for (const fragment of fragments) {
    if (!/[\p{L}\p{N}]/u.test(fragment)) continue;
    const words = buildReadingVocabularyWordTable(fragment, targetLang);
    for (let index = 0; index + expected.length <= words.length; index++)
      if (
        expected.every(
          (word, offset) => normalizeLearningTargetText(words[index + offset]!.surface) === word
        )
      )
        return fragment.slice(words[index]!.start, words[index + expected.length - 1]!.end);
  }
  return undefined;
}

/** Read source-backed candidates without writing exposure, mastery or review history. */
export async function getCourseVocabularyTargets(p: {
  courseId: string;
  userId: string;
  execution: SottoProviderExecution;
  nativeLang: string;
  targetLang: string;
  level: string;
  seed: string;
}): Promise<{
  imported: boolean;
  vocab: Array<{ lemma: string; gloss: string; pos?: string }>;
  context: string;
}> {
  const captured = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await p.execution.authorize(database);
      if (actor.userId !== p.userId || p.execution.userId !== p.userId)
        throw new Error('Course source requires its original learner.');
      const course = await database.course.findFirst({
        where: {
          id: p.courseId,
          userId: actor.userId,
          nativeLang: p.nativeLang,
          targetLang: p.targetLang,
        },
        select: { id: true },
      });
      if (!course) throw new Error('Course source is unavailable for this learner.');
      const context = await readCourseMaterialContext(
        database,
        p.courseId,
        p.userId,
        p.seed,
        await getEditableCourseNote(p.courseId, database)
      );
      const storage = [];
      for (const material of context.materials)
        storage.push(
          (
            await resolveStorageInput(database, {
              consumer: `material:${material.id}:original`,
              reference: material.originalUrl,
            })
          ).input
        );
      const memory = context.materials.length
        ? await database.learnerVocab.findMany({
            where: {
              courseId: p.courseId,
              OR: [{ mastery: { lt: 0.5 } }, { reps: 0, lastReviewed: null }],
            },
            orderBy: [{ dueAt: 'asc' }, { mastery: 'asc' }],
            take: 64,
          })
        : [];
      return { ...context, storage, memory };
    },
    { signal: p.execution.signal }
  );
  formatNotesForPrompt(captured.text);
  // Image-only originals guide teaching through document input. Only actual text
  // can supply the literal word spans required by lexical provenance.
  if (!captured.materials.some((material) => material.length > 0))
    return { imported: false, vocab: [], context: captured.text };

  const sourceFragments = captured.fragments
    .filter((fragment) => fragment.documentId !== 'editable-course-note')
    .flatMap((fragment) => {
      const text =
        fragment.start === 0
          ? fragment.text.replace(/^Uploaded course note: [^\n]*\n/u, '')
          : fragment.text;
      if (!/[\p{L}\p{N}]/u.test(text)) return [];
      const words = buildReadingVocabularyWordTable(text, p.targetLang);
      const length = captured.materials.find(
        (material) => material.id === fragment.documentId
      )!.length;
      const start = fragment.start > 0 ? words[0]!.end : 0;
      const end = fragment.end < length ? words.at(-1)!.start : text.length;
      return end > start ? [text.slice(start, end)] : [];
    })
    .filter((fragment) => /[\p{L}\p{N}]/u.test(fragment));
  if (!sourceFragments.length) return { imported: false, vocab: [], context: captured.text };
  const due = await getDueItems(p.courseId);
  const rankedMemory = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await p.execution.authorize(database);
      if (actor.userId !== p.userId)
        throw new Error('Course source requires its original learner.');
      return database.learnerVocab.findMany({
        where: { courseId: p.courseId, id: { in: due.vocab.map((word) => word.id) } },
      });
    },
    { signal: p.execution.signal }
  );
  const byId = new Map(rankedMemory.map((word) => [word.id, word]));
  const observed = due.vocab.flatMap((word) => {
    const stored = byId.get(word.id);
    return stored && (stored.reps > 0 || stored.lastReviewed !== null) ? [stored] : [];
  });
  const unseen = captured.memory.filter((word) => word.reps === 0 && word.lastReviewed === null);
  const retained = [...observed.slice(0, 4), ...unseen]
    .flatMap((word) => {
      const sourceForm = literalSourceForm(word.lemma, sourceFragments, p.targetLang);
      return sourceForm && word.translation.trim() && word.partOfSpeech?.trim()
        ? [
            {
              lemma: word.lemma,
              gloss: word.translation,
              pos: word.partOfSpeech,
              sourceForm,
              questionIndices: [],
            },
          ]
        : [];
    })
    .slice(0, 12);
  const request = { ...p, text: captured.text };
  const needsNewWords =
    retained.length < 8 ||
    retained.filter((word) => unseen.some((saved) => saved.lemma === word.lemma)).length < 4;
  const reviewed = retained.length
    ? await extractSourceVocabulary({ ...request, sourceFragments, retainedWords: retained })
    : [];
  const authored = needsNewWords
    ? await extractSourceVocabulary({
        ...request,
        sourceFragments,
        preferredLemmas: observed.map((word) => word.lemma),
      })
    : [];
  const candidates = new Map<string, SourceVocabularyWord>();
  for (const word of [...reviewed, ...authored])
    if (!candidates.has(word.lemma)) candidates.set(word.lemma, word);
  await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      const actor = await p.execution.authorize(database);
      if (
        actor.userId !== p.userId ||
        !(await database.course.findFirst({ where: { id: p.courseId, userId: p.userId } }))
      )
        throw new Error('Course source changed during vocabulary extraction.');
      for (const material of captured.materials)
        if (
          !(await database.courseMaterial.findFirst({
            where: {
              id: material.id,
              userId: p.userId,
              courseId: p.courseId,
              originalUrl: material.originalUrl,
            },
            select: { id: true },
          }))
        )
          throw new Error('An imported course source changed during vocabulary extraction.');
      await validateStorageInputs(database, captured.storage);
    },
    { signal: p.execution.signal }
  );
  return {
    imported: true,
    context: captured.text,
    vocab: [...candidates.values()]
      .slice(0, 12)
      .map(({ lemma, gloss, pos }) => ({ lemma, gloss, pos })),
  };
}
