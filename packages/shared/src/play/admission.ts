import { z } from 'zod';
import { playInviteCodeSchema } from './links';
import {
  playSessionKindSchema,
  playSettingsSchema,
  playThemeSchema,
  playQuestionStyleSchema,
} from './contracts';
import { approvePlayJoinSchema, playJoinStatusSchema } from './rooms';

export const PLAY_HOST_HEARTBEAT_MS = 5_000;
export const PLAY_HOST_LEASE_MS = 20_000;
export const playClaimantProofSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const playPresenceInputSchema = z.strictObject({
  type: z.enum(['RENEW', 'RELEASE']),
  viewNonce: playClaimantProofSchema,
});
export const playPresenceViewSchema = z.strictObject({
  hostWaiting: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  serverTime: z.iso.datetime(),
});

const id = z.string().min(1).max(100);
const instant = z.iso.datetime();
/** Browser claims assert the profile observed before explicit switch consent. */
export const claimPlayEntrySchema = z.union([
  z.strictObject({ expectedProfileId: id.nullable() }),
  z.strictObject({}),
]);
export const playInvitationActionSchema = z.strictObject({
  actionId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
});
export const playInvitationViewSchema = z.strictObject({
  roomId: id,
  code: playInviteCodeSchema,
  generation: z.number().int().positive(),
  expiresAt: instant,
});
export const playInvitationPreviewSchema = z.strictObject({
  roomId: id,
  hostName: z.string().min(1).max(100),
  kind: playSessionKindSchema,
  theme: playThemeSchema,
  questionStyle: playQuestionStyleSchema,
  hostWaiting: z.boolean(),
  expiresAt: instant,
  serverTime: instant,
});
export const playPendingRequestViewSchema = z.strictObject({
  requestId: id,
  roomId: id,
  roomRevision: z.number().int().nonnegative(),
  name: z.string().min(1).max(100),
  candidateKind: z.enum(['EXISTING', 'NEW']),
  settings: playSettingsSchema,
  status: playJoinStatusSchema,
  profileId: id.nullable(),
  allowedActions: z.array(approvePlayJoinSchema.shape.type).max(3),
  expiresAt: instant,
  serverTime: instant,
});
export type PlayPendingRequestView = z.infer<typeof playPendingRequestViewSchema>;
