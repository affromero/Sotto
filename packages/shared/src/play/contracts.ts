import { z } from 'zod';

export const PLAY_MISSION_MESSAGES = 6;
export const PLAY_MISSION_TWIST_AT = 3;
export const PLAY_MISSION_OUTCOME_AFTER = 4;
export const PLAY_CARD_LANGUAGES = ['en', 'de', 'es', 'fr', 'pt', 'it', 'ja', 'zh', 'ko'] as const;

export const playSeatSchema = z.enum(['HOST', 'GUEST']);
export const playModeSchema = z.enum(['DESCRIBE', 'MISSION', 'KNOW_ME']);
export const playSessionKindSchema = z.enum(['DESCRIBE', 'MISSION', 'KNOW_ME', 'MIXED']);
export const playThemeSchema = z.enum([
  'EVERYDAY',
  'FOOD',
  'TRAVEL',
  'SILLY',
  'GET_TO_KNOW_YOU',
  'AFFECTIONATE',
]);
export const playLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
export const playQuestionStyleSchema = z.enum(['CHOICES', 'OPEN']);
export const playTextSchema = z.string().trim().min(1).max(500);
export const playLanguageSchema = z.string().regex(/^[a-z]{2,3}$/);
export const playSettingsSchema = z
  .strictObject({
    nativeLang: playLanguageSchema,
    targetLang: playLanguageSchema,
    level: playLevelSchema,
  })
  .refine((settings) => settings.nativeLang !== settings.targetLang, {
    message: 'Choose a target language different from your support language.',
    path: ['targetLang'],
  });

export const playRoundCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('SET_TARGET'), text: playTextSchema }),
  z.strictObject({ type: z.literal('GIVE_CLUE'), text: playTextSchema }),
  z.strictObject({ type: z.literal('GUESS'), text: playTextSchema }),
  z.strictObject({ type: z.literal('ANSWER'), text: playTextSchema }),
  z.strictObject({ type: z.literal('CHOOSE'), optionId: z.enum(['A', 'B', 'C', 'D']) }),
  z.strictObject({ type: z.literal('MESSAGE'), text: playTextSchema }),
  z.strictObject({ type: z.literal('MISSION_DONE'), achieved: z.boolean() }),
  z.strictObject({ type: z.literal('HINT'), text: playTextSchema }),
  z.strictObject({
    type: z.literal('FEEDBACK'),
    understood: z.boolean(),
    correction: playTextSchema.nullable(),
  }),
  z.strictObject({ type: z.literal('SKIP') }),
]);

export const playActionTypeSchema = z.enum([
  'SET_TARGET',
  'GIVE_CLUE',
  'GUESS',
  'ANSWER',
  'CHOOSE',
  'MESSAGE',
  'MISSION_DONE',
  'HINT',
  'FEEDBACK',
  'SKIP',
]);
export const playRoundActionRequestSchema = z.strictObject({
  actionId: z.uuid(),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  command: playRoundCommandSchema,
});

export const playRoundPhaseSchema = z.enum([
  'SETUP',
  'CLUE',
  'GUESS',
  'ANSWER',
  'EXCHANGE',
  'FEEDBACK',
  'FINISHED',
]);
export const playMessageSchema = z.strictObject({ seat: playSeatSchema, text: playTextSchema });
export const playRoundResultSchema = z.strictObject({
  skipped: z.boolean(),
  understood: z.boolean().nullable(),
  matched: z.boolean().nullable(),
  correction: playTextSchema.nullable(),
  points: z.number().int().min(0).max(2),
});

export const playChoiceSchema = z.strictObject({
  id: z.enum(['A', 'B', 'C', 'D']),
  text: playTextSchema,
  supportText: playTextSchema.nullable(),
  symbol: z.string().min(1).max(8),
});

export const playRoundContextSchema = z.strictObject({
  order: z.number().int().min(0).max(5),
  learner: playSeatSchema,
  targetLang: playLanguageSchema,
  supportLang: playLanguageSchema,
  level: playLevelSchema,
  prompt: z.string().min(1).max(1000),
  guidance: z.string().min(1).max(500),
});

const roundViewFields = {
  ...playRoundContextSchema.shape,
  phase: playRoundPhaseSchema,
  role: z.enum(['LEARNER', 'PARTNER']),
  instruction: z.string().min(1).max(500),
  revealed: z.boolean(),
  allowedActions: z.array(playActionTypeSchema).max(10),
  hints: z.array(playMessageSchema).max(3),
  result: playRoundResultSchema.nullable(),
};

export const playRoundViewSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    ...roundViewFields,
    mode: z.literal('DESCRIBE'),
    targetSuggestions: z.array(playChoiceSchema).length(4).nullable(),
    target: playTextSchema.nullable(),
    clue: playTextSchema.nullable(),
    guess: playTextSchema.nullable(),
  }),
  z.strictObject({
    ...roundViewFields,
    mode: z.literal('KNOW_ME'),
    questionStyle: playQuestionStyleSchema,
    choices: z.array(playChoiceSchema).max(4),
    ownAnswer: playTextSchema.nullable(),
    otherAnswer: playTextSchema.nullable(),
    otherCommitted: z.boolean(),
  }),
  z.strictObject({
    ...roundViewFields,
    mode: z.literal('MISSION'),
    ownObjective: playTextSchema,
    otherObjective: playTextSchema.nullable(),
    messages: z.array(playMessageSchema).max(PLAY_MISSION_MESSAGES),
    remainingMessages: z.number().int().min(0).max(PLAY_MISSION_MESSAGES),
    twist: playTextSchema.nullable(),
    ownOutcome: z.boolean().nullable(),
    otherOutcome: z.boolean().nullable(),
  }),
]);

export const playGameConfigSchema = z.strictObject({
  kind: playSessionKindSchema,
  theme: playThemeSchema,
  questionStyle: playQuestionStyleSchema.optional(),
  players: z.strictObject({ HOST: playSettingsSchema, GUEST: playSettingsSchema }),
});

export const playPhraseInputSchema = z.strictObject({
  roundId: z.string().min(1).max(100),
  kind: z.enum(['WORD', 'PHRASE', 'SENTENCE']),
  text: playTextSchema,
  contextText: z.string().trim().max(2000).nullable(),
});

export type PlaySeat = z.infer<typeof playSeatSchema>;
export type PlayMode = z.infer<typeof playModeSchema>;
export type PlayTheme = z.infer<typeof playThemeSchema>;
export type PlayLevel = z.infer<typeof playLevelSchema>;
export type PlaySettings = z.infer<typeof playSettingsSchema>;
export type PlayGameConfig = z.infer<typeof playGameConfigSchema>;
export type PlayRoundCommand = z.infer<typeof playRoundCommandSchema>;
export type PlayActionType = z.infer<typeof playActionTypeSchema>;
export type PlayRoundView = z.infer<typeof playRoundViewSchema>;
export type PlayRoundResult = z.infer<typeof playRoundResultSchema>;
export type PlayChoice = z.infer<typeof playChoiceSchema>;
