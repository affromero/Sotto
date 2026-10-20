import { z } from 'zod';
import {
  playMessageSchema,
  playRoundContextSchema,
  playRoundResultSchema,
  playTextSchema,
  playQuestionStyleSchema,
  playChoiceSchema,
  PLAY_MISSION_MESSAGES,
  PLAY_MISSION_OUTCOME_AFTER,
} from '@sotto/shared';

const common = {
  ...playRoundContextSchema.shape,
  version: z.literal(1),
  revealed: z.boolean(),
  hints: z.array(playMessageSchema).max(3),
  result: playRoundResultSchema.nullable(),
};

const describeSchema = z.strictObject({
  ...common,
  mode: z.literal('DESCRIBE'),
  targetSuggestions: z.array(playChoiceSchema).length(4).nullable(),
  phase: z.enum(['SETUP', 'CLUE', 'GUESS', 'FEEDBACK', 'FINISHED']),
  target: playTextSchema.nullable(),
  clue: playTextSchema.nullable(),
  guess: playTextSchema.nullable(),
});
const knowMeSchema = z.strictObject({
  ...common,
  mode: z.literal('KNOW_ME'),
  questionStyle: playQuestionStyleSchema,
  choices: z.array(playChoiceSchema).max(4),
  phase: z.enum(['ANSWER', 'FEEDBACK', 'FINISHED']),
  answers: z.strictObject({ HOST: playTextSchema.nullable(), GUEST: playTextSchema.nullable() }),
});
const missionSchema = z.strictObject({
  ...common,
  mode: z.literal('MISSION'),
  phase: z.enum(['EXCHANGE', 'FEEDBACK', 'FINISHED']),
  objectives: z.strictObject({ HOST: playTextSchema, GUEST: playTextSchema }),
  messages: z.array(playMessageSchema).max(PLAY_MISSION_MESSAGES),
  twist: playTextSchema,
  outcomes: z.strictObject({ HOST: z.boolean().nullable(), GUEST: z.boolean().nullable() }),
});

/** Server-private persistence contract. Clients receive only projectPlayRound(). */
export const privatePlayRoundSchema = z
  .discriminatedUnion('mode', [describeSchema, knowMeSchema, missionSchema])
  .superRefine((round, context) => {
    const invalid = (message: string) => context.addIssue({ code: 'custom', message });
    if ((round.phase === 'FINISHED') !== (round.result !== null))
      invalid('Inconsistent result phase');
    if (round.result) {
      const choiceRound = round.mode === 'KNOW_ME' && round.questionStyle === 'CHOICES';
      const expected = round.result.skipped
        ? 0
        : (round.result.matched ?? round.result.understood)
          ? 2
          : 1;
      if (round.result.points !== expected) invalid('Inconsistent round points');
      if (
        round.result.skipped &&
        (round.result.understood !== null ||
          round.result.matched !== null ||
          round.result.correction !== null)
      )
        invalid('Skipped rounds have no assessment');
      if (
        !round.result.skipped &&
        ((!choiceRound && round.result.understood === null) || !round.revealed)
      )
        invalid('Completed rounds require revealed feedback');
      if (choiceRound && !round.result.skipped) {
        if (
          round.result.matched !==
            (round.mode === 'KNOW_ME' && round.answers.HOST === round.answers.GUEST) ||
          round.result.understood !== null ||
          round.result.correction !== null
        )
          invalid('Choice results must describe the actual match without inventing an assessment');
      } else if (round.result.matched !== null) invalid('Only choice rounds have a match result');
    }
    if (round.phase === 'FEEDBACK' && !round.revealed) invalid('Feedback requires reveal');
    if (!['FEEDBACK', 'FINISHED'].includes(round.phase) && round.revealed)
      invalid('Round revealed before completion');
    if (round.mode === 'DESCRIBE') {
      if (
        round.targetSuggestions &&
        new Set(round.targetSuggestions.map((choice) => choice.id)).size !== 4
      )
        invalid('Target suggestions require four distinct cards');
      if (round.clue !== null && round.target === null) invalid('A clue requires a target');
      if (round.guess !== null && (round.clue === null || !round.revealed))
        invalid('A guess requires a clue and triggers reveal');
      if (round.phase === 'SETUP' && (round.target || round.clue || round.guess))
        invalid('Target was supplied before setup');
      if (['CLUE', 'GUESS', 'FEEDBACK'].includes(round.phase) && !round.target)
        invalid('Target is missing');
      if (['GUESS', 'FEEDBACK'].includes(round.phase) && !round.clue) invalid('Clue is missing');
      if (round.phase === 'CLUE' && (round.clue !== null || round.guess !== null))
        invalid('Description has advanced beyond its phase');
      if (round.phase === 'GUESS' && round.guess !== null)
        invalid('A committed guess must trigger reveal');
      if (round.revealed && (!round.target || !round.clue || !round.guess))
        invalid('Describe reveal requires a target, clue and guess');
    }
    if (round.mode === 'KNOW_ME' && round.revealed && (!round.answers.HOST || !round.answers.GUEST))
      invalid('Both answers must be committed before reveal');
    if (round.mode === 'KNOW_ME' && round.answers.HOST && round.answers.GUEST && !round.revealed)
      invalid('Both committed answers must trigger reveal');
    if (round.mode === 'KNOW_ME') {
      if (round.questionStyle === 'OPEN' && round.choices.length !== 0)
        invalid('Open questions cannot contain choice cards');
      if (round.questionStyle === 'CHOICES') {
        if (
          round.choices.length !== 4 ||
          new Set(round.choices.map((choice) => choice.id)).size !== 4
        )
          invalid('Choice rounds require four distinct cards');
        for (const answer of Object.values(round.answers))
          if (answer !== null && !round.choices.some((choice) => choice.id === answer))
            invalid('Committed choice is not in this round');
        if (round.phase === 'FEEDBACK') invalid('Choice rounds finish automatically');
        if (round.answers.HOST !== null && round.answers.GUEST !== null && round.result?.skipped)
          invalid('Both committed choices complete the round without a skip');
      }
    }
    if (round.mode === 'MISSION') {
      const bothFinished = round.outcomes.HOST !== null && round.outcomes.GUEST !== null;
      const bothContributed =
        round.messages.length >= PLAY_MISSION_OUTCOME_AFTER &&
        round.messages.some((message) => message.seat === 'HOST') &&
        round.messages.some((message) => message.seat === 'GUEST');
      if (round.revealed && !bothFinished)
        invalid('Both mission outcomes must be committed before reveal');
      if (
        (round.revealed || round.outcomes.HOST !== null || round.outcomes.GUEST !== null) &&
        !bothContributed
      )
        invalid('Both players must contribute to the conversation');
      if (bothFinished && !round.revealed) invalid('Both committed outcomes must trigger reveal');
      if (
        round.messages.some(
          (message, index) => index > 0 && message.seat === round.messages[index - 1].seat
        )
      )
        invalid('Mission messages must alternate between players');
    }
  });

export type PrivatePlayRound = z.infer<typeof privatePlayRoundSchema>;
