import { z } from 'zod';
import {
  materialFocusAnalysisStatusIdentitySchema,
  materialFocusAnalysisRetryRequestSchema,
} from './analysis';

export const materialAnalysisCancellationRequestSchema = materialFocusAnalysisRetryRequestSchema;
export const materialAnalysisCancellationBlockerSchema = z.enum([
  'EXECUTOR_ACTIVE',
  'CLEANUP_UNCONFIRMED',
  'PROVIDER_ADMITTED',
  'PROVIDER_UNKNOWN',
  'PROOF_UNAVAILABLE',
  'VERIFICATION_PENDING',
]);
export const materialAnalysisCancellationResponseSchema = materialFocusAnalysisStatusIdentitySchema
  .extend({
    cancellation: z
      .object({
        state: z.enum(['PENDING', 'CANCELLED', 'NOT_NEEDED']),
        verifiedUnits: z.number().int().nonnegative(),
        remainingUnits: z.number().int().nonnegative(),
        hasMore: z.boolean(),
        blockers: z.array(materialAnalysisCancellationBlockerSchema).max(6),
        operationId: z.uuid(),
        operatorRecoveryUrl: z.url().nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const receipt = value.cancellation;
    const continuation =
      receipt.state === 'PENDING' &&
      value.status === 'CANCELLING' &&
      receipt.remainingUnits > 0 &&
      receipt.blockers.length === 1 &&
      receipt.blockers[0] === 'VERIFICATION_PENDING';
    if (receipt.hasMore !== continuation)
      context.addIssue({
        code: 'custom',
        path: ['cancellation', 'hasMore'],
        message: 'Only bounded known-proof verification may continue automatically.',
      });
    if (receipt.state === 'PENDING' && value.status !== 'CANCELLING')
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Pending cancellation requires the durable stop fence.',
      });
    if (
      receipt.state === 'CANCELLED' &&
      (value.status !== 'CANCELLED' ||
        receipt.remainingUnits !== 0 ||
        receipt.blockers.length !== 0)
    )
      context.addIssue({
        code: 'custom',
        path: ['cancellation'],
        message: 'Cancelled work requires complete known-outcome verification.',
      });
    if (
      receipt.state === 'NOT_NEEDED' &&
      (['CANCELLING', 'CANCELLED'].includes(value.status) || receipt.blockers.length !== 0)
    )
      context.addIssue({
        code: 'custom',
        path: ['cancellation'],
        message: 'A cancellation fence cannot be reported as unnecessary.',
      });
  });
export type MaterialAnalysisCancellationRequest = z.infer<
  typeof materialAnalysisCancellationRequestSchema
>;
export type MaterialAnalysisCancellationResponse = z.infer<
  typeof materialAnalysisCancellationResponseSchema
>;
export type MaterialAnalysisCancellationBlocker = z.infer<
  typeof materialAnalysisCancellationBlockerSchema
>;
