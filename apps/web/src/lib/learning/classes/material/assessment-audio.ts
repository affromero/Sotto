import { z } from 'zod';
import { learningAudioIdentitySchema } from '../../../learning-map/evidence/media-protocol';
import { objectiveEvidenceHash } from '../../../learning-map/evidence/protocol';
import {
  storageInputSchema,
  type StorageInput,
} from '../../../sidedoor/storage/core/storage-inputs';
import { learningScriptHash } from '../../script-hash';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const assessmentSpeakingReferenceSchema = z
  .object({
    version: z.literal(1),
    assessmentId: z.string().min(1),
    promptId: z.string().min(1),
    userId: z.string().min(1),
    contentSha256: digest,
    contentBytes: z.number().int().positive(),
    reference: storageInputSchema,
    provenance: z
      .object({
        operationId: z.uuid(),
        fingerprint: digest,
        provider: z.string().min(1),
        model: z.string().min(1),
        voiceId: z.string().min(1),
        speechFingerprint: digest,
        inputDigest: digest,
        dispatches: z.number().int().min(1).max(64),
      })
      .strict()
      .optional(),
  })
  .strict();

function stableStorageIdentity(input: StorageInput) {
  return {
    consumer: input.consumer,
    assetId: input.assetId,
    backendId: input.backendId,
    binding: input.binding,
    key: input.key,
  };
}

/** The caller must also validate current owned storage attribution in the transaction. */
export function assessmentListeningAudioIdentity(
  input: unknown,
  expected: { episodeId: string; userId: string; turns: unknown }
) {
  const identity = learningAudioIdentitySchema.parse(input);
  if (
    identity.episodeId !== expected.episodeId ||
    identity.userId !== expected.userId ||
    identity.scriptSha256 !== learningScriptHash(expected.turns)
  )
    throw new Error('Assessment listening identity does not match the owned script.');
  return objectiveEvidenceHash({
    schemaVersion: identity.schemaVersion,
    episodeId: identity.episodeId,
    userId: identity.userId,
    scriptSha256: identity.scriptSha256,
    contentSha256: identity.contentSha256,
    contentBytes: identity.contentBytes,
    audioGenerationKey: identity.audioGenerationKey,
    version: identity.version,
    reference: stableStorageIdentity(identity.reference),
  });
}

/** The content digest must originate from the authorized audio writer, not the caller. */
export function assessmentSpeakingReferenceIdentity(
  input: unknown,
  expected: { assessmentId: string; promptId: string; userId: string }
) {
  const identity = assessmentSpeakingReferenceSchema.parse(input);
  if (
    identity.assessmentId !== expected.assessmentId ||
    identity.promptId !== expected.promptId ||
    identity.userId !== expected.userId ||
    identity.reference.consumer !== `speaking-prompt:${identity.promptId}:reference`
  )
    throw new Error('Assessment speaking identity does not match the owned prompt.');
  return objectiveEvidenceHash({
    version: identity.version,
    assessmentId: identity.assessmentId,
    promptId: identity.promptId,
    userId: identity.userId,
    contentSha256: identity.contentSha256,
    contentBytes: identity.contentBytes,
    reference: stableStorageIdentity(identity.reference),
    ...(identity.provenance ? { provenance: identity.provenance } : {}),
  });
}
