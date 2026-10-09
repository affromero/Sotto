import { z } from 'zod';

export const writingAuthoringProofSchema = z.object({
  modelAnswer: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Complete task solution preserving all supplied facts, actor, time, place, tense and length constraints.'
    ),
  correctionReason: z.string().trim().min(1).nullable(),
});

export const writingIdeasSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .describe(
        'Copy a short exact proper prefix from modelAnswer after solving the complete task; punctuation must match exactly; no ellipsis. Use progressively longer prefixes for additional hints.'
      )
  )
  .max(3)
  .nullable();

export const writingStarterSchema = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .describe(
    'For completion only, the short fixed beginning the learner must continue exactly; sourceText supplies facts without a separately authored copy of this starter. Null for other task types. No ellipsis.'
  );

function requireProperPrefix(prefix: string, answer: string) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  if (
    !answer.startsWith(prefix) ||
    answer.length <= prefix.length ||
    !Array.from(segmenter.segment(answer)).some((part) => part.index === prefix.length)
  )
    throw new Error('Writing beginning must be a complete grapheme prefix of its answer.');
}

export function parseWritingStarter(
  value: unknown,
  taskType: string,
  modelAnswer: string
): string | null {
  const starter = writingStarterSchema.parse(value);
  if (taskType !== 'completion') {
    if (starter !== null) throw new Error('Only writing completion tasks may supply a starter.');
    return null;
  }
  if (starter === null || /(?:…|\.{3})$/u.test(starter))
    throw new Error('Writing completion requires a fixed starter without an ellipsis.');
  requireProperPrefix(starter, modelAnswer);
  return starter;
}

export function parseWritingIdeas(value: unknown, modelAnswer: string): string[] {
  const openings = writingIdeasSchema.parse(value ?? null) ?? [];
  if (openings.some((opening) => /(?:…|\.{3})$/u.test(opening)))
    throw new Error('Writing openings must omit the display ellipsis.');
  for (const opening of openings) requireProperPrefix(opening, modelAnswer);
  return openings.map((opening) => `${opening} …`);
}

export interface WritingCorrectionDelta {
  original: string;
  replacement: string;
  reason: string;
}

/** Derive the author's proposed edit without asking the model to count offsets. */
export function parseWritingAuthoringProof(
  item: unknown,
  taskType: string,
  sourceText: string
): { modelAnswer: string; correctionDelta: WritingCorrectionDelta | null } {
  const proof = writingAuthoringProofSchema.parse(item);
  if (taskType !== 'correction') {
    if (proof.correctionReason !== null) throw new Error('Unexpected writing correction reason.');
    return { modelAnswer: proof.modelAnswer, correctionDelta: null };
  }
  if (proof.correctionReason === null) throw new Error('Missing writing correction reason.');
  const source = sourceText.trim();
  const comparable = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (comparable(source) === comparable(proof.modelAnswer))
    throw new Error('Writing correction must propose a meaningful edit.');

  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const sourceParts = Array.from(segmenter.segment(source), (part) => part.segment);
  const answerParts = Array.from(segmenter.segment(proof.modelAnswer), (part) => part.segment);
  let start = 0;
  while (start < sourceParts.length && sourceParts[start] === answerParts[start]) start++;
  let sourceEnd = sourceParts.length;
  let answerEnd = answerParts.length;
  while (
    sourceEnd > start &&
    answerEnd > start &&
    sourceParts[sourceEnd - 1] === answerParts[answerEnd - 1]
  ) {
    sourceEnd--;
    answerEnd--;
  }
  return {
    modelAnswer: proof.modelAnswer,
    correctionDelta: {
      original: sourceParts.slice(start, sourceEnd).join(''),
      replacement: answerParts.slice(start, answerEnd).join(''),
      reason: proof.correctionReason,
    },
  };
}
