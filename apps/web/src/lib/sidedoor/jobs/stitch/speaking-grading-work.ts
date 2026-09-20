import { z } from 'zod';
import { storageInputSchema } from '@/lib/sidedoor/storage/core/storage-inputs';

const scopeSchema = z.object({
  subjectId: z.string().min(1),
  generation: z.number().int().nonnegative().safe(),
});
const parentSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  courseId: z.string().min(1),
  parentId: z.string().min(1),
});
export const speakingRecordingOwnershipSchema = z.object({
  instanceId: z.string().min(1),
  scopes: z.array(scopeSchema).min(1),
  reference: z.string().min(1),
  associations: z.object({
    recordingId: z.string().min(1),
    createdAt: z.number().int().nonnegative().safe(),
    userId: z.string().min(1),
    prompt: z.object({
      promptId: z.string().min(1),
      createdAt: z.number().int().nonnegative().safe(),
      parents: z.array(parentSchema).min(1),
    }),
    parents: z.array(parentSchema).min(1),
  }),
});

export const speakingGradingPayloadSchema = z
  .object({
    recordingId: z.uuid(),
    recordingCreatedAt: z.number().int().nonnegative().safe(),
    storage: storageInputSchema,
    ownership: speakingRecordingOwnershipSchema,
  })
  .strict();

export type SpeakingGradingWorkPayload = z.infer<typeof speakingGradingPayloadSchema>;
