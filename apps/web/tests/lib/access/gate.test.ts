import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  accessPasswordConfigured,
  verifyAccessPassword,
  createGateToken,
  verifyGateToken,
  createInviteToken,
  verifyInviteToken,
} from '@/lib/access/gate';

const ORIGINAL_ENV = { ...process.env };

describe('access-gate', () => {
  beforeEach(() => {
    process.env.BYOK_ENCRYPTION_KEY = 'test-signing-key-material-0123456789abcdef';
    process.env.SOTTO_ACCESS_PASSWORD = 'family-secret';
  });

  afterEach(() => {
    process.env.BYOK_ENCRYPTION_KEY = ORIGINAL_ENV.BYOK_ENCRYPTION_KEY;
    process.env.SOTTO_ACCESS_PASSWORD = ORIGINAL_ENV.SOTTO_ACCESS_PASSWORD;
    if (!ORIGINAL_ENV.SOTTO_ACCESS_PASSWORD) delete process.env.SOTTO_ACCESS_PASSWORD;
  });

  describe('password', () => {
    it('is configured only when the env var is set', () => {
      expect(accessPasswordConfigured()).toBe(true);
      delete process.env.SOTTO_ACCESS_PASSWORD;
      expect(accessPasswordConfigured()).toBe(false);
    });

    it('accepts the configured password and rejects others', async () => {
      expect(await verifyAccessPassword('family-secret')).toBe(true);
      expect(await verifyAccessPassword('wrong')).toBe(false);
      expect(await verifyAccessPassword('')).toBe(false);
    });

    it('rejects every password when none is configured', async () => {
      delete process.env.SOTTO_ACCESS_PASSWORD;
      expect(await verifyAccessPassword('family-secret')).toBe(false);
    });
  });

  describe('gate tokens', () => {
    it('round-trips a freshly created token', async () => {
      const token = await createGateToken();
      expect(token).toBeTruthy();
      expect(await verifyGateToken(token ?? undefined)).toBe(true);
    });

    it('rejects missing, malformed, and tampered tokens', async () => {
      expect(await verifyGateToken(undefined)).toBe(false);
      expect(await verifyGateToken('')).toBe(false);
      expect(await verifyGateToken('not-a-token')).toBe(false);

      const token = (await createGateToken())!;
      const [expiry, sig] = token.split('.');
      expect(await verifyGateToken(`${expiry}.${'0'.repeat(sig.length)}`)).toBe(false);
      // Extending the expiry without re-signing must fail.
      expect(await verifyGateToken(`${Number(expiry) + 60_000}.${sig}`)).toBe(false);
    });

    it('rejects expired tokens', async () => {
      const token = (await createGateToken())!;
      const sig = token.slice(token.indexOf('.') + 1);
      expect(await verifyGateToken(`${Date.now() - 1000}.${sig}`)).toBe(false);
    });

    it('cannot create or verify tokens without the signing key', async () => {
      delete process.env.BYOK_ENCRYPTION_KEY;
      expect(await createGateToken()).toBeNull();
      expect(await verifyGateToken('123.abc')).toBe(false);
    });
  });

  describe('invite tokens', () => {
    it('round-trips and is scope-bound (an invite is not a gate cookie)', async () => {
      const invite = (await createInviteToken())!;
      expect(await verifyInviteToken(invite)).toBe(true);
      expect(await verifyGateToken(invite)).toBe(false);

      const gate = (await createGateToken())!;
      expect(await verifyInviteToken(gate)).toBe(false);
    });
  });
});
