import { z } from 'zod';
import {
  credentialEditContextSchema,
  credentialRemovalRequestSchema,
} from 'thesidedoor-core/configuration/credential-client';

export const credentialEndpointSchema = z.enum(['ai-keys', 'byok', 'visual-cues']);
export type SottoCredentialEndpoint = z.infer<typeof credentialEndpointSchema>;
export const credentialSelectionSchema = credentialRemovalRequestSchema
  .omit({ context: true, operationId: true })
  .extend({ endpoint: credentialEndpointSchema });
export const credentialSelectionEnvelopeSchema = z
  .object({
    context: credentialEditContextSchema.omit({ scope: true }),
    selections: credentialSelectionSchema.array().max(32),
  })
  .strict();
export type CredentialSelectionEnvelope = z.infer<typeof credentialSelectionEnvelopeSchema>;
