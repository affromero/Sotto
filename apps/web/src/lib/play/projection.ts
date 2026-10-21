import {
  playRoundViewSchema,
  playSeatSchema,
  PLAY_MISSION_MESSAGES,
  PLAY_MISSION_TWIST_AT,
  type PlayRoundView,
  type PlaySeat,
} from '@sotto/shared';
import { allowedPlayActions, otherPlaySeat, readPrivatePlayRound } from './engine';
import type { PrivatePlayRound } from './private-state';

function instructionFor(round: PrivatePlayRound, viewer: PlaySeat): string {
  const learner = viewer === round.learner;
  if (round.mode === 'KNOW_ME' && round.questionStyle === 'CHOICES')
    return learner
      ? 'Pick the card your partner will choose. Your picks stay hidden until both commit.'
      : 'Pick your own answer. Your partner is trying to predict your choice.';
  if (round.mode === 'KNOW_ME')
    return learner
      ? 'Predict how your partner will answer the question, using the language you are learning.'
      : 'Answer the question about yourself, using your partner’s target language.';
  if (round.mode === 'DESCRIBE')
    return learner
      ? 'Pick a secret card or your own word. Give one clue without naming it.'
      : 'Read your partner’s clue and guess their secret word or phrase.';
  return learner
    ? 'You have six messages together. Work toward your secret objective and react to the twist.'
    : 'Use your partner’s target language. You share six messages and each have a secret objective.';
}

/** Build the complete client payload explicitly. Never spread a private round. */
export function projectPlayRound(input: unknown, viewerInput: PlaySeat): PlayRoundView {
  const round = readPrivatePlayRound(input);
  const viewer = playSeatSchema.parse(viewerInput);
  const other = otherPlaySeat(viewer);
  const common = {
    order: round.order,
    learner: round.learner,
    targetLang: round.targetLang,
    supportLang: round.supportLang,
    level: round.level,
    prompt: round.prompt,
    guidance: round.guidance,
    phase: round.phase,
    role: viewer === round.learner ? 'LEARNER' : 'PARTNER',
    instruction: instructionFor(round, viewer),
    revealed: round.revealed,
    allowedActions: allowedPlayActions(round, viewer),
    hints: round.hints,
    result: round.result,
  };
  if (round.mode === 'DESCRIBE')
    return playRoundViewSchema.parse({
      ...common,
      mode: round.mode,
      targetSuggestions: viewer === round.learner ? round.targetSuggestions : null,
      target: viewer === round.learner || round.revealed ? round.target : null,
      clue: round.clue,
      guess: round.guess,
    });
  if (round.mode === 'KNOW_ME')
    return playRoundViewSchema.parse({
      ...common,
      mode: round.mode,
      questionStyle: round.questionStyle,
      choices: round.choices,
      ownAnswer: round.answers[viewer],
      otherAnswer: round.revealed ? round.answers[other] : null,
      otherCommitted: round.answers[other] !== null,
    });
  return playRoundViewSchema.parse({
    ...common,
    mode: round.mode,
    ownObjective: round.objectives[viewer],
    otherObjective: round.revealed ? round.objectives[other] : null,
    messages: round.messages,
    remainingMessages: PLAY_MISSION_MESSAGES - round.messages.length,
    twist: round.messages.length >= PLAY_MISSION_TWIST_AT ? round.twist : null,
    ownOutcome: round.outcomes[viewer],
    otherOutcome: round.revealed ? round.outcomes[other] : null,
  });
}
