import { describe, expect, it } from 'vitest';
import type { PlaySeat, PlayTheme } from '@sotto/shared';
import { advancePlayRound, createPlayRounds } from '@/lib/play/engine';
import { PlayRuleError } from '@/lib/play/errors';
import { projectPlayRound } from '@/lib/play/projection';

const players = {
  HOST: { nativeLang: 'es', targetLang: 'de', level: 'A1' as const },
  GUEST: { nativeLang: 'de', targetLang: 'es', level: 'B2' as const },
};
const setup = () => createPlayRounds({ kind: 'KNOW_ME', theme: 'FOOD', players });

describe('quick prediction cards', () => {
  it('opens a mixed game with quick private picks before describing and conversation', () => {
    const rounds = createPlayRounds({ kind: 'MIXED', theme: 'EVERYDAY', players });
    expect(rounds.slice(0, 2).map((round) => round.mode)).toEqual(['KNOW_ME', 'KNOW_ME']);
    for (const round of rounds.slice(0, 2))
      expect(projectPlayRound(round, round.learner).allowedActions).toContain('CHOOSE');
  });

  it('defaults to concrete target-language choices with optional support meanings', () => {
    const [german, spanish] = setup();
    expect(projectPlayRound(german, 'HOST')).toMatchObject({
      questionStyle: 'CHOICES',
      choices: expect.arrayContaining([
        { id: 'B', text: 'Suppe', supportText: 'Sopa', symbol: '🍲' },
      ]),
      allowedActions: expect.arrayContaining(['CHOOSE']),
    });
    expect(projectPlayRound(spanish, 'GUEST')).toMatchObject({
      choices: expect.arrayContaining([
        { id: 'B', text: 'Sopa', supportText: 'Suppe', symbol: '🍲' },
      ]),
    });
    expect(projectPlayRound(german, 'HOST').allowedActions).not.toContain('ANSWER');
  });

  it.each(['HOST', 'GUEST'] as const)(
    'does not reveal %s’s pick through any part of the other view',
    (first) => {
      const viewer = first === 'HOST' ? 'GUEST' : 'HOST';
      const round = setup()[0];
      const a = advancePlayRound(round, first, { type: 'CHOOSE', optionId: 'A' });
      const b = advancePlayRound(round, first, { type: 'CHOOSE', optionId: 'B' });
      expect(projectPlayRound(a, viewer)).toEqual(projectPlayRound(b, viewer));
      expect(projectPlayRound(a, viewer)).toMatchObject({
        otherCommitted: true,
        otherAnswer: null,
        result: null,
      });
      expect(() => advancePlayRound(a, first, { type: 'CHOOSE', optionId: 'D' })).toThrow(
        PlayRuleError
      );
    }
  );

  it.each(['HOST', 'GUEST'] as const)(
    'reveals and finishes after two picks when %s is the learner',
    (learner) => {
      const round = setup().find((candidate) => candidate.learner === learner);
      if (!round) throw new Error('Missing round');
      const first = advancePlayRound(round, learner, { type: 'CHOOSE', optionId: 'C' });
      const partner: PlaySeat = learner === 'HOST' ? 'GUEST' : 'HOST';
      const finished = advancePlayRound(first, partner, { type: 'CHOOSE', optionId: 'C' });
      expect(finished).toMatchObject({
        phase: 'FINISHED',
        revealed: true,
        result: { matched: true, points: 2, understood: null },
      });
      expect(projectPlayRound(finished, learner)).toMatchObject({
        ownAnswer: 'C',
        otherAnswer: 'C',
        allowedActions: [],
      });
      expect(() => advancePlayRound(finished, partner, { type: 'CHOOSE', optionId: 'D' })).toThrow(
        PlayRuleError
      );
    }
  );

  it('makes a mismatch a visible result without claiming incorrect language or mastery', () => {
    const first = advancePlayRound(setup()[0], 'HOST', { type: 'CHOOSE', optionId: 'A' });
    const finished = advancePlayRound(first, 'GUEST', { type: 'CHOOSE', optionId: 'B' });
    expect(finished.result).toEqual({
      matched: false,
      points: 1,
      understood: null,
      correction: null,
      skipped: false,
    });
  });

  it('keeps a pick private if the other player skips', () => {
    const first = advancePlayRound(setup()[0], 'HOST', { type: 'CHOOSE', optionId: 'A' });
    const skipped = advancePlayRound(first, 'GUEST', { type: 'SKIP' });
    expect(projectPlayRound(skipped, 'GUEST')).toMatchObject({
      otherAnswer: null,
      revealed: false,
      result: { skipped: true, points: 0 },
    });
  });

  it.each(['en', 'de', 'es', 'fr', 'pt', 'it', 'ja', 'zh', 'ko'])(
    'offers distinct choice meanings for every theme in %s',
    (targetLang) => {
      for (const theme of [
        'EVERYDAY',
        'FOOD',
        'TRAVEL',
        'SILLY',
        'GET_TO_KNOW_YOU',
        'AFFECTIONATE',
      ] satisfies PlayTheme[]) {
        const round = createPlayRounds({
          kind: 'KNOW_ME',
          theme,
          players: {
            ...players,
            HOST: { nativeLang: targetLang === 'en' ? 'de' : 'en', targetLang, level: 'A1' },
          },
        })[0];
        if (round.mode !== 'KNOW_ME') throw new Error('Missing choice round');
        expect(new Set(round.choices.map((choice) => choice.text)).size).toBe(4);
      }
    }
  );

  it('supports open questions explicitly and rejects unsupported card languages without switching modes', () => {
    const config = {
      kind: 'KNOW_ME' as const,
      theme: 'TRAVEL' as const,
      players: { ...players, HOST: { nativeLang: 'en', targetLang: 'nl', level: 'A2' as const } },
    };
    expect(() => createPlayRounds(config)).toThrow(PlayRuleError);
    const open = createPlayRounds({ ...config, questionStyle: 'OPEN' })[0];
    expect(projectPlayRound(open, 'HOST')).toMatchObject({
      questionStyle: 'OPEN',
      choices: [],
      allowedActions: expect.arrayContaining(['ANSWER']),
    });
  });
});
