import { describe, expect, it } from 'vitest';
import type { PlayGameConfig, PlayMode, PlaySeat, PlayTheme } from '@sotto/shared';
import {
  advancePlayRound,
  createPlayRounds,
  otherPlaySeat,
  readPrivatePlayRound,
} from '@/lib/play/engine';
import { PlayRuleError } from '@/lib/play/errors';
import type { PrivatePlayRound } from '@/lib/play/private-state';
import { projectPlayRound } from '@/lib/play/projection';

const config: PlayGameConfig = {
  kind: 'MIXED',
  theme: 'EVERYDAY',
  questionStyle: 'OPEN',
  players: {
    HOST: { nativeLang: 'es', targetLang: 'de', level: 'A1' },
    GUEST: { nativeLang: 'de', targetLang: 'es', level: 'C1' },
  },
};

function start(mode: PlayMode, learner: PlaySeat = 'HOST'): PrivatePlayRound {
  const round = createPlayRounds({ ...config, kind: mode }).find(
    (item) => item.learner === learner
  );
  if (!round) throw new Error('Missing test round');
  return round;
}

function describeToFeedback(learner: PlaySeat): PrivatePlayRound {
  let round = start('DESCRIBE', learner);
  round = advancePlayRound(round, learner, { type: 'SET_TARGET', text: 'Regenschirm' });
  round = advancePlayRound(round, learner, {
    type: 'GIVE_CLUE',
    text: 'Das benutze ich bei Regen.',
  });
  return advancePlayRound(round, otherPlaySeat(learner), { type: 'GUESS', text: 'Ein Schirm?' });
}

