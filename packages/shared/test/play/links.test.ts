import { describe, expect, it } from 'vitest';
import {
  createPlayAppLink,
  createPlayInviteLink,
  formatPlayInviteCode,
  normalizePlayInviteCode,
  parsePlayInviteLink,
  playInviteEnvelopeSchema,
} from '../../src';

const code = 'ABCDEFGHJKLM';
const envelope = { version: 1 as const, serverUrl: 'https://learn.example:8443', code };

describe('game invitation links', () => {
  it('carries a self-hosted server and human code through web, QR and native opening', () => {
    const link = createPlayInviteLink('https://learn.example:8443/', 'abcd-efgh-jklm');
    expect(parsePlayInviteLink(link)).toEqual(envelope);
    expect(parsePlayInviteLink(createPlayAppLink(envelope))).toEqual(envelope);
    expect(formatPlayInviteCode(code)).toBe('ABCD-EFGH-JKLM');
    expect(normalizePlayInviteCode(' abcd efgh jklm ')).toBe(code);
  });

  it('allows a controlled verified-link bridge without replacing the inviting host', () => {
    const query = new URLSearchParams({ v: '1', server: envelope.serverUrl, code });
    expect(parsePlayInviteLink(`https://sotto.fm/play/join?${query}`)).toEqual(envelope);
    expect(parsePlayInviteLink(`https://untrusted.example/play/join?${query}`)).toBeNull();
  });

  it.each([
    `https://learn.example/play/join?v=2&code=${code}`,
    `https://learn.example/play/join?v=1&v=1&code=${code}`,
    `https://learn.example/play/join?v=1&code=${code}&code=${code}`,
    `https://learn.example/play/join?v=1&code=${code}&token=pairing-secret`,
    `https://learn.example/connect?token=${code}`,
    `https://learn.example/play/join?v=1&code=${code}#credential`,
    `https://name:password@learn.example/play/join?v=1&code=${code}`,
    `sotto://play/join?v=1&code=${code}`,
    `sotto://different/join?v=1&server=https%3A%2F%2Flearn.example&code=${code}`,
    `sotto://play/join?v=1&server=javascript%3Aalert(1)&code=${code}`,
    `sotto://play/join?v=1&server=https%3A%2F%2Flearn.example%2Fprivate&code=${code}`,
    `https://learn.example/play/join?v=1&code=ABCD0123JKLM`,
  ])('rejects malformed, ambiguous or credential-bearing invitation %s', (link) => {
    expect(parsePlayInviteLink(link)).toBeNull();
  });

  it('preserves explicit local addresses for each client’s own network policy', () => {
    const link = createPlayInviteLink('http://192.168.1.8:3000', code);
    expect(parsePlayInviteLink(link)).toMatchObject({ serverUrl: 'http://192.168.1.8:3000' });
  });

  it('rejects oversized input and keeps device-pairing payloads out of game creation', () => {
    expect(parsePlayInviteLink('x'.repeat(4097))).toBeNull();
    expect(() => createPlayInviteLink('https://host.example?token=secret', code)).toThrow();
    expect(() => createPlayInviteLink('https://host.example', 'invalid')).toThrow();
    expect(() =>
      createPlayAppLink({ ...envelope, serverUrl: 'https://user:secret@host.example' })
    ).toThrow();
  });

  it.each([
    'javascript:alert(1)',
    'https://user:password@host.example',
    'https://host.example/private',
    'https://host.example?token=secret',
    'https://host.example#secret',
  ])('rejects unsafe restored invitation server %s', (serverUrl) => {
    expect(playInviteEnvelopeSchema.safeParse({ ...envelope, serverUrl }).success).toBe(false);
  });
});
