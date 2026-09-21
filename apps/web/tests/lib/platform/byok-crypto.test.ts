import { afterEach, expect, it, vi } from 'vitest';
import { CredentialCodec, initialCredentialState } from 'thesidedoor-core/configuration';
import { deriveOwnedCredentialKey } from '@/lib/credentials/byok-crypto';

afterEach(() => vi.unstubAllEnvs());

it('uses the required BYOK secret for owned credentials without defaulting a missing secret', () => {
  vi.stubEnv('BYOK_ENCRYPTION_KEY', '');
  expect(() => deriveOwnedCredentialKey()).toThrow(/BYOK_ENCRYPTION_KEY/);
});

it('keeps owned ciphertext bound to its owner and configured secret', () => {
  vi.stubEnv('BYOK_ENCRYPTION_KEY', 'owned-credential-test-secret');
  const descriptors = () => [
    {
      id: 'test',
      label: 'Test',
      transport: 'api' as const,
      capabilities: [],
      models: [],
      fields: [
        { id: 'apiKey', label: 'Key', kind: 'string' as const, required: true, secret: true },
      ],
    },
  ];
  const codec = new CredentialCodec({
    namespace: 'profile:alice',
    encryptionKey: deriveOwnedCredentialKey,
    descriptors,
  });
  const state = initialCredentialState();
  codec.configureState(state, 'test', { apiKey: 'private-test-key' });
  expect(codec.resolveState(state, 'test').apiKey).toBe('private-test-key');
  const other = new CredentialCodec({
    namespace: 'profile:bob',
    encryptionKey: deriveOwnedCredentialKey,
    descriptors,
  });
  expect(() => other.resolveState(state, 'test')).toThrow();
  vi.stubEnv('BYOK_ENCRYPTION_KEY', 'different-test-secret');
  expect(() => codec.resolveState(state, 'test')).toThrow();
});
