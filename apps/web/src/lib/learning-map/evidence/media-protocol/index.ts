import { z } from 'zod';
import { storageInputSchema } from '@/lib/sidedoor/storage/core/storage-inputs';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const learningAudioIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    episodeId: z.string().min(1),
    userId: z.string().min(1),
    scriptSha256: sha,
    contentSha256: sha,
    contentBytes: z.number().int().positive(),
    audioGenerationKey: z.string().min(1),
    version: z.number().int().positive(),
    reference: storageInputSchema,
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.reference.consumer !== `episode:${identity.episodeId}:audio`)
      context.addIssue({
        code: 'custom',
        message: 'Listening audio must retain the exact episode audio consumer.',
      });
  });
export type LearningAudioIdentity = z.infer<typeof learningAudioIdentitySchema>;
