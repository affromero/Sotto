// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { newToken, tokenHash } from 'thesidedoor-core/access';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayRuleError } from '@/lib/play/errors';
import {
  openPlayDelivery,
  sealPlayDelivery,
  type PlayDeliveryBinding,
  type PlayDeliveryEnvelope,
} from '@/lib/play/admission/delivery-receipt';

afterEach(() => vi.unstubAllEnvs());

function fixture(native: boolean) {
  vi.stubEnv('BYOK_ENCRYPTION_KEY', 'private-play-delivery-test-key');
  const binding: PlayDeliveryBinding = {
    version: 1,
    instanceId: randomUUID(),
    roomId: randomUUID(),
    requestId: randomUUID(),
    profileId: randomUUID(),
    deliveryId: randomUUID(),
    claimantProofHash: tokenHash(newToken()),
    enrollmentGeneration: 1,
  };
  const token = newToken();
  const common = {
    deliveryId: binding.deliveryId,
    roomId: binding.roomId,
    profile: {
      id: binding.profileId,
      name: 'New partner',
      settings: { nativeLang: 'es', targetLang: 'de', level: 'A1' as const },
    },
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const envelope: PlayDeliveryEnvelope = {
    version: 1,
    response: native ? { ...common, kind: 'NATIVE', token } : { ...common, kind: 'BROWSER' },
    browserSessionToken: native ? null : token,
    credentialId: tokenHash(token),
  };
  return { binding, envelope, token };
}

describe('encrypted exact play credential delivery', () => {
  it.each([false, true])(
    'recovers the exact %s native envelope without retaining plaintext credentials',
    (native) => {
      const { binding, envelope, token } = fixture(native);
      const state = sealPlayDelivery(binding, envelope);
      expect(JSON.stringify(state)).not.toContain(token);
      expect(JSON.stringify(state)).not.toContain('New partner');
      expect(openPlayDelivery(binding, state)).toEqual(envelope);
      expect(openPlayDelivery(binding, state)).toEqual(envelope);
      if (!native) expect(JSON.stringify(envelope.response)).not.toContain(token);
    }
  );

  it('rejects ciphertext transplanted to any other instance, room, request, profile, delivery, claimant or generation', () => {
    const { binding, envelope } = fixture(true);
    const state = sealPlayDelivery(binding, envelope);
    const changes = [
      { instanceId: randomUUID() },
      { roomId: randomUUID() },
      { requestId: randomUUID() },
      { profileId: randomUUID() },
      { deliveryId: randomUUID() },
      { claimantProofHash: tokenHash(newToken()) },
      { enrollmentGeneration: 2 },
    ];
    for (const change of changes)
      expect(() => openPlayDelivery({ ...binding, ...change }, state)).toThrow();
  });

  it('fails explicitly with missing or rotated encryption keys while preserving the original receipt', () => {
    const { binding, envelope } = fixture(false);
    const state = sealPlayDelivery(binding, envelope);
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '');
    expect(() => openPlayDelivery(binding, state)).toThrow();
    expect(() => sealPlayDelivery(binding, envelope)).toThrow();
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'a-different-test-key');
    expect(() => openPlayDelivery(binding, state)).toThrow();
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'private-play-delivery-test-key');
    expect(openPlayDelivery(binding, state)).toEqual(envelope);
  });

  it('rejects a browser session hidden in native credential delivery', () => {
    const { binding, envelope } = fixture(true);
    expect(() =>
      sealPlayDelivery(binding, { ...envelope, browserSessionToken: newToken() })
    ).toThrow(PlayRuleError);
  });

  it('rejects inconsistent member bindings and token hashes before sealing', () => {
    const { binding, envelope } = fixture(false);
    const invalid = [
      { ...envelope, credentialId: tokenHash(newToken()) },
      { ...envelope, browserSessionToken: null },
      {
        ...envelope,
        response: {
          ...envelope.response,
          profile: { ...envelope.response.profile, id: randomUUID() },
        },
      },
      { ...envelope, response: { ...envelope.response, roomId: randomUUID() } },
      { ...envelope, response: { ...envelope.response, deliveryId: randomUUID() } },
    ];
    for (const value of invalid) expect(() => sealPlayDelivery(binding, value)).toThrow();
  });
});
