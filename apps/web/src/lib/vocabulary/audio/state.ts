import { z } from 'zod';

export const vocabularyAudioPayloadSchema = z
  .object({
    userId: z.string().min(1),
    assetId: z.uuid(),
    generation: z.number().int().positive(),
  })
  .strict();
