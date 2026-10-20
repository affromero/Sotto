import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
/** A private inherited receipt has no grant and cannot authorize another dispatch. */
export const materialAnalysisUnitReuseSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceAnalysisId: z.uuid(),
    sourceUnitId: z.uuid(),
    sourceIdentityDigest: sha,
    sourceInputDigest: sha,
    sourceStatus: z.enum(['ANALYZED', 'SUCCEEDED']),
    attemptId: z.uuid(),
    attemptFingerprint: sha,
    responseKind: z.enum(['HTTP', 'CLI']),
    responseSha256: sha,
    outputSha256: sha.nullable(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if ((receipt.sourceStatus === 'ANALYZED') !== (receipt.outputSha256 !== null))
      context.addIssue({
        code: 'custom',
        message: 'Inherited analyzed output requires its exact content receipt.',
      });
  });
