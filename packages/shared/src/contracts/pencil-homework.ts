import { z } from 'zod';

export const pencilHomeworkRequestSchema = z
  .object({
    requestId: z.uuid(),
    attempt: z.number().int().positive(),
    taskKind: z.enum(['QUESTION', 'WRITING']),
    taskId: z.string().min(1).max(200),
    image: z
      .string()
      .max(2_100_000)
      .regex(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();

export const pencilHomeworkProposalSchema = z
  .object({
    selectedIndex: z.number().int().nonnegative().nullable(),
    text: z.string().max(4000).nullable(),
    observations: z.array(z.string().trim().min(1).max(500)).max(12),
    uncertainties: z.array(z.string().trim().min(1).max(500)).max(12),
  })
  .strict();

export const pencilHomeworkResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('PENDING'), operationId: z.uuid() }).strict(),
  z
    .object({
      status: z.literal('READY'),
      operationId: z.uuid(),
      proposal: pencilHomeworkProposalSchema,
    })
    .strict(),
  z
    .object({ status: z.literal('FAILED'), operationId: z.uuid(), error: z.string().min(1) })
    .strict(),
]);

export type PencilHomeworkRequest = z.infer<typeof pencilHomeworkRequestSchema>;
export type PencilHomeworkProposal = z.infer<typeof pencilHomeworkProposalSchema>;
