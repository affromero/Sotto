import { z } from 'zod';
import {
  classAssessmentSubmitSchema,
  classAssessmentWritingStatusSchema,
  classReceiptSchema,
} from '@sotto/shared';

export const savedAssessmentWorkSchema = z
  .object({
    choices: z.record(z.string().max(256), z.number().int().min(0).max(3)),
    drafts: z.record(z.string().max(256), z.string().max(4000)),
    pending: z
      .array(
        z.object({ itemId: z.string().max(256), selectedIndex: z.number().int().min(0).max(3) })
      )
      .max(100)
      .nullable(),
    rejected: z.boolean().optional(),
  })
  .strict();

const retainedKeySchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.number().int().positive(),
  z.string().min(1).max(256),
  z.string().regex(/^[a-f0-9]{64}$/),
]);

/** Remove only work whose exact submitted choices replay to the confirmed class receipt. */
export async function clearConfirmedAssessmentWork(input: {
  classId: string;
  attempt: number;
  receipt: unknown;
  signal: AbortSignal;
}) {
  const expected = classReceiptSchema.safeParse(input.receipt);
  if (!expected.success || expected.data.source !== 'ASSESSMENT') return;
  const getOwner = async () => {
    const response = await fetch('/api/v1/users/me', { signal: input.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Profile unavailable');
    return z.object({ id: z.string().min(1).max(256) }).parse(await response.json()).id;
  };
  try {
    const owner = await getOwner();
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith('assessment:')) keys.push(key);
    }
    for (const key of keys) {
      input.signal.throwIfAborted();
      let binding: z.infer<typeof retainedKeySchema>;
      let raw: string | null;
      try {
        binding = retainedKeySchema.parse(JSON.parse(key.slice('assessment:'.length)));
        raw = sessionStorage.getItem(key);
      } catch {
        continue;
      }
      if (
        binding[0] !== owner ||
        binding[1] !== input.classId ||
        binding[2] !== input.attempt ||
        !raw
      )
        continue;
      let saved: ReturnType<typeof savedAssessmentWorkSchema.safeParse>;
      try {
        saved = savedAssessmentWorkSchema.safeParse(JSON.parse(raw));
      } catch {
        continue;
      }
      if (!saved.success || !saved.data.pending) continue;
      const body = classAssessmentSubmitSchema.safeParse({ choices: saved.data.pending });
      if (!body.success) continue;
      const selected = Object.fromEntries(
        body.data.choices.map(({ itemId, selectedIndex }) => [itemId, selectedIndex])
      );
      if (
        Object.keys(selected).length !== Object.keys(saved.data.choices).length ||
        Object.entries(selected).some(([itemId, index]) => saved.data.choices[itemId] !== index)
      )
        continue;
      let draftsMatch = true;
      for (const [promptId, text] of Object.entries(saved.data.drafts)) {
        if (!text) continue;
        const response = await fetch(
          `/api/v1/classes/${encodeURIComponent(input.classId)}/assessment/${encodeURIComponent(binding[3])}/writing/${encodeURIComponent(promptId)}`,
          {
            signal: input.signal,
            cache: 'no-store',
          }
        );
        if (!response.ok) {
          draftsMatch = false;
          break;
        }
        const writing = classAssessmentWritingStatusSchema.safeParse(await response.json());
        if (!writing.success || writing.data.status !== 'COMPLETED' || writing.data.text !== text) {
          draftsMatch = false;
          break;
        }
      }
      if (!draftsMatch) continue;
      const response = await fetch(
        `/api/v1/classes/${encodeURIComponent(input.classId)}/assessment/${encodeURIComponent(binding[3])}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: input.signal,
          body: JSON.stringify(body.data),
        }
      );
      if (!response.ok) continue;
      const actual = classReceiptSchema.safeParse(await response.json());
      if (!actual.success || JSON.stringify(actual.data) !== JSON.stringify(expected.data))
        continue;
      if ((await getOwner()) !== owner || input.signal.aborted) return;
      if (sessionStorage.getItem(key) === raw) sessionStorage.removeItem(key);
    }
  } catch {
    // Retain work when its identity or submission cannot be verified.
  }
}
