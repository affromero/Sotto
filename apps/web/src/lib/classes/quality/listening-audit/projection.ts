import { z } from 'zod';

const sourceSchema = z
  .array(z.object({ passageText: z.string().min(1) }).passthrough())
  .min(1)
  .max(4);

/** Keep one passage audit and independently addressed questions in one review batch. */
export function buildListeningAudit(items: readonly unknown[]) {
  const original = sourceSchema.parse(items);
  const passageText = original[0].passageText;
  if (!passageText.trim() || original.some((item) => item.passageText !== passageText))
    throw new Error('Listening review requires one exact shared passage.');
  return {
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
