import {
  playGameConfigSchema,
  playRoundCommandSchema,
  playSeatSchema,
  PLAY_MISSION_MESSAGES,
  PLAY_MISSION_OUTCOME_AFTER,
  type PlayActionType,
  type PlayGameConfig,
  type PlayMode,
  type PlayRoundCommand,
  type PlaySeat,
} from '@sotto/shared';
import { playCard, playGuidance } from './catalogue';
import { playChoicePrompt, playChoices } from './choices';
import { playTargetSuggestions } from './targets';
import { PlayRuleError } from './errors';
import { privatePlayRoundSchema, type PrivatePlayRound } from './private-state';

export function otherPlaySeat(seat: PlaySeat): PlaySeat {
  return seat === 'HOST' ? 'GUEST' : 'HOST';
}

export function readPrivatePlayRound(value: unknown): PrivatePlayRound {
  const parsed = privatePlayRoundSchema.safeParse(value);
  if (!parsed.success) throw new PlayRuleError('invalid', 'Saved round is invalid');
  return parsed.data;
}

export function createPlayRounds(input: PlayGameConfig, seed = 0): PrivatePlayRound[] {
  const config = playGameConfigSchema.parse(input);
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new PlayRuleError('invalid', 'Invalid game seed');
  const modes: PlayMode[] =
    config.kind === 'MIXED' ? ['KNOW_ME', 'DESCRIBE', 'MISSION'] : [config.kind];
  return modes.flatMap((mode, modeIndex) =>
    (['HOST', 'GUEST'] as const).map((learner, roleIndex) => {
      const settings = config.players[learner];
      const order = modeIndex * 2 + roleIndex;
      const card = playCard(config.theme, mode, (seed % 2) + roleIndex);
      const common = {
        version: 1,
        order,
        learner,
        targetLang: settings.targetLang,
        supportLang: settings.nativeLang,
        level: settings.level,
        prompt: card.prompt,
        guidance: playGuidance(settings.level),
        revealed: false,
        hints: [],
        result: null,
      };
      if (mode === 'DESCRIBE')
        return readPrivatePlayRound({
          ...common,
          mode,
          phase: 'SETUP',
          targetSuggestions: playTargetSuggestions(
            config.theme,
            settings.targetLang,
            settings.nativeLang,
            seed + roleIndex
          ),
          target: null,
          clue: null,
          guess: null,
        });
      if (mode === 'KNOW_ME') {
        const questionStyle = config.questionStyle ?? 'CHOICES';
        return readPrivatePlayRound({
          ...common,
          mode,
          questionStyle,
          choices:
            questionStyle === 'CHOICES'
              ? playChoices(config.theme, settings.targetLang, settings.nativeLang)
              : [],
          prompt:
            questionStyle === 'CHOICES'
              ? playChoicePrompt(config.theme, (seed % 2) + roleIndex)
              : common.prompt,
          guidance:
            questionStyle === 'CHOICES'
              ? 'Read the cards in the target language. You can reveal their meanings when you need help.'
              : common.guidance,
          phase: 'ANSWER',
          answers: { HOST: null, GUEST: null },
        });
      }
      if (!card.objectives) throw new PlayRuleError('invalid', 'Mission has no objectives');
      return readPrivatePlayRound({
        ...common,
        mode,
        phase: 'EXCHANGE',
        twist: card.twist,
        objectives: {
          [learner]: card.objectives.learner,
          [otherPlaySeat(learner)]: card.objectives.partner,
        },
        messages: [],
        outcomes: { HOST: null, GUEST: null },
      });
    })
  );
}

/** These permissions are included in personalized views so clients need no rule engine. */
export function allowedPlayActions(round: PrivatePlayRound, actor: PlaySeat): PlayActionType[] {
  if (round.phase === 'FINISHED') return [];
  const actions: PlayActionType[] = ['SKIP'];
  if (round.phase === 'FEEDBACK') {
    if (actor !== round.learner) actions.push('FEEDBACK');
    return actions;
  }
  if (round.hints.length < 3) actions.push('HINT');
  if (round.mode === 'DESCRIBE') {
    if (actor === round.learner && round.phase === 'SETUP') actions.push('SET_TARGET');
    if (actor === round.learner && round.phase === 'CLUE') actions.push('GIVE_CLUE');
    if (actor !== round.learner && round.phase === 'GUESS') actions.push('GUESS');
  } else if (round.mode === 'KNOW_ME') {
    if (round.answers[actor] === null)
      actions.push(round.questionStyle === 'CHOICES' ? 'CHOOSE' : 'ANSWER');
  } else {
    if (round.messages.length < PLAY_MISSION_MESSAGES && round.messages.at(-1)?.seat !== actor)
      actions.push('MESSAGE');
    const contributed = (['HOST', 'GUEST'] as const).every((seat) =>
      round.messages.some((message) => message.seat === seat)
    );
    if (
      contributed &&
      round.messages.length >= PLAY_MISSION_OUTCOME_AFTER &&
      round.outcomes[actor] === null
    )
      actions.push('MISSION_DONE');
  }
  return actions;
}

