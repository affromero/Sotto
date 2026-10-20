import { describe, expect, it } from 'vitest';
import type { PlayGameConfig, PlayMode } from '@sotto/shared';
import { advancePlayRound, createPlayRounds, readPrivatePlayRound } from '@/lib/play/engine';
import { PlayRuleError } from '@/lib/play/errors';
import { projectPlayRound } from '@/lib/play/projection';

const config: PlayGameConfig = {
  kind: 'MIXED',
  theme: 'FOOD',
  questionStyle: 'OPEN',
  players: {
    HOST: { nativeLang: 'es', targetLang: 'de', level: 'A1' },
    GUEST: { nativeLang: 'de', targetLang: 'es', level: 'B2' },
  },
};
function start(kind: PlayMode) {
  return createPlayRounds({ ...config, kind })[0];
}

describe('private round projection', () => {
  it('asks one person about themselves and the learner to predict that same answer', () => {
    const round = start('KNOW_ME');
    const learner = projectPlayRound(round, 'HOST');
    const partner = projectPlayRound(round, 'GUEST');
    expect(learner.instruction).toMatch(/predict/i);
    expect(partner.instruction).toMatch(/about yourself/i);
    expect(learner.prompt).toBe(partner.prompt);
  });

  it('withholds the secret target from the guessing partner until they commit a guess', () => {
    let round = advancePlayRound(start('DESCRIBE'), 'HOST', {
      type: 'SET_TARGET',
      text: 'Regenschirm',
    });
    expect(projectPlayRound(round, 'HOST')).toMatchObject({
      target: 'Regenschirm',
      role: 'LEARNER',
    });
    expect(JSON.stringify(projectPlayRound(round, 'GUEST'))).not.toContain('Regenschirm');
    round = advancePlayRound(round, 'HOST', { type: 'GIVE_CLUE', text: 'Er hält dich trocken.' });
    expect(projectPlayRound(round, 'GUEST')).toMatchObject({
      clue: 'Er hält dich trocken.',
      target: null,
    });
    round = advancePlayRound(round, 'GUEST', { type: 'GUESS', text: 'Ein Schirm?' });
    for (const viewer of ['HOST', 'GUEST'] as const)
      expect(projectPlayRound(round, viewer)).toMatchObject({
        target: 'Regenschirm',
        guess: 'Ein Schirm?',
        revealed: true,
      });
  });

  it.each(['HOST', 'GUEST'] as const)(
    'keeps %s’s committed answer private until both answers exist',
    (author) => {
      const other = author === 'HOST' ? 'GUEST' : 'HOST';
      let round = advancePlayRound(start('KNOW_ME'), author, {
        type: 'ANSWER',
        text: 'Mein geheimer Lieblingsort',
      });
      const before = projectPlayRound(round, other);
      expect(before).toMatchObject({ otherCommitted: true, ownAnswer: null, otherAnswer: null });
      expect(JSON.stringify(before)).not.toContain('Mein geheimer Lieblingsort');
      expect(projectPlayRound(round, author)).toMatchObject({
        ownAnswer: 'Mein geheimer Lieblingsort',
        otherCommitted: false,
      });
      round = advancePlayRound(round, other, { type: 'ANSWER', text: 'Ein anderer Ort' });
      expect(projectPlayRound(round, other)).toMatchObject({
        otherAnswer: 'Mein geheimer Lieblingsort',
        revealed: true,
      });
    }
  );

  it('does not expose a committed private answer when the other player skips instead of answering', () => {
    let round = advancePlayRound(start('KNOW_ME'), 'GUEST', {
      type: 'ANSWER',
      text: 'Private answer without consent to reveal',
    });
    round = advancePlayRound(round, 'HOST', { type: 'SKIP' });
    const view = projectPlayRound(round, 'HOST');
    expect(view).toMatchObject({ revealed: false, result: { skipped: true, points: 0 } });
    expect(JSON.stringify(view)).not.toContain('Private answer without consent to reveal');
  });

  it('shows only the viewer’s mission and keeps their partner’s outcome private until both finish', () => {
    let round = start('MISSION');
    if (round.mode !== 'MISSION') throw new Error('Missing mission fixture');
    const privateObjectives = { HOST: round.objectives.HOST, GUEST: round.objectives.GUEST };
    expect(JSON.stringify(projectPlayRound(round, 'HOST'))).not.toContain(privateObjectives.GUEST);
    expect(JSON.stringify(projectPlayRound(round, 'GUEST'))).not.toContain(privateObjectives.HOST);
    round = advancePlayRound(round, 'HOST', {
      type: 'MESSAGE',
      text: 'Wir haben zwanzig Minuten.',
    });
    round = advancePlayRound(round, 'GUEST', { type: 'MESSAGE', text: 'Dann kochen wir Gemüse.' });
    round = advancePlayRound(round, 'HOST', { type: 'MESSAGE', text: 'Ein Freund kommt mit.' });
    round = advancePlayRound(round, 'GUEST', { type: 'MESSAGE', text: 'Wir haben genug Gemüse.' });
    round = advancePlayRound(round, 'HOST', { type: 'MISSION_DONE', achieved: true });
    expect(projectPlayRound(round, 'HOST')).toMatchObject({ ownOutcome: true, otherOutcome: null });
    expect(projectPlayRound(round, 'GUEST')).toMatchObject({
      ownOutcome: null,
      otherOutcome: null,
    });
    round = advancePlayRound(round, 'GUEST', { type: 'MISSION_DONE', achieved: false });
    expect(projectPlayRound(round, 'HOST')).toMatchObject({
      otherObjective: privateObjectives.GUEST,
      otherOutcome: false,
      revealed: true,
    });
    expect(projectPlayRound(round, 'GUEST')).toMatchObject({
      otherObjective: privateObjectives.HOST,
      otherOutcome: true,
      revealed: true,
    });
  });

  it('preserves already revealed content after a skip without awarding points', () => {
    let round = start('KNOW_ME');
    round = advancePlayRound(round, 'HOST', { type: 'ANSWER', text: 'Spazieren gehen' });
    round = advancePlayRound(round, 'GUEST', { type: 'ANSWER', text: 'Im Park laufen' });
    round = advancePlayRound(round, 'HOST', { type: 'SKIP' });
    expect(projectPlayRound(round, 'HOST')).toMatchObject({
      revealed: true,
      otherAnswer: 'Im Park laufen',
      result: { points: 0 },
    });
  });

  it('fails closed on an invalid viewer or a forged early reveal instead of projecting private data', () => {
    const round = start('MISSION');
    expect(() => Reflect.apply(projectPlayRound, undefined, [round, 'STRANGER'])).toThrow();
    expect(() => projectPlayRound({ ...round, revealed: true }, 'HOST')).toThrow(PlayRuleError);
    expect(() => readPrivatePlayRound({ ...round, internalToken: 'must never escape' })).toThrow(
      PlayRuleError
    );
  });

  it('returns detached public data so mutating a view cannot change saved game material', () => {
    let round = start('MISSION');
    round = advancePlayRound(round, 'HOST', { type: 'MESSAGE', text: 'Original message' });
    const view = projectPlayRound(round, 'GUEST');
    if (view.mode !== 'MISSION' || round.mode !== 'MISSION')
      throw new Error('Missing mission fixture');
    view.messages[0].text = 'Changed on the client';
    expect(round.messages[0].text).toBe('Original message');
    expect(view).not.toHaveProperty('version');
    expect(view).not.toHaveProperty('objectives');
  });

  it('rejects impossible skipped material instead of publishing its retained fields', () => {
    const skipped = {
      phase: 'FINISHED',
      revealed: false,
      result: { skipped: true, understood: null, matched: null, correction: null, points: 0 },
    };
    expect(() =>
      projectPlayRound(
        {
          ...start('DESCRIBE'),
          ...skipped,
          target: null,
          clue: 'Impossible clue',
          guess: 'Impossible guess',
        },
        'HOST'
      )
    ).toThrow(PlayRuleError);
    expect(() =>
      projectPlayRound(
        {
          ...start('KNOW_ME'),
          ...skipped,
          answers: { HOST: 'Already answered', GUEST: 'Already answered' },
        },
        'HOST'
      )
    ).toThrow(PlayRuleError);
    expect(() =>
      projectPlayRound(
        {
          ...start('MISSION'),
          ...skipped,
          messages: [
            { seat: 'HOST', text: 'Hello' },
            { seat: 'GUEST', text: 'Hello' },
          ],
          outcomes: { HOST: true, GUEST: false },
        },
        'HOST'
      )
    ).toThrow(PlayRuleError);
  });
});
