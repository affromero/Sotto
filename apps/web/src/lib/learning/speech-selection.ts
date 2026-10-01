import { z } from 'zod';

export const sttSelectionSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    baseUrl: z.string().nullable(),
    credentialFingerprint: z.string().nullable(),
  })
  .strict();

export type SttSelection = z.infer<typeof sttSelectionSchema>;
