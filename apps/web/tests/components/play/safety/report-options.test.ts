import { describe, expect, it } from 'vitest';
import { playRoomViewSchema } from '@sotto/shared';
import { playReportOptions } from '@/components/play/safety/report-options';
import { advancePlayRound, createPlayRounds } from '@/lib/play/engine';
import { projectPlayRound } from '@/lib/play/projection';
import { contract, safetyRoom } from './fixtures';

function view(name: string, guest = false) {
  const entry = contract.rounds.find((item) => item.name === name);
  if (!entry) throw new Error('Missing actual personalized round fixture');
  return playRoomViewSchema.parse({
    ...safetyRoom(guest ? 'playing-GUEST' : 'playing-HOST'),
    round: entry.round,
  });
}

describe('visible other-player report choices', () => {
  it('keeps hidden targets and own clues or guesses out of the report body', () => {
    expect(playReportOptions(view('initial-0-HOST')).map((item) => item.selector)).toEqual([
      { kind: 'PARTNER_NAME' },
    ]);
    const partner = playReportOptions(view('clue-2-GUEST', true));
    expect(
      partner.some((item) => item.selector.kind === 'ROUND_TEXT' && item.selector.field === 'CLUE')
    ).toBe(true);
    expect(
      partner.some(
        (item) => item.selector.kind === 'ROUND_TEXT' && item.selector.field === 'TARGET'
      )
    ).toBe(false);
    const learner = playReportOptions(view('finished-2-HOST'));
    expect(
      learner.some((item) => item.selector.kind === 'ROUND_TEXT' && item.selector.field === 'GUESS')
    ).toBe(true);
    expect(
      learner.some(
        (item) =>
          item.selector.kind === 'ROUND_TEXT' && ['TARGET', 'CLUE'].includes(item.selector.field)
      )
    ).toBe(false);
  });

  it('keeps original message and hint positions and excludes private mission objectives', () => {
    for (const guest of [false, true]) {
      const room = view(`message-3-4-${guest ? 'GUEST' : 'HOST'}`, guest);
      if (room.round?.mode !== 'MISSION') throw new Error('Expected actual mission projection');
      const options = playReportOptions(room);
      expect(
        options.some(
          (item) => room.round?.mode === 'MISSION' && item.text === room.round.ownObjective
        )
      ).toBe(false);
      expect(
        options
          .filter(
            (item) => item.selector.kind === 'ROUND_TEXT' && item.selector.field === 'MESSAGE'
          )
          .map((item) => item.text)
      ).toEqual(
        room.round.messages
          .filter((message) => message.seat !== room.ownSeat)
          .map((message) => message.text)
      );
      for (const option of options) {
        const selector = option.selector;
        if (selector.kind !== 'ROUND_TEXT') continue;
        if (selector.field === 'MESSAGE') {
          const message = room.round.messages[selector.index!];
          expect(message.seat).not.toBe(room.ownSeat);
          expect(option.text).toBe(message.text);
        } else if (selector.field === 'HINT') {
          const hint = room.round.hints[selector.index!];
          expect(hint.seat).not.toBe(room.ownSeat);
          expect(option.text).toBe(hint.text);
        }
      }
    }
  });

  it('reports only the revealed other answer in open prediction rounds', () => {
    const room = safetyRoom();
    const initial = createPlayRounds({
      kind: 'KNOW_ME',
      theme: 'FOOD',
      questionStyle: 'OPEN',
      players: { HOST: room.host.settings, GUEST: room.guest!.settings },
    })[0];
    const first = advancePlayRound(initial, 'HOST', {
      type: 'ANSWER',
      text: 'Meine eigene Antwort',
    });
    const final = advancePlayRound(first, 'GUEST', { type: 'ANSWER', text: 'Die andere Antwort' });
    const projection = projectPlayRound(final, 'HOST');
    const actual = playRoomViewSchema.parse({
      ...room,
      round: { ...projection, id: 'open-round', order: 0 },
    });
    const options = playReportOptions(actual);
    expect(options).toContainEqual({
      id: 'open-round/OTHER_ANSWER/-1',
      label: 'Round 1: other answer',
      selector: { kind: 'ROUND_TEXT', roundId: 'open-round', field: 'OTHER_ANSWER' },
      text: 'Die andere Antwort',
    });
    expect(options.some((item) => item.text === 'Meine eigene Antwort')).toBe(false);
  });
});
