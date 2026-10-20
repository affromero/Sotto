import { z } from 'zod';
import { playPhraseInputSchema, playRoundActionRequestSchema } from './contracts';
import { playInviteCodeSchema } from './links';
import { playRoomActionSchema, playRoomViewSchema, playPhraseViewSchema } from './rooms';
import { playPendingRequestViewSchema } from './admission';

export const playResourceIdSchema = z.string().min(1).max(100);
export const playPageQuerySchema = z.strictObject({
  beforeId: playResourceIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const playInvitationQuerySchema = z.strictObject({ code: playInviteCodeSchema });
export const playEmptyQuerySchema = z.strictObject({});
export const playActionRequestSchema = z.union([
  playRoomActionSchema,
  playRoundActionRequestSchema,
]);
export const savePlayPhraseSchema = playPhraseInputSchema.extend({ roomId: playResourceIdSchema });
export const acknowledgePlayDeliverySchema = z.strictObject({ deliveryId: playResourceIdSchema });
export const playAcknowledgedSchema = z.strictObject({ acknowledged: z.literal(true) });
export const playRoomListSchema = z.strictObject({
  rooms: z.array(playRoomViewSchema).max(50),
  nextCursor: playResourceIdSchema.nullable(),
});
export const playPhraseListSchema = z.strictObject({
  phrases: z.array(playPhraseViewSchema).max(50),
  nextCursor: playResourceIdSchema.nullable(),
});
export const playPendingRequestListSchema = z.strictObject({
  requests: z.array(playPendingRequestViewSchema).max(50),
});
