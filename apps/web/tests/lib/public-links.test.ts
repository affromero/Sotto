import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPublicDiscordUrl,
  getPublicGithubUrl,
  getVerificationStandardUrl,
} from '@/lib/public-links';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('public links', () => {
  it('returns null when links are not configured', () => {
    expect(getPublicGithubUrl()).toBeNull();
    expect(getPublicDiscordUrl()).toBeNull();
    expect(getVerificationStandardUrl()).toBeNull();
  });

  it('returns configured https links', () => {
    vi.stubEnv('NEXT_PUBLIC_GITHUB_URL', 'https://github.com/example/private-episodes');
    vi.stubEnv('NEXT_PUBLIC_DISCORD_URL', 'https://discord.gg/example');
    vi.stubEnv(
      'NEXT_PUBLIC_VERIFICATION_STANDARD_URL',
      'https://github.com/example/reference-verification-standard',
    );

    expect(getPublicGithubUrl()).toBe('https://github.com/example/private-episodes');
    expect(getPublicDiscordUrl()).toBe('https://discord.gg/example');
    expect(getVerificationStandardUrl()).toBe(
      'https://github.com/example/reference-verification-standard',
    );
  });

  it('rejects non-https or invalid links', () => {
    vi.stubEnv('NEXT_PUBLIC_GITHUB_URL', 'http://github.com/example/private-episodes');
    vi.stubEnv('NEXT_PUBLIC_DISCORD_URL', 'not-a-url');

    expect(getPublicGithubUrl()).toBeNull();
    expect(getPublicDiscordUrl()).toBeNull();
  });
});
