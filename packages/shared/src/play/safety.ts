import { z } from 'zod';
import { requestPlayJoinSchema } from './rooms';
import { playPageQuerySchema } from './api';

export const PLAY_CONDUCT_VERSION = 1;
export const PLAY_CONDUCT_TITLE = 'Playing together safely';
export const PLAY_CONDUCT_PARAGRAPHS = [
  'Treat your partner with respect. Do not share harassment, threats, hate, impersonation, sexual exploitation, objectionable sexual or graphic violent material, or unlawful content.',
  'Your partner sees the language you share in the game. Games use a local text filter and work without AI processing. You can report content or a player, block a partner, and manage your own blocks.',
  'Reports send the selected visible content and your explanation to this server’s owner. The owner can respond, close a game, or restrict a profile from partner games. Your private learning remains separate.',
  'Blocking ends your active games together and prevents new games between these profiles. Unblocking does not reopen old games. Ask this server’s operator about its handling of reports, retention, and contact details.',
] as const;

const id = z.string().min(1).max(100);
const instant = z.iso.datetime();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const action = { actionId: z.uuid() };
const version = z.literal(PLAY_CONDUCT_VERSION);

/** Valid credentials retain safety/report access when sharing is unavailable. */
export const PLAY_SAFETY_HTTP_STATUS = {
  CONDUCT_REQUIRED: 409,
  SHARING_RESTRICTED: 409,
  PLAY_UNAVAILABLE: 404,
  TEXT_FILTERED: 400,
  CONTENT_CHANGED: 409,
  SAFETY_CONFLICT: 409,
} as const;
export const playSafetyErrorReasonSchema = z.enum([
  'CONDUCT_REQUIRED',
  'SHARING_RESTRICTED',
  'PLAY_UNAVAILABLE',
  'TEXT_FILTERED',
  'CONTENT_CHANGED',
  'SAFETY_CONFLICT',
]);
export const playSafetyErrorSchema = z.strictObject({
  error: z.string().min(1).max(300),
  reason: playSafetyErrorReasonSchema,
});

export const playSafetyPolicySchema = z.strictObject({
  version,
  title: z.string().min(1).max(100),
  paragraphs: z.array(z.string().min(1).max(1000)).min(1).max(8),
  operatorContactUrl: z.url().startsWith('mailto:').max(1000).nullable(),
  termsPath: z.literal('/terms'),
  privacyPath: z.literal('/privacy'),
  reviewPath: z.literal('/play/safety/review'),
});

export const playSafetyStatusSchema = z
  .strictObject({
    profileId: id,
    acceptedVersion: z.number().int().positive().nullable(),
    acceptedAt: instant.nullable(),
    sharingRestricted: z.boolean(),
    canReviewReports: z.boolean(),
    serverTime: instant,
  })
  .refine((value) => (value.acceptedVersion === null) === (value.acceptedAt === null), {
    message: 'Acceptance requires its version and timestamp.',
  });

export const acceptPlayConductSchema = z.strictObject({ ...action, version });

/** New uploads require explicit consent; persisted legacy commands retain their old schema. */
export const playConsentedJoinRequestSchema = requestPlayJoinSchema.extend({
  acceptedConductVersion: version,
});

/** The route requires expectedProfileId for a stored BROWSER request, including null. */
export const acceptPendingPlayConductSchema = z.union([
  z.strictObject({ version, expectedProfileId: id.nullable() }),
  z.strictObject({ version }),
]);
export const playPendingConductAcceptedSchema = z.strictObject({ requestId: id, version });

export const playSafetyMutationSchema = z.strictObject(action);
export const playSafetyCompletedSchema = z.strictObject({
  ...action,
  completed: z.literal(true),
});
export const playBlockViewSchema = z.strictObject({
  blockedUserId: id,
  name: z.string().min(1).max(100),
  createdAt: instant,
});
export const playBlockListSchema = z.strictObject({
  blocks: z.array(playBlockViewSchema).max(50),
  nextCursor: id.nullable(),
});

