import { describe, expect, it } from 'vitest';
import {
  createPlayRoomSchema,
  playRoundActionRequestSchema,
  playRoundCommandSchema,
  playStoredRoundViewSchema,
  requestPlayJoinSchema,
} from '../../src';

const settings = { nativeLang: 'es', targetLang: 'de', level: 'A1' };
const actionId = '46ea8266-bfde-4316-ad7a-5b405a8ae18f';

describe('cross-client play inputs', () => {
  it('accepts complete word, phrase and sentence turns without truncating them', () => {
    for (const text of ['Regenschirm', 'nach Hause', 'Ich würde gern mit dir kochen.'])
      expect(playRoundCommandSchema.parse({ type: 'ANSWER', text })).toEqual({
        type: 'ANSWER',
        text,
      });
    expect(
      playRoundCommandSchema.safeParse({ type: 'ANSWER', text: 'x'.repeat(501) }).success
    ).toBe(false);
    expect(playRoundCommandSchema.safeParse({ type: 'ANSWER', text: '  ' }).success).toBe(false);
  });

  it('binds actions to a client identity and displayed revision without accepting score or actor overrides', () => {
    const request = { actionId, expectedRevision: 3, command: { type: 'GUESS', text: 'Schirm' } };
    expect(playRoundActionRequestSchema.parse(request)).toEqual(request);
    expect(playRoundActionRequestSchema.safeParse({ ...request, actor: 'HOST' }).success).toBe(
      false
    );
    expect(
      playRoundActionRequestSchema.safeParse({ ...request, expectedRevision: -1 }).success
    ).toBe(false);
    expect(
      playRoundActionRequestSchema.safeParse({
        ...request,
        command: { ...request.command, points: 2 },
      }).success
    ).toBe(false);
  });

  it('creates a game without a course or provider configuration while requiring a real language direction', () => {
    const input = { actionId, kind: 'MIXED', theme: 'FOOD', settings };
    expect(createPlayRoomSchema.parse(input)).toEqual(input);
    expect(
      createPlayRoomSchema.safeParse({ ...input, settings: { ...settings, targetLang: 'es' } })
        .success
    ).toBe(false);
  });

  it('requires explicit consent for a new profile and never accepts a caller-selected learner ID', () => {
    const request = {
      requestId: actionId,
      code: 'ABCDEFGHJKLM',
      client: 'NATIVE',
      deviceName: 'Partner phone',
      candidate: { kind: 'NEW', name: 'Marta', settings, consentToProfile: true },
    };
    expect(requestPlayJoinSchema.parse(request)).toEqual(request);
    expect(
      requestPlayJoinSchema.safeParse({
        ...request,
        candidate: { ...request.candidate, consentToProfile: false },
      }).success
    ).toBe(false);
    expect(
      requestPlayJoinSchema.safeParse({
        ...request,
        candidate: { ...request.candidate, userId: 'owner' },
      }).success
    ).toBe(false);
    expect(
      requestPlayJoinSchema.safeParse({
        ...request,
        candidate: { kind: 'EXISTING', userId: 'someone-else', settings },
      }).success
    ).toBe(false);
  });

  it('requires server round provenance while preserving strict hidden-answer projections', () => {
    const round = {
      id: 'server-round-id',
      order: 0,
      learner: 'HOST',
      targetLang: 'de',
      supportLang: 'en',
      level: 'A1',
      prompt: 'Describe something nearby.',
      guidance: 'Use a short clue.',
      phase: 'GUESS',
      role: 'PARTNER',
      instruction: 'Guess the secret word.',
      revealed: false,
      allowedActions: ['GUESS', 'SKIP', 'HINT'],
      hints: [],
      result: null,
      mode: 'DESCRIBE',
      target: null,
      clue: 'It keeps the rain away.',
      guess: null,
    };
    expect(playStoredRoundViewSchema.parse(round)).toEqual(round);
    expect(playStoredRoundViewSchema.safeParse({ ...round, id: undefined }).success).toBe(false);
    expect(
      playStoredRoundViewSchema.safeParse({ ...round, privateState: { target: 'Schirm' } }).success
    ).toBe(false);
  });
});