describe('two-player language rounds', () => {
  it('alternates learning roles and keeps each learner’s own language and level', () => {
    const rounds = createPlayRounds(config);
    expect(rounds.map(({ mode, learner }) => [mode, learner])).toEqual([
      ['KNOW_ME', 'HOST'],
      ['KNOW_ME', 'GUEST'],
      ['DESCRIBE', 'HOST'],
      ['DESCRIBE', 'GUEST'],
      ['MISSION', 'HOST'],
      ['MISSION', 'GUEST'],
    ]);
    for (const round of rounds) {
      expect(round.targetLang).toBe(config.players[round.learner].targetLang);
      expect(round.level).toBe(config.players[round.learner].level);
    }
    expect(rounds[0].guidance).toMatch(/short sentence/i);
    expect(rounds[1].guidance).toMatch(/precise expression/i);
  });

  it.each(['DESCRIBE', 'MISSION', 'KNOW_ME'] as const)(
    'offers two different prompts for quick %s play',
    (mode) => {
      const rounds = createPlayRounds({ ...config, kind: mode });
      expect(rounds.map((round) => round.learner)).toEqual(['HOST', 'GUEST']);
      expect(rounds[0].prompt).not.toBe(rounds[1].prompt);
    }
  );

  it('allows partners learning the same target language without a course', () => {
    const rounds = createPlayRounds({
      ...config,
      players: { ...config.players, GUEST: { nativeLang: 'en', targetLang: 'de', level: 'B1' } },
    });
    expect(rounds.every((round) => round.targetLang === 'de')).toBe(true);
  });

  it.each([
    'EVERYDAY',
    'FOOD',
    'TRAVEL',
    'SILLY',
    'GET_TO_KNOW_YOU',
    'AFFECTIONATE',
  ] satisfies PlayTheme[])('provides complete playable rounds for the %s theme', (theme) => {
    const rounds = createPlayRounds({ ...config, theme }, 17);
    for (const round of rounds) {
      if (round.mode !== 'MISSION') continue;
      expect(round.objectives.HOST).not.toBe(round.objectives.GUEST);
      expect(JSON.stringify(projectPlayRound(round, 'HOST'))).not.toContain(round.objectives.GUEST);
      expect(JSON.stringify(projectPlayRound(round, 'GUEST'))).not.toContain(round.objectives.HOST);
    }
  });

  it.each(['HOST', 'GUEST'] as const)(
    'lets %s describe and receive meaning-based partner feedback',
    (learner) => {
      const before = start('DESCRIBE', learner);
      expect(() =>
        advancePlayRound(before, otherPlaySeat(learner), {
          type: 'SET_TARGET',
          text: 'Regenschirm',
        })
      ).toThrow(PlayRuleError);
      const feedback = describeToFeedback(learner);
      expect(before.phase).toBe('SETUP');
      expect(feedback.phase).toBe('FEEDBACK');
      expect(feedback.revealed).toBe(true);
      expect(feedback.result).toBeNull();
      expect(() =>
        advancePlayRound(feedback, learner, {
          type: 'FEEDBACK',
          understood: true,
          correction: null,
        })
      ).toThrow(PlayRuleError);
      const finished = advancePlayRound(feedback, otherPlaySeat(learner), {
        type: 'FEEDBACK',
        understood: true,
        correction: 'Du kannst auch „Schirm“ sagen.',
      });
      expect(finished.result).toMatchObject({ points: 2, understood: true, skipped: false });
      expect(finished.result?.correction).toContain('Schirm');
      expect(() =>
        advancePlayRound(finished, otherPlaySeat(learner), {
          type: 'FEEDBACK',
          understood: true,
          correction: null,
        })
      ).toThrow(PlayRuleError);
      expect(projectPlayRound(finished, learner).allowedActions).toEqual([]);
    }
  );

  it('requires a target, clue and partner guess in order without accepting the target as its own clue', () => {
    let round = start('DESCRIBE');
    expect(() => advancePlayRound(round, 'GUEST', { type: 'GUESS', text: 'Schirm' })).toThrow(
      PlayRuleError
    );
    round = advancePlayRound(round, 'HOST', { type: 'SET_TARGET', text: 'Eis' });
    expect(() => advancePlayRound(round, 'HOST', { type: 'GIVE_CLUE', text: ' EIS ' })).toThrow(
      PlayRuleError
    );
    round = advancePlayRound(round, 'HOST', {
      type: 'GIVE_CLUE',
      text: 'Meistens esse ich das im Sommer.',
    });
    expect(round.phase).toBe('GUESS');
  });

  it.each(['HOST', 'GUEST'] as const)(
    'lets %s commit first in Do you know me without changing their answer',
    (first) => {
      let round = start('KNOW_ME');
      round = advancePlayRound(round, first, { type: 'ANSWER', text: 'Ein Spaziergang am Fluss.' });
      expect(round.phase).toBe('ANSWER');
      expect(round.revealed).toBe(false);
      expect(() =>
        advancePlayRound(round, first, { type: 'ANSWER', text: 'A different answer' })
      ).toThrow(PlayRuleError);
      round = advancePlayRound(round, otherPlaySeat(first), {
        type: 'ANSWER',
        text: 'Am Fluss spazieren gehen.',
      });
      expect(round.revealed).toBe(true);
      round = advancePlayRound(round, 'GUEST', {
        type: 'FEEDBACK',
        understood: true,
        correction: null,
      });
      expect(round.result?.points).toBe(2);
    }
  );

  it('gives completion credit even when the partner did not understand', () => {
    const round = advancePlayRound(describeToFeedback('HOST'), 'GUEST', {
      type: 'FEEDBACK',
      understood: false,
      correction: 'Try a shorter sentence.',
    });
    expect(round.result).toMatchObject({ points: 1, understood: false, skipped: false });
  });

  it('requires both mission players to converse and commit their own outcome before reveal', () => {
    let round = start('MISSION');
    expect(() => advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: true })).toThrow(
      PlayRuleError
    );
    round = advancePlayRound(round, 'HOST', { type: 'MESSAGE', text: 'Gehen wir in den Park?' });
    expect(() => advancePlayRound(round, 'HOST', { type: 'MESSAGE', text: 'Und dann?' })).toThrow(
      PlayRuleError
    );
    round = advancePlayRound(round, 'GUEST', {
      type: 'MESSAGE',
      text: 'Ja, dort können wir sitzen.',
    });
    expect(() => advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: true })).toThrow(
      PlayRuleError
    );
    round = advancePlayRound(round, 'HOST', {
      type: 'MESSAGE',
      text: 'Und unser Freund kommt mit.',
    });
    round = advancePlayRound(round, 'GUEST', {
      type: 'MESSAGE',
      text: 'Dann treffen wir uns zu dritt.',
    });
    round = advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: true });
    expect(round.revealed).toBe(false);
    expect(() =>
      advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: false })
    ).toThrow(PlayRuleError);
    round = advancePlayRound(round, 'GUEST', { type: 'MISSION_DONE', achieved: false });
    expect(round.phase).toBe('FEEDBACK');
    expect(round.revealed).toBe(true);
    round = advancePlayRound(round, 'GUEST', {
      type: 'FEEDBACK',
      understood: true,
      correction: null,
    });
    expect(round.result).toMatchObject({ understood: true, points: 2 });
  });

  it('caps the conversation while still allowing both players to finish', () => {
    let round = start('MISSION');
    for (let index = 0; index < 6; index++)
      round = advancePlayRound(round, index % 2 === 0 ? 'HOST' : 'GUEST', {
        type: 'MESSAGE',
        text: `Message ${index}`,
      });
    expect(() => advancePlayRound(round, 'HOST', { type: 'MESSAGE', text: 'Too much' })).toThrow(
      PlayRuleError
    );
    round = advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: true });
    round = advancePlayRound(round, 'GUEST', { type: 'MISSION_DONE', achieved: true });
    expect(round.revealed).toBe(true);
  });

  it('lets a player who met their mission keep helping their partner finish', () => {
    let round = start('MISSION');
    round = advancePlayRound(round, 'HOST', { type: 'MESSAGE', text: 'Gehen wir in den Park?' });
    round = advancePlayRound(round, 'GUEST', { type: 'MESSAGE', text: 'Gibt es dort eine Bank?' });
    round = advancePlayRound(round, 'HOST', { type: 'MESSAGE', text: 'Unser Freund kommt auch.' });
    round = advancePlayRound(round, 'GUEST', { type: 'MESSAGE', text: 'Wir haben genug Platz.' });
    round = advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: true });
    round = advancePlayRound(round, 'HOST', {
      type: 'MESSAGE',
      text: 'Ja, dort können wir sitzen.',
    });
    round = advancePlayRound(round, 'GUEST', { type: 'MISSION_DONE', achieved: true });
    expect(round).toMatchObject({
      phase: 'FEEDBACK',
      revealed: true,
      outcomes: { HOST: true, GUEST: true },
    });
  });

  it.each(['DESCRIBE', 'MISSION', 'KNOW_ME'] as const)(
    'allows bounded hints and a skip with no points in %s',
    (mode) => {
      let round = start(mode);
      for (const seat of ['HOST', 'GUEST', 'HOST'] as const)
        round = advancePlayRound(round, seat, { type: 'HINT', text: 'Try a short sentence.' });
      expect(round.result).toBeNull();
      expect(() => advancePlayRound(round, 'HOST', { type: 'HINT', text: 'One more' })).toThrow(
        PlayRuleError
      );
      round = advancePlayRound(round, 'GUEST', { type: 'SKIP' });
      expect(round.result).toEqual({
        points: 0,
        skipped: true,
        understood: null,
        matched: null,
        correction: null,
      });
      expect(round.revealed).toBe(false);
      expect(() => advancePlayRound(round, 'HOST', { type: 'SKIP' })).toThrow(PlayRuleError);
    }
  );

  it('keeps hint-assisted successful rounds worth the same shared points', () => {
    let round = start('KNOW_ME');
    round = advancePlayRound(round, 'GUEST', { type: 'HINT', text: 'Think about a quiet place.' });
    round = advancePlayRound(round, 'HOST', { type: 'ANSWER', text: 'The park' });
    round = advancePlayRound(round, 'GUEST', { type: 'ANSWER', text: 'The park' });
    round = advancePlayRound(round, 'GUEST', {
      type: 'FEEDBACK',
      understood: true,
      correction: null,
    });
    expect(round.result?.points).toBe(2);
  });

  it('rejects corrupt persisted results and unsupported state versions', () => {
    expect(() => readPrivatePlayRound({ ...start('MISSION'), version: 2 })).toThrow(PlayRuleError);
    expect(() =>
      readPrivatePlayRound({ ...start('KNOW_ME'), phase: 'FINISHED', result: null })
    ).toThrow(PlayRuleError);
    expect(() => readPrivatePlayRound({ ...start('DESCRIBE'), phase: 'GUESS' })).toThrow(
      PlayRuleError
    );
  });
});
