import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppUrlConfigurationError,
  absolutePodcastUrl,
  getAppBaseUrl,
  getPublicAppBaseUrl,
  podcastUrl,
} from '@/lib/urls';

describe('url helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds profile slug podcast paths when a slug and handle are available', () => {
    expect(podcastUrl({ id: 'pod-1', slug: 'daily-brief' }, 'alice')).toBe('/@alice/daily-brief');
  });

  it('builds id podcast paths when a slug or handle is missing', () => {
    expect(podcastUrl({ id: 'pod-1', slug: 'daily-brief' }, null)).toBe('/podcast/pod-1');
    expect(podcastUrl({ id: 'pod-1', slug: null }, 'alice')).toBe('/podcast/pod-1');
  });

  it('uses NEXT_PUBLIC_APP_URL as the primary app base URL', () => {
    expect(
      getAppBaseUrl({
        NEXT_PUBLIC_APP_URL: 'https://podcasts.example.com/',
        NEXTAUTH_URL: 'https://auth.example.com',
      })
    ).toBe('https://podcasts.example.com');
  });

  it('falls back to NEXTAUTH_URL when the public app URL is not configured', () => {
    expect(getAppBaseUrl({ NEXTAUTH_URL: 'http://localhost:3000/' })).toBe('http://localhost:3000');
  });

  it('rejects missing app URL configuration', () => {
    expect(() => getAppBaseUrl({})).toThrow(AppUrlConfigurationError);
    expect(() => getAppBaseUrl({})).toThrow(
      'NEXT_PUBLIC_APP_URL or NEXTAUTH_URL is required to generate absolute Sotto URLs.'
    );
  });

  it('rejects non-http app URL configuration', () => {
    expect(() => getAppBaseUrl({ NEXT_PUBLIC_APP_URL: 'file:///tmp/sotto' })).toThrow(
      'NEXT_PUBLIC_APP_URL must use http or https.'
    );
  });

  it('rejects app URLs with credentials, query, or hash', () => {
    expect(() => getAppBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://user@example.com' })).toThrow(
      'NEXT_PUBLIC_APP_URL must be a clean origin URL without credentials, query, or hash.'
    );
    expect(() => getAppBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://example.com?ref=1' })).toThrow(
      'NEXT_PUBLIC_APP_URL must be a clean origin URL without credentials, query, or hash.'
    );
    expect(() => getAppBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://example.com#top' })).toThrow(
      'NEXT_PUBLIC_APP_URL must be a clean origin URL without credentials, query, or hash.'
    );
  });

  it('requires https for public bot links', () => {
    expect(getPublicAppBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://selfhost.example.com' })).toBe(
      'https://selfhost.example.com'
    );
    expect(() =>
      getPublicAppBaseUrl({ NEXT_PUBLIC_APP_URL: 'http://selfhost.example.com' })
    ).toThrow('NEXT_PUBLIC_APP_URL or NEXTAUTH_URL must use https for public bot links.');
  });

  it('builds absolute podcast URLs from explicit deployment configuration', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com/');

    expect(absolutePodcastUrl({ id: 'pod-1', slug: 'daily-brief' }, 'alice')).toBe(
      'https://selfhost.example.com/@alice/daily-brief'
    );
  });
});
