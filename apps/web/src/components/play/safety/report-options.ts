import type { PlayReportSelector, PlayRoomView } from '@sotto/shared';

export type PlayReportOption = {
  id: string;
  label: string;
  selector: PlayReportSelector;
  text: string;
};

/** Offer only the other participant's text already present in this personalized projection. */
export function playReportOptions(room: PlayRoomView): PlayReportOption[] {
  if (!room.guest) return [];
  const partner = room.ownSeat === 'HOST' ? room.guest : room.host;
  const result: PlayReportOption[] = [
    { id: 'name', label: 'Partner name', selector: { kind: 'PARTNER_NAME' }, text: partner.name },
  ];
  const seen = new Set<string>();
  for (const round of [...(room.round ? [room.round] : []), ...room.completedRounds]) {
    if (seen.has(round.id)) continue;
    seen.add(round.id);
    const append = (
      field: Extract<PlayReportSelector, { kind: 'ROUND_TEXT' }>['field'],
      text: string | null | undefined,
      index?: number
    ) => {
      if (!text) return;
      result.push({
        id: `${round.id}/${field}/${index ?? -1}`,
        label: `Round ${round.order + 1}: ${field.toLowerCase().replaceAll('_', ' ')}`,
        selector: {
          kind: 'ROUND_TEXT',
          roundId: round.id,
          field,
          ...(index === undefined ? {} : { index }),
        },
        text,
      });
    };
    round.hints.forEach((hint, index) => {
      if (hint.seat !== room.ownSeat) append('HINT', hint.text, index);
    });
    if (round.learner === room.ownSeat) append('CORRECTION', round.result?.correction);
    if (round.mode === 'DESCRIBE') {
      if (round.learner !== room.ownSeat) {
        append('TARGET', round.target);
        append('CLUE', round.clue);
      } else append('GUESS', round.guess);
    } else if (round.mode === 'KNOW_ME' && round.questionStyle === 'OPEN')
      append('OTHER_ANSWER', round.otherAnswer);
    else if (round.mode === 'MISSION')
      round.messages.forEach((message, index) => {
        if (message.seat !== room.ownSeat) append('MESSAGE', message.text, index);
      });
  }
  return result;
}
