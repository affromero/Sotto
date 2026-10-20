import type { PlayRoundView } from './contracts';

/** Language text already present in this viewer's personalized projection. */
export function playVisibleTexts(round: PlayRoundView): string[] {
  const shared = [...round.hints.map((hint) => hint.text), round.result?.correction ?? null];
  const texts =
    round.mode === 'DESCRIBE'
      ? [
          ...shared,
          ...(round.targetSuggestions?.map((card) => card.text) ?? []),
          round.target,
          round.clue,
          round.guess,
        ]
      : round.mode === 'MISSION'
        ? [...shared, ...round.messages.map((message) => message.text)]
        : round.questionStyle === 'CHOICES'
          ? [...shared, ...round.choices.map((card) => card.text)]
          : [...shared, round.ownAnswer, round.otherAnswer];
  return [...new Set(texts.filter((text): text is string => text !== null))];
}
