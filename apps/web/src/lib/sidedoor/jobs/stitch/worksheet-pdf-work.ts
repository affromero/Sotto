import { z } from 'zod';

export const worksheetPdfPayloadSchema = z
  .object({
    classId: z.string().min(1),
    classUpdatedAt: z.number().int().nonnegative().safe(),
    appBaseUrl: z.url(),
  })
  .strict();

export type WorksheetPdfWorkPayload = z.infer<typeof worksheetPdfPayloadSchema>;