function assertRole(round: PrivatePlayRound, actor: PlaySeat, command: PlayRoundCommand): void {
  const learnerOnly = command.type === 'SET_TARGET' || command.type === 'GIVE_CLUE';
  const partnerOnly = command.type === 'GUESS' || command.type === 'FEEDBACK';
  if ((learnerOnly && actor !== round.learner) || (partnerOnly && actor === round.learner))
    throw new PlayRuleError('forbidden', 'That action belongs to your partner');
  if (!allowedPlayActions(round, actor).includes(command.type))
    throw new PlayRuleError('conflict', 'That action is not available in this round');
}

export function advancePlayRound(
  input: PrivatePlayRound,
  actorInput: PlaySeat,
  commandInput: PlayRoundCommand
): PrivatePlayRound {
  const round = readPrivatePlayRound(input);
  const actor = playSeatSchema.parse(actorInput);
  const command = playRoundCommandSchema.parse(commandInput);
  assertRole(round, actor, command);
  if (command.type === 'SKIP')
    return readPrivatePlayRound({
      ...round,
      phase: 'FINISHED',
      result: { skipped: true, understood: null, matched: null, correction: null, points: 0 },
    });
  if (command.type === 'HINT')
    return readPrivatePlayRound({
      ...round,
      hints: [...round.hints, { seat: actor, text: command.text }],
    });
  if (command.type === 'FEEDBACK')
    return readPrivatePlayRound({
      ...round,
      phase: 'FINISHED',
      result: {
        skipped: false,
        understood: command.understood,
        matched: null,
        correction: command.correction,
        points: command.understood ? 2 : 1,
      },
    });
  if (round.mode === 'DESCRIBE') {
    if (command.type === 'SET_TARGET')
      return readPrivatePlayRound({ ...round, phase: 'CLUE', target: command.text });
    if (command.type === 'GIVE_CLUE') {
      if (
        command.text.normalize('NFKC').toLocaleLowerCase(round.targetLang) ===
        round.target?.normalize('NFKC').toLocaleLowerCase(round.targetLang)
      )
        throw new PlayRuleError('invalid', 'Describe your target instead of repeating it');
      return readPrivatePlayRound({ ...round, phase: 'GUESS', clue: command.text });
    }
    if (command.type === 'GUESS')
      return readPrivatePlayRound({
        ...round,
        phase: 'FEEDBACK',
        revealed: true,
        guess: command.text,
      });
  }
  if (round.mode === 'KNOW_ME' && command.type === 'ANSWER') {
    const answers = { ...round.answers, [actor]: command.text };
    const complete = answers.HOST !== null && answers.GUEST !== null;
    return readPrivatePlayRound({
      ...round,
      answers,
      phase: complete ? 'FEEDBACK' : 'ANSWER',
      revealed: complete,
    });
  }
  if (round.mode === 'KNOW_ME' && command.type === 'CHOOSE') {
    const answers = { ...round.answers, [actor]: command.optionId };
    const complete = answers.HOST !== null && answers.GUEST !== null;
    const matched = complete ? answers.HOST === answers.GUEST : null;
    return readPrivatePlayRound({
      ...round,
      answers,
      phase: complete ? 'FINISHED' : 'ANSWER',
      revealed: complete,
      result: complete
        ? {
            skipped: false,
            understood: null,
            matched,
            correction: null,
            points: matched ? 2 : 1,
          }
        : null,
    });
  }
  if (round.mode === 'MISSION') {
    if (command.type === 'MESSAGE')
      return readPrivatePlayRound({
        ...round,
        messages: [...round.messages, { seat: actor, text: command.text }],
      });
    if (command.type === 'MISSION_DONE') {
      const outcomes = { ...round.outcomes, [actor]: command.achieved };
      const complete = outcomes.HOST !== null && outcomes.GUEST !== null;
      return readPrivatePlayRound({
        ...round,
        outcomes,
        phase: complete ? 'FEEDBACK' : 'EXCHANGE',
        revealed: complete,
      });
    }
  }
  throw new PlayRuleError('invalid', 'Action does not belong to this game');
}
