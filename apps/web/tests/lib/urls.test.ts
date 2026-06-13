import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppUrlConfigurationError,
  absoluteEpisodeUrl,
  getAppBaseUrl,
  getPublicAppBaseUrl,
  episodeUrl,
} from '@/lib/urls';

describe('url helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds profile slug episode paths when a slug and handle are available', () => {
    expect(episodeUrl({ id: 'pod-1', slug: 'daily-brief' }, 'alice')).toBe('/@alice/daily-brief');
  });

  it('builds id episode paths when a slug or handle is missing', () => {
    expect(episodeUrl({ id: 'pod-1', slug: 'daily-brief' }, null)).toBe('/episode/pod-1');
    expect(episodeUrl({ id: 'pod-1', slug: null }, 'alice')).toBe('/episode/pod-1');
  });

  it('uses NEXT_PUBLIC_APP_URL as the app base URL', () => {
    expect(
      getAppBaseUrl({
        NEXT_PUBLIC_APP_URL: 'https://episodes.example.com/',
      })
    ).toBe('https://episodes.example.com');
  });

  it('rejects missing app URL configuration', () => {
    expect(() => getAppBaseUrl({})).toThrow(AppUrlConfigurationError);
    expect(() => getAppBaseUrl({})).toThrow(
      'NEXT_PUBLIC_APP_URL is required to generate absolute Sotto URLs.'
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
    ).toThrow('NEXT_PUBLIC_APP_URL must use https for public bot links.');
  });

  it('builds absolute episode URLs from explicit deployment configuration', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com/');

    expect(absoluteEpisodeUrl({ id: 'pod-1', slug: 'daily-brief' }, 'alice')).toBe(
      'https://selfhost.example.com/@alice/daily-brief'
    );
  });
});
