import { z } from 'zod';
import { cleanTextForTts } from '../../../tts-text-cleaner';

export interface NormalizedListeningTurn {
  turnIndex: number;
  speaker: string;
  text: string;
}

export const normalizedListeningTurnSchema = z
  .object({
    turnIndex: z.number().int().positive(),
    speaker: z
      .string()
      .min(1)
      .refine((speaker) => !!speaker.trim() && !/[\r\n]/.test(speaker)),
    text: z.string(),
  })
  .strict();

const normalizedTurnsSchema = z.array(normalizedListeningTurnSchema).min(1);

/** Validate the supplied spoken table without cleaning or interpreting speaker labels again. */
export function validateNormalizedListeningTurns(
  turns: unknown,
  passageText: string
): NormalizedListeningTurn[] {
  const parsed = normalizedTurnsSchema.parse(turns);
  if (
    parsed.some((turn, index) => turn.turnIndex !== index + 1) ||
    parsed.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') !== passageText
  )
    throw new Error('Listening turns must reproduce the exact reviewed passage.');
  return parsed;
}

/** Normalize original script turns once for both the quiz transcript and teaching review. */
export function normalizeListeningTurns(
  turns: readonly { speaker: string; text: string }[]
): NormalizedListeningTurn[] {
  return turns.map((turn, index) => ({
    turnIndex: index + 1,
    speaker: turn.speaker,
    text: cleanTextForTts(turn.text),
  }));
}

const sourceSchema = z
  .array(z.object({ passageText: z.string().min(1) }).passthrough())
  .min(1)
  .max(4);

/** Keep one passage audit and independently addressed questions in one review batch. */
export function buildListeningAudit(
  items: readonly unknown[],
  listeningTurns?: readonly NormalizedListeningTurn[]
) {
  const original = sourceSchema.parse(items);
  const passageText = original[0].passageText;
  if (!passageText.trim() || original.some((item) => item.passageText !== passageText))
    throw new Error('Listening review requires one exact shared passage.');
  return {
    ...(listeningTurns !== undefined
      ? { turns: validateNormalizedListeningTurns(listeningTurns, passageText) }
      : {}),
    addresses: [
      { kind: 'passage' as const },
      ...original.map((_, index) => ({ kind: 'question' as const, index })),
    ],
    items: [
      { passageText },
      ...original.map((question) => {
        const fields: Record<string, unknown> = { ...question };
        delete fields.passageText;
        return fields;
      }),
    ],
  };
}