export const playReportCategorySchema = z.enum([
  'HARASSMENT',
  'THREATS',
  'HATE',
  'SEXUAL_CONTENT',
  'VIOLENCE',
  'IMPERSONATION',
  'OTHER',
]);
export const playReportFieldSchema = z.enum([
  'TARGET',
  'CLUE',
  'GUESS',
  'OTHER_ANSWER',
  'MESSAGE',
  'HINT',
  'CORRECTION',
]);
export const playReportSelectorSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('PARTNER_NAME') }),
    z.strictObject({
      kind: z.literal('ROUND_TEXT'),
      roundId: id,
      field: playReportFieldSchema,
      index: z.number().int().min(0).max(5).optional(),
    }),
  ])
  .superRefine((value, context) => {
    if (value.kind !== 'ROUND_TEXT') return;
    const indexed = value.field === 'MESSAGE' || value.field === 'HINT';
    if (
      indexed !== (value.index !== undefined) ||
      (value.field === 'HINT' && value.index !== undefined && value.index > 2)
    )
      context.addIssue({ code: 'custom', message: 'Use the matching visible content position.' });
  });

export const reportPlayContentSchema = z
  .strictObject({
    ...action,
    category: playReportCategorySchema,
    detail: z.string().trim().max(1000),
    selector: playReportSelectorSchema,
    expectedVisibleText: z.string().min(1).max(500),
  })
  .refine(
    (value) => value.selector.kind !== 'PARTNER_NAME' || value.expectedVisibleText.length <= 100,
    {
      message: 'The selected name exceeds its display limit.',
    }
  );

export const playReportEvidenceSchema = z
  .strictObject({ selector: playReportSelectorSchema, text: z.string().min(1).max(500) })
  .refine((value) => value.selector.kind !== 'PARTNER_NAME' || value.text.length <= 100, {
    message: 'The selected name exceeds its display limit.',
  });
export const playReportStatusSchema = z.enum(['OPEN', 'RESOLVED']);
export const playReportReviewQuerySchema = playPageQuerySchema.extend({
  status: playReportStatusSchema.optional(),
});
export const playReportViewSchema = z.strictObject({
  id: z.uuid(),
  roomId: id.nullable(),
  category: playReportCategorySchema,
  detail: z.string().max(1000),
  evidence: playReportEvidenceSchema,
  status: playReportStatusSchema,
  revision,
  createdAt: instant,
  response: z.string().min(1).max(1000).nullable(),
  respondedAt: instant.nullable(),
});
export const playReportListSchema = z.strictObject({
  reports: z.array(playReportViewSchema).max(50),
  nextCursor: id.nullable(),
});

export const playReportReviewActionSchema = z.enum([
  'RESPOND',
  'DISMISS',
  'CLOSE_ROOM',
  'RESTRICT_PLAY',
  'RESTORE_PLAY',
]);
export const reviewPlayReportSchema = z.strictObject({
  ...action,
  expectedRevision: revision,
  action: playReportReviewActionSchema,
  response: z.string().trim().min(1).max(1000),
});
const reportParticipantSchema = z.strictObject({ id, name: z.string().min(1).max(100) });
export const playReportReviewViewSchema = playReportViewSchema.extend({
  reporter: reportParticipantSchema,
  subject: reportParticipantSchema,
  subjectRestricted: z.boolean(),
  allowedActions: z.array(playReportReviewActionSchema).max(5),
});
export const playReportReviewListSchema = z.strictObject({
  reports: z.array(playReportReviewViewSchema).max(50),
  nextCursor: id.nullable(),
});

export type PlaySafetyPolicy = z.infer<typeof playSafetyPolicySchema>;
export type PlaySafetyStatus = z.infer<typeof playSafetyStatusSchema>;
export type PlayBlockView = z.infer<typeof playBlockViewSchema>;
export type PlayReportCategory = z.infer<typeof playReportCategorySchema>;
export type PlayReportSelector = z.infer<typeof playReportSelectorSchema>;
export type PlayReportView = z.infer<typeof playReportViewSchema>;
export type PlayReportReviewView = z.infer<typeof playReportReviewViewSchema>;
