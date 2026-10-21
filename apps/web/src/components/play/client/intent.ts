import { z } from 'zod';
import {
  playClaimantProofSchema,
  playInviteEnvelopeSchema,
  requestPlayJoinSchema,
} from '@sotto/shared';

const INTENT_KEY = 'sotto:play-invitation:v1';
const PENDING_KEY = 'sotto:play-admission:v1';
const RETAINED_KEY = 'sotto:play-admission-recoveries:v1';
const AGE_MS = 24 * 60 * 60 * 1000;
const savedIntentSchema = z.strictObject({
  invitation: playInviteEnvelopeSchema,
  savedAt: z.number().int().nonnegative(),
});
const pendingSchema = z.strictObject({
  version: z.literal(1),
  serverUrl: playInviteEnvelopeSchema.shape.serverUrl,
  command: requestPlayJoinSchema.extend({ acceptedConductVersion: z.literal(1).optional() }),
  conductVersion: z.literal(1).optional(),
  proof: playClaimantProofSchema,
  originalProfileId: z.string().min(1).max(100).nullable(),
  savedAt: z.number().int().nonnegative(),
  received: z
    .strictObject({
      deliveryId: z.string().min(1).max(100),
      roomId: z.string().min(1).max(100),
      profileId: z.string().min(1).max(100),
    })
    .nullable(),
});
export type PendingPlayAdmission = z.infer<typeof pendingSchema>;

function readSaved<Schema extends z.ZodType>(
  storage: Storage,
  key: string,
  schema: Schema
): z.infer<Schema> | null {
  const value = storage.getItem(key);
  if (!value) return null;
  if (value.length > 8192) {
    storage.removeItem(key);
    return null;
  }
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function expired(savedAt: number) {
  return savedAt > Date.now() + 60_000 || Date.now() - savedAt > AGE_MS;
}

export function rememberPlayInvitation(invitation: unknown) {
  const value = savedIntentSchema.parse({ invitation, savedAt: Date.now() });
  localStorage.setItem(INTENT_KEY, JSON.stringify(value));
}

export function readPlayInvitationIntent() {
  const saved = readSaved(localStorage, INTENT_KEY, savedIntentSchema);
  if (!saved) return null;
  if (expired(saved.savedAt)) {
    localStorage.removeItem(INTENT_KEY);
    return null;
  }
  return saved.invitation;
}

export function clearPlayInvitationIntent() {
  localStorage.removeItem(INTENT_KEY);
}

export function savePendingPlayAdmission(pending: PendingPlayAdmission) {
  const parsed = pendingSchema.parse(pending);
  if (parsed.serverUrl !== location.origin || parsed.command.client !== 'BROWSER')
    throw new Error('Use the invitation on its own server.');
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(parsed));
}

export function readPendingPlayAdmission() {
  const pending = readSaved(sessionStorage, PENDING_KEY, pendingSchema);
  if (!pending) return null;
  if (
    expired(pending.savedAt) ||
    pending.serverUrl !== location.origin ||
    pending.command.client !== 'BROWSER'
  ) {
    sessionStorage.removeItem(PENDING_KEY);
    return null;
  }
  return pending;
}

export function clearPendingPlayAdmission() {
  sessionStorage.removeItem(PENDING_KEY);
}

export function readRetainedPlayAdmissions(): PendingPlayAdmission[] {
  const value = sessionStorage.getItem(RETAINED_KEY);
  if (!value) return [];
  if (value.length > 131_072)
    throw new Error('Saved invitation recoveries exceed the supported size. They have been kept.');
  return z.array(pendingSchema).max(16).parse(JSON.parse(value));
}

export function retainPendingPlayAdmission(pending: PendingPlayAdmission) {
  const saved = readRetainedPlayAdmissions();
  if (saved.some((item) => item.command.requestId === pending.command.requestId)) return;
  if (saved.length >= 16) throw new Error('Remove a saved recovery before keeping another.');
  const parsed = pendingSchema.parse(pending);
  if (parsed.serverUrl !== location.origin || parsed.command.client !== 'BROWSER')
    throw new Error('Keep the invitation on its original server.');
  sessionStorage.setItem(RETAINED_KEY, JSON.stringify([...saved, parsed]));
}

export function removeRetainedPlayAdmission(requestId: string) {
  sessionStorage.setItem(
    RETAINED_KEY,
    JSON.stringify(
      readRetainedPlayAdmissions().filter((item) => item.command.requestId !== requestId)
    )
  );
}
