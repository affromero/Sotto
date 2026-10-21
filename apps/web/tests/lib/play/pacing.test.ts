import { describe, expect, it } from 'vitest';
import type { PlayGameConfig, PlaySeat, PlayTheme } from '@sotto/shared';
import {
  advancePlayRound,
  createPlayRounds,
  otherPlaySeat,
  readPrivatePlayRound,
} from '@/lib/play/engine';
import { projectPlayRound } from '@/lib/play/projection';
import { PlayRuleError } from '@/lib/play/errors';
import { playTargetSuggestions } from '@/lib/play/targets';

const config: PlayGameConfig = {
  kind: 'MIXED',
  theme: 'FOOD',
  questionStyle: 'OPEN',
  players: {
    HOST: { nativeLang: 'en', targetLang: 'de', level: 'A1' },
    GUEST: { nativeLang: 'en', targetLang: 'es', level: 'B2' },
  },
};

function mission(learner: PlaySeat, messages = 0) {
  let round = createPlayRounds({ ...config, kind: 'MISSION' })[learner === 'HOST' ? 0 : 1];
  for (let index = 0; index < messages; index++)
    round = advancePlayRound(round, index % 2 === 0 ? 'HOST' : 'GUEST', {
      type: 'MESSAGE',
      text: `Message ${index + 1}`,
    });
  return round;
}

