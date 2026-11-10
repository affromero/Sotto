import { z } from 'zod';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

export const classCleanupReceiptSchema = z
  .object({
    classId: z.string().min(1),
    classGeneration: z.number().int().nonnegative().safe(),
    userId: z.string().min(1),
    userGeneration: z.number().int().nonnegative().safe(),
    jobId: z.uuid().nullable(),
    preparation: z
      .object({ operationId: z.uuid(), attempt: z.number().int().positive() })
      .strict()
      .optional(),
    episodeJobs: z
      .array(
        z
          .object({
            episodeId: z.string().min(1),
            generation: z.number().int().nonnegative().safe(),
            jobId: z.uuid(),
          })
          .strict()
      )
      .optional(),
  })
  .strict()
  .refine((value) => value.jobId !== null || (!!value.preparation && !value.episodeJobs?.length));

export function classCleanupReceiptId(classId: string) {
  return `${SIDEDOOR_STATE_ID}:class-cleanup:${classId}`;
}
