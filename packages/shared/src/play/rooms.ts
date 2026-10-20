import { z } from 'zod';
import {
  playRoundViewSchema,
  playSeatSchema,
  playSessionKindSchema,
  playSettingsSchema,
  playQuestionStyleSchema,
  playThemeSchema,
  playPhraseInputSchema,
  playLanguageSchema,
} from './contracts';
import { playInviteCodeSchema } from './links';

const id = z.string().min(1).max(100);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime();

export const playRoomStatusSchema = z.enum([
  'WAITING',
  'PLAYING',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
]);
export const playMemberSchema = z.strictObject({
  id,
  name: z.string().min(1).max(100),
  settings: playSettingsSchema,
});
export const createPlayRoomSchema = z.strictObject({
  actionId: z.uuid(),
  kind: playSessionKindSchema,
  theme: playThemeSchema,
  questionStyle: playQuestionStyleSchema.optional(),
  settings: playSettingsSchema,
});
export const playRoomActionSchema = z.strictObject({
  actionId: z.uuid(),
  expectedRevision: revision,
  type: z.enum(['START', 'NEXT_ROUND', 'REMATCH', 'LEAVE', 'CANCEL']),
});
export const playStoredRoundViewSchema = z.discriminatedUnion('mode', [
  playRoundViewSchema.options[0].extend({ id }),
  playRoundViewSchema.options[1].extend({ id }),
  playRoundViewSchema.options[2].extend({ id }),
]);
export const playRoomViewSchema = z.strictObject({
  id,
  status: playRoomStatusSchema,
  revision,
  rematchRoomId: id.nullable(),
  kind: playSessionKindSchema,
  theme: playThemeSchema,
  questionStyle: playQuestionStyleSchema,
  ownSeat: playSeatSchema,
  host: playMemberSchema,
  guest: playMemberSchema.nullable(),
  hostWaiting: z.boolean(),
  allowedActions: z.array(playRoomActionSchema.shape.type).max(5),
  round: playStoredRoundViewSchema.nullable(),
  completedRounds: z.array(playStoredRoundViewSchema).max(6),
  points: z.number().int().min(0).max(12),
  serverTime: instant,
});

export const requestPlayJoinSchema = z.strictObject({
  requestId: z.uuid(),
  code: playInviteCodeSchema,
  client: z.enum(['BROWSER', 'NATIVE']),
  deviceName: z.string().trim().min(1).max(80),
  candidate: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('EXISTING'),
      expectedProfileId: id,
      settings: playSettingsSchema,
    }),
    z.strictObject({
      kind: z.literal('NEW'),
      name: z.string().trim().min(1).max(80),
      settings: playSettingsSchema,
      consentToProfile: z.literal(true),
    }),
  ]),
});
export const approvePlayJoinSchema = z.strictObject({
  actionId: z.uuid(),
  type: z.enum(['APPROVE_PROFILE', 'ACCEPT', 'DECLINE']),
  expectedRevision: revision,
});
export const playJoinStatusSchema = z.enum([
  'WAITING_FOR_OWNER',
  'WAITING_FOR_HOST',
  'HOST_UNAVAILABLE',
  'ACCEPTED',
  'CLAIMED',
  'DECLINED',
  'EXPIRED',
  'REVOKED',
]);
export const playJoinStatusViewSchema = z.strictObject({
  requestId: id,
  status: playJoinStatusSchema,
  expiresAt: instant,
  serverTime: instant,
});
export const playCredentialDeliverySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('BROWSER'),
    deliveryId: id,
    roomId: id,
    profile: playMemberSchema,
    expiresAt: instant,
  }),
  z.strictObject({
    kind: z.literal('NATIVE'),
    deliveryId: id,
    roomId: id,
    profile: playMemberSchema,
    token: z.string().min(20).max(512),
    expiresAt: instant,
  }),
]);

export const playDeliverySchema = z.discriminatedUnion('kind', [
  ...playCredentialDeliverySchema.options,
  z.strictObject({ kind: z.literal('EXISTING'), roomId: id, profile: playMemberSchema }),
]);

export type PlayRoomView = z.infer<typeof playRoomViewSchema>;
export type PlayJoinStatusView = z.infer<typeof playJoinStatusViewSchema>;
export type PlayDelivery = z.infer<typeof playDeliverySchema>;

export const playPhraseViewSchema = playPhraseInputSchema.extend({
  id,
  roomId: id,
  targetLang: playLanguageSchema,
  createdAt: instant,
});
export type PlayPhraseView = z.infer<typeof playPhraseViewSchema>;