describe('short rounds with private cards and a mid-round twist', () => {
  it.each(['HOST', 'GUEST'] as const)(
    'keeps %s target cards and a custom secret out of the entire partner projection',
    (learner) => {
      let round = createPlayRounds({ ...config, kind: 'DESCRIBE' })[learner === 'HOST' ? 0 : 1];
      if (round.mode !== 'DESCRIBE' || !round.targetSuggestions)
        throw new Error('Fixture needs target cards');
      const other = otherPlaySeat(learner);
      const changed = readPrivatePlayRound({
        ...round,
        targetSuggestions: round.targetSuggestions.map((card) => ({
          ...card,
          text: `Hidden ${card.id}`,
        })),
      });
      expect(projectPlayRound(changed, other)).toEqual(projectPlayRound(round, other));
      expect(projectPlayRound(round, learner)).toMatchObject({
        targetSuggestions: round.targetSuggestions,
      });
      const skipped = advancePlayRound(round, other, { type: 'SKIP' });
      expect(projectPlayRound(skipped, other)).toMatchObject({
        targetSuggestions: null,
        target: null,
        revealed: false,
      });
      round = advancePlayRound(round, learner, { type: 'SET_TARGET', text: 'Mein Geheimwort' });
      const alternate = readPrivatePlayRound({ ...round, target: 'Anderes Geheimwort' });
      expect(projectPlayRound(alternate, other)).toEqual(projectPlayRound(round, other));
    }
  );

  it('keeps unsupported languages playable through explicit custom targets', () => {
    const rounds = createPlayRounds({
      ...config,
      kind: 'DESCRIBE',
      players: { ...config.players, HOST: { nativeLang: 'en', targetLang: 'nl', level: 'A2' } },
    });
    expect(projectPlayRound(rounds[0], 'HOST')).toMatchObject({
      targetLang: 'nl',
      targetSuggestions: null,
      allowedActions: expect.arrayContaining(['SET_TARGET']),
    });
    const next = advancePlayRound(rounds[0], 'HOST', { type: 'SET_TARGET', text: 'fiets' });
    expect(projectPlayRound(next, 'HOST')).toMatchObject({ target: 'fiets', phase: 'CLUE' });
    expect(projectPlayRound(next, 'GUEST')).toMatchObject({
      target: null,
      targetSuggestions: null,
    });
    expect(
      createPlayRounds({
        ...config,
        players: { ...config.players, HOST: { nativeLang: 'en', targetLang: 'nl', level: 'A2' } },
      })
    ).toHaveLength(6);
  });

  it.each(['HOST', 'GUEST'] as const)(
    'reveals the twist to %s after three messages and allows outcomes after a reply',
    (learner) => {
      const before = mission(learner, 2);
      if (before.mode !== 'MISSION') throw new Error('Fixture needs a mission');
      const alternate = readPrivatePlayRound({
        ...before,
        twist: 'A different private twist',
        objectives: {
          ...before.objectives,
          [otherPlaySeat(learner)]: 'A different private objective',
        },
      });
      expect(projectPlayRound(alternate, learner)).toEqual(projectPlayRound(before, learner));
      expect(projectPlayRound(before, learner)).toMatchObject({
        twist: null,
        remainingMessages: 4,
      });
      expect(() =>
        advancePlayRound(before, learner, { type: 'MISSION_DONE', achieved: true })
      ).toThrow(PlayRuleError);
      const third = advancePlayRound(before, 'HOST', { type: 'MESSAGE', text: 'Our next step.' });
      expect(projectPlayRound(third, learner)).toMatchObject({
        twist: before.twist,
        remainingMessages: 3,
      });
      expect(() =>
        advancePlayRound(third, learner, { type: 'MISSION_DONE', achieved: true })
      ).toThrow(PlayRuleError);
      const fourth = advancePlayRound(third, 'GUEST', {
        type: 'MESSAGE',
        text: 'Let us adapt our plan.',
      });
      const committed = advancePlayRound(fourth, learner, { type: 'MISSION_DONE', achieved: true });
      expect(projectPlayRound(committed, learner)).toMatchObject({
        ownOutcome: true,
        otherOutcome: null,
        revealed: false,
        remainingMessages: 2,
      });
    }
  );

  it.each(['HOST', 'GUEST'] as const)(
    'keeps the unplayed twist hidden when %s skips early',
    (learner) => {
      const round = mission(learner, 2);
      if (round.mode !== 'MISSION') throw new Error('Fixture needs a mission');
      const skipped = advancePlayRound(round, learner, { type: 'SKIP' });
      for (const viewer of ['HOST', 'GUEST'] as const) {
        expect(projectPlayRound(skipped, viewer)).toMatchObject({
          twist: null,
          otherObjective: null,
          result: { skipped: true, points: 0 },
        });
        expect(JSON.stringify(projectPlayRound(skipped, viewer))).not.toContain(round.twist);
      }
    }
  );

  it('ends the exchange at six messages and still permits both players to assess it', () => {
    let round = mission('HOST', 6);
    expect(projectPlayRound(round, 'HOST')).toMatchObject({ remainingMessages: 0 });
    expect(() =>
      advancePlayRound(round, 'HOST', { type: 'MESSAGE', text: 'Seventh message' })
    ).toThrow(PlayRuleError);
    round = advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: true });
    round = advancePlayRound(round, 'GUEST', { type: 'MISSION_DONE', achieved: false });
    expect(projectPlayRound(round, 'GUEST')).toMatchObject({
      otherOutcome: true,
      ownOutcome: false,
      phase: 'FEEDBACK',
      revealed: true,
    });
    round = advancePlayRound(round, 'GUEST', {
      type: 'FEEDBACK',
      understood: true,
      correction: null,
    });
    expect(round.result).toMatchObject({ points: 2, understood: true });
  });

  it('offers translated words for every supported language and theme without an English substitute', () => {
    const themes: PlayTheme[] = [
      'EVERYDAY',
      'FOOD',
      'TRAVEL',
      'SILLY',
      'GET_TO_KNOW_YOU',
      'AFFECTIONATE',
    ];
    for (const language of ['de', 'es', 'fr', 'pt', 'it', 'ja', 'zh', 'ko'])
      for (const theme of themes) {
        const cards = playTargetSuggestions(theme, language, 'en', 0);
        expect(cards?.every((card) => card.supportText)).toBe(true);
        expect(cards?.[0].text).not.toBe(cards?.[0].supportText);
        expect(new Set(cards?.map((card) => card.text)).size).toBe(4);
      }
    expect(playTargetSuggestions('EVERYDAY', 'nl', 'en', 0)).toBeNull();
    expect(
      playTargetSuggestions('EVERYDAY', 'de', 'nl', 0)?.every((card) => card.supportText === null)
    ).toBe(true);
  });
});
