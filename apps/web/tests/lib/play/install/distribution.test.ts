// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playDistribution } from '@/lib/play/install/distribution';

beforeEach(() => {
  for (const name of [
    'SOTTO_IOS_APP_STORE_URL',
    'SOTTO_ANDROID_PLAY_STORE_URL',
    'SOTTO_ANDROID_APK_URL',
  ])
    vi.stubEnv(name, '');
});
afterEach(() => vi.unstubAllEnvs());

describe('configured native installation destinations', () => {
  it('reports missing publication explicitly without inventing store links', () => {
    expect(playDistribution()).toEqual({ ios: null, androidStore: null, androidApk: null });
  });

  it('preserves actual configured store destinations and HTTPS APK artifacts', () => {
    vi.stubEnv('SOTTO_IOS_APP_STORE_URL', 'https://apps.apple.com/app/id123');
    vi.stubEnv(
      'SOTTO_ANDROID_PLAY_STORE_URL',
      'https://play.google.com/store/apps/details?id=fm.sotto'
    );
    vi.stubEnv('SOTTO_ANDROID_APK_URL', 'https://downloads.example/sotto.apk');
    expect(playDistribution()).toEqual({
      ios: 'https://apps.apple.com/app/id123',
      androidStore: 'https://play.google.com/store/apps/details?id=fm.sotto',
      androidApk: 'https://downloads.example/sotto.apk',
    });
  });

  it.each([
    ['SOTTO_IOS_APP_STORE_URL', 'https://apps.apple.com.attacker.example/app'],
    ['SOTTO_ANDROID_PLAY_STORE_URL', 'https://play.google.com:8443/store/apps'],
    ['SOTTO_ANDROID_APK_URL', 'http://downloads.example/sotto.apk'],
    ['SOTTO_ANDROID_APK_URL', 'https://user:password@downloads.example/sotto.apk'],
    ['SOTTO_ANDROID_APK_URL', 'https://downloads.example/sotto.apk#secret'],
    ['SOTTO_IOS_APP_STORE_URL', 'not a url'],
  ])(
    'surfaces an invalid %s destination instead of silently choosing another download',
    (name, value) => {
      vi.stubEnv(name, value);
      expect(() => playDistribution()).toThrow();
    }
  );
});
