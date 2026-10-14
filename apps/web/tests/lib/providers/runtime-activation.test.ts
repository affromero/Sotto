// @vitest-environment node
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertProviderActivated,
  ProviderActivationPendingError,
} from '@/lib/providers/shared/runtime-activation';

describe('provider activation during a runtime upgrade', () => {
  let directory: string;
  let path: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sotto-provider-activation-'));
    path = join(directory, 'fish.json');
    vi.stubEnv('SOTTO_PROVIDER_ACTIVATION_FILE', path);
    vi.stubEnv('SOTTO_RELEASE_SHA', 'a'.repeat(40));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it('allows ordinary installs only when the gate variable is absent', () => {
    vi.stubEnv('SOTTO_PROVIDER_ACTIVATION_FILE', undefined);
    expect(() => assertProviderActivated('fish')).not.toThrow();
    vi.stubEnv('SOTTO_PROVIDER_ACTIVATION_FILE', '');
    expect(() => assertProviderActivated('fish')).toThrow(ProviderActivationPendingError);
  });

  it('blocks Fish until the exact release is enabled and rereads every request', () => {
    writeFileSync(path, JSON.stringify({ releaseSha: 'a'.repeat(40), fishEnabled: false }));
    expect(() => assertProviderActivated('fish')).toThrow(ProviderActivationPendingError);
    expect(() => assertProviderActivated('cartesia')).not.toThrow();
    writeFileSync(path, JSON.stringify({ releaseSha: 'a'.repeat(40), fishEnabled: true }));
    expect(() => assertProviderActivated('fish')).not.toThrow();
    writeFileSync(path, JSON.stringify({ releaseSha: 'b'.repeat(40), fishEnabled: true }));
    expect(() => assertProviderActivated('fish')).toThrow(ProviderActivationPendingError);
  });

  it.each(['missing', 'malformed', 'oversized', 'symlink'])(
    'fails closed when the activation file is %s',
    (kind) => {
      if (kind === 'malformed') writeFileSync(path, '{}');
      if (kind === 'oversized') writeFileSync(path, ' '.repeat(1025));
      if (kind === 'symlink') {
        const target = join(directory, 'target.json');
        writeFileSync(target, JSON.stringify({ releaseSha: 'a'.repeat(40), fishEnabled: true }));
        symlinkSync(target, path);
      }
      expect(() => assertProviderActivated('fish')).toThrow(ProviderActivationPendingError);
    }
  );
});
