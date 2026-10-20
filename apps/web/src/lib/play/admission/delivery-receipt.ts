import { z } from 'zod';
import { tokenHash } from 'thesidedoor-core/access';
import {
  CredentialCodec,
  credentialStateSchema,
  initialCredentialState,
} from 'thesidedoor-core/configuration';
import { playCredentialDeliverySchema } from '@sotto/shared';
import { deriveOwnedCredentialKey } from '@/lib/credentials/byok-crypto';
import { PlayRuleError } from '../errors';
import { playFingerprint } from '../storage/fingerprint';

const id = z.string().min(1).max(100);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const playDeliveryBindingSchema = z.strictObject({
  version: z.literal(1),
  instanceId: z.uuid(),
  roomId: id,
  requestId: id,
  profileId: id,
  deliveryId: id,
  claimantProofHash: digest,
  enrollmentGeneration: z.number().int().positive(),
});
export type PlayDeliveryBinding = z.infer<typeof playDeliveryBindingSchema>;

const deliveryEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  response: playCredentialDeliverySchema,
  browserSessionToken: z.string().min(20).max(512).nullable(),
  credentialId: digest,
});
export type PlayDeliveryEnvelope = z.infer<typeof deliveryEnvelopeSchema>;

const MAX_ENVELOPE_CHARS = 4_096;
const MAX_STATE_CHARS = 12_000;
const descriptor = {
  id: 'play-delivery',
  label: 'Play delivery',
  transport: 'api' as const,
  capabilities: [],
  models: [],
  fields: [
    { id: 'envelope', label: 'Delivery', kind: 'string' as const, required: true, secret: true },
  ],
};

function receiptCodec(binding: PlayDeliveryBinding) {
  return new CredentialCodec({
    namespace: `play-delivery:v1:${playFingerprint(binding)}`,
    encryptionKey: deriveOwnedCredentialKey,
    descriptors: () => [descriptor],
  });
}

function validateEnvelope(binding: PlayDeliveryBinding, input: unknown) {
  const envelope = deliveryEnvelopeSchema.parse(input);
  const response = envelope.response;
  const token = response.kind === 'BROWSER' ? envelope.browserSessionToken : response.token;
  if (
    response.roomId !== binding.roomId ||
    response.profile.id !== binding.profileId ||
    response.deliveryId !== binding.deliveryId ||
    !token ||
    (response.kind === 'NATIVE' && envelope.browserSessionToken !== null) ||
    tokenHash(token) !== envelope.credentialId
  )
    throw new PlayRuleError('invalid', 'Delivery identity is inconsistent.');
  if (JSON.stringify(envelope).length > MAX_ENVELOPE_CHARS)
    throw new PlayRuleError('invalid', 'Delivery exceeds the supported size.');
  return envelope;
}

/** Authority, TTL and ACK checks belong to the caller's admission transaction. */
export function sealPlayDelivery(bindingInput: PlayDeliveryBinding, input: PlayDeliveryEnvelope) {
  const binding = playDeliveryBindingSchema.parse(bindingInput);
  const envelope = validateEnvelope(binding, input);
  const state = initialCredentialState();
  receiptCodec(binding).replaceState(state, descriptor.id, { envelope: JSON.stringify(envelope) });
  return state;
}

/** Use only the public codec API. A changed key or binding fails explicitly. */
export function openPlayDelivery(
  bindingInput: PlayDeliveryBinding,
  input: unknown
): PlayDeliveryEnvelope {
  const binding = playDeliveryBindingSchema.parse(bindingInput);
  const state = credentialStateSchema.parse(input);
  if (
    JSON.stringify(state).length > MAX_STATE_CHARS ||
    state.providers.length !== 1 ||
    state.providers[0]?.provider !== descriptor.id
  )
    throw new PlayRuleError('invalid', 'Delivery receipt is invalid.');
  const value = receiptCodec(binding).resolveState(state, descriptor.id).envelope;
  if (typeof value !== 'string' || value.length > MAX_ENVELOPE_CHARS)
    throw new PlayRuleError('invalid', 'Delivery receipt is invalid.');
  return validateEnvelope(binding, JSON.parse(value));
}
