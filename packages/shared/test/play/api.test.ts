import { describe, expect, it } from 'vitest';
import { playActionRequestSchema, playPageQuerySchema, savePlayPhraseSchema } from '../../src';

describe('bounded Play API requests', () => {
  it('accepts bounded string page sizes and rejects unbounded or unknown parameters', () => {
    expect(playPageQuerySchema.parse({ limit: '12', beforeId: 'owned-phrase' })).toEqual({
      limit: 12,
      beforeId: 'owned-phrase',
    });
    for (const input of [
      { limit: '0' },
      { limit: '51' },
      { limit: 'NaN' },
      { limit: '2.5' },
      { ownerId: 'someone-else' },
    ])
      expect(playPageQuerySchema.safeParse(input).success).toBe(false);
  });

  it('requires revision and idempotency for both room actions and round commands', () => {
    const actionId = '1f413a64-eb31-4221-b922-184475eac8b4';
    for (const input of [{ type: 'START' }, { command: { type: 'CHOOSE', optionId: 'B' } }]) {
      expect(
        playActionRequestSchema.safeParse({ ...input, actionId, expectedRevision: 3 }).success
      ).toBe(true);
      expect(playActionRequestSchema.safeParse({ ...input, actionId }).success).toBe(false);
      expect(playActionRequestSchema.safeParse({ ...input, expectedRevision: 3 }).success).toBe(
        false
      );
    }
  });

  it('requires explicit room and round provenance for notebook selections', () => {
    const phrase = {
      roomId: 'game',
      roundId: 'round',
      kind: 'SENTENCE',
      text: 'Ein Kaffee, bitte.',
      contextText: null,
    };
    expect(savePlayPhraseSchema.parse(phrase)).toEqual(phrase);
    expect(savePlayPhraseSchema.safeParse({ ...phrase, roomId: undefined }).success).toBe(false);
    expect(savePlayPhraseSchema.safeParse({ ...phrase, roundId: undefined }).success).toBe(false);
    expect(savePlayPhraseSchema.safeParse({ ...phrase, userId: 'other-player' }).success).toBe(
      false
    );
  });
});
