import { describe, expect, it } from 'vitest';
import { playPresenceInputSchema, playMemberSchema, playInvitationPreviewSchema } from '../../src';

describe('foreground room-view leases', () => {
  it('requires an independent unguessable view nonce without accepting a claimed presence flag', () => {
    const viewNonce = 'a'.repeat(43);
    expect(playPresenceInputSchema.parse({ type: 'RENEW', viewNonce })).toEqual({
      type: 'RENEW',
      viewNonce,
    });
    expect(playPresenceInputSchema.safeParse({ type: 'RENEW', viewNonce: 'room-id' }).success).toBe(
      false
    );
    expect(
      playPresenceInputSchema.safeParse({ type: 'RENEW', viewNonce, isPresent: true }).success
    ).toBe(false);
  });

  it('preserves existing canonical profile names up to 100 characters in player projections', () => {
    const member = {
      id: 'existing-member',
      name: '長'.repeat(100),
      settings: { nativeLang: 'es', targetLang: 'de', level: 'A1' },
    };
    expect(playMemberSchema.parse(member).name).toBe(member.name);
  });

  it('rejects private candidate and claimant data in a public invitation preview', () => {
    const preview = {
      roomId: 'game',
      hostName: 'Host',
      kind: 'MIXED',
      theme: 'FOOD',
      questionStyle: 'CHOICES',
      hostWaiting: false,
      expiresAt: '2026-10-20T17:00:00.000Z',
      serverTime: '2026-10-20T16:00:00.000Z',
    };
    expect(playInvitationPreviewSchema.parse(preview)).toEqual(preview);
    expect(
      playInvitationPreviewSchema.safeParse({ ...preview, proofHash: 'private-claimant-binding' })
        .success
    ).toBe(false);
    expect(
      playInvitationPreviewSchema.safeParse({
        ...preview,
        pendingCandidates: [{ name: 'Someone else' }],
      }).success
    ).toBe(false);
  });
});
