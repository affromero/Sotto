import { z } from 'zod';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';

export const assessmentSpeakingPrelaunchReceiptSchema = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    recordingId: z.uuid(),
    assessmentId: z.string().min(1),
    classId: z.string().min(1),
    courseId: z.string().min(1),
    userId: z.string().min(1),
    deliveryAttempts: z.number().int().positive().safe(),
    processedAt: z.number().int().positive().safe(),
    failedAt: z.number().int().positive().safe(),
  })
  .strict()
  .refine((receipt) => receipt.processedAt <= receipt.failedAt);

export function assessmentSpeakingPrelaunchReceiptId(operationId: string) {
  return `${SIDEDOOR_STATE_ID}:assessment-speaking-prelaunch:${z.uuid().parse(operationId)}`;
}
