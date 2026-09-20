/**
 * Live-translate backend: BYOK-google-only resolution (no fallback), the nav gate
 * probe, and ephemeral-token minting with the translation direction mapped to the
 * right BCP-47 target. @google/genai is mocked at the boundary so tests run
 * env-free and never touch the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetAiKey = vi.fn();
const mockListAiProviders = vi.fn();
const sharedConfiguration = vi.hoisted(() => ({ liveModel: null as string | null }));
vi.mock('@/lib/byok', () => ({
  getAiKey: (...a: unknown[]) => mockGetAiKey(...a),
  listAiProviders: (...a: unknown[]) => mockListAiProviders(...a),
}));

vi.mock('@/lib/site-config', () => ({
  getSiteConfig: async () => ({ liveModel: sharedConfiguration.liveModel }),
}));

const mockCourseFindFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) },
  },
}));

const mockAuthTokensCreate = vi.fn();
const mockGenAiCtor = vi.fn();
vi.mock('@google/genai', () => ({
  // A class (not an arrow fn) so `new GoogleGenAI(...)` is a valid constructor.
  GoogleGenAI: class MockGoogleGenAI {
    authTokens = { create: (...a: unknown[]) => mockAuthTokensCreate(...a) };
    constructor(opts: unknown) {
      mockGenAiCtor(opts);
    }
  },
  Modality: { AUDIO: 'AUDIO' },
}));

import {
  getLiveTranslateModel,
  resolveLiveTranslate,
  canLiveTranslate,
  mintLiveToken,
  LiveTranslateKeyError,
  LiveTranslateCourseError,
  LiveTranslateAccessError,
} from '@/lib/live-translate';

const COURSE = { nativeLang: 'en', targetLang: 'de' };

describe('getLiveTranslateModel', () => {
  afterEach(() => {
    sharedConfiguration.liveModel = null;
  });

  it('defaults to a documented Gemini Live model when unset', async () => {
    await expect(getLiveTranslateModel()).resolves.toBe('gemini-live-2.5-flash-preview');
  });

  it('uses the configured Gemini Live model', async () => {
    sharedConfiguration.liveModel = 'gemini-3.5-live-translate-preview';
    await expect(getLiveTranslateModel()).resolves.toBe('gemini-3.5-live-translate-preview');
  });
});

describe('resolveLiveTranslate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the BYOK Google key and the live model', async () => {
    mockGetAiKey.mockResolvedValue({ apiKey: 'g-key', provider: 'google' });
    await expect(resolveLiveTranslate('u1')).resolves.toEqual({
      apiKey: 'g-key',
      model: 'gemini-live-2.5-flash-preview',
    });
    expect(mockGetAiKey).toHaveBeenCalledWith('u1', 'google');
  });

  it('throws (no keyless fallback) when the learner has no Google key', async () => {
    mockGetAiKey.mockResolvedValue(null);
    await expect(resolveLiveTranslate('u1')).rejects.toBeInstanceOf(LiveTranslateKeyError);
  });
});

describe('canLiveTranslate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is available when the personal Google credential is enabled', async () => {
    mockListAiProviders.mockResolvedValue([{ provider: 'google', isValid: true }]);
    await expect(canLiveTranslate('u1')).resolves.toBe(true);
  });

  it.each([
    { keys: [] },
    { keys: [{ provider: 'google', isValid: false }] },
    { keys: [{ provider: 'openai', isValid: true }] },
  ])('is unavailable without an enabled personal Google credential: $keys', async ({ keys }) => {
    mockListAiProviders.mockResolvedValue(keys);
    await expect(canLiveTranslate('u1')).resolves.toBe(false);
  });
});

describe('mintLiveToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAiKey.mockResolvedValue({ apiKey: 'g-key', provider: 'google' });
    mockCourseFindFirst.mockResolvedValue(COURSE);
    mockAuthTokensCreate.mockResolvedValue({ name: 'ephemeral-token-xyz' });
  });

  it('rejects a course the caller does not own, before touching Google', async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    await expect(mintLiveToken('u1', 'c-other', 'native_to_target')).rejects.toBeInstanceOf(
      LiveTranslateCourseError
    );
    expect(mockAuthTokensCreate).not.toHaveBeenCalled();
  });

  it('native_to_target translates into the target language', async () => {
    const result = await mintLiveToken('u1', 'c1', 'native_to_target');
    expect(result.token).toBe('ephemeral-token-xyz');
    expect(result.targetLanguageCode).toBe('de');
    expect(result.nativeLanguageCode).toBe('en');
    const cfg = mockAuthTokensCreate.mock.calls[0][0].config.liveConnectConstraints.config;
    expect(cfg.translationConfig.targetLanguageCode).toBe('de');
    expect(cfg.responseModalities).toEqual(['AUDIO']);
  });

  it('target_to_native translates back into the native language', async () => {
    const result = await mintLiveToken('u1', 'c1', 'target_to_native');
    expect(result.targetLanguageCode).toBe('en');
    const cfg = mockAuthTokensCreate.mock.calls[0][0].config.liveConnectConstraints.config;
    expect(cfg.translationConfig.targetLanguageCode).toBe('en');
  });

  it('mints on the v1alpha surface with the resolved BYOK key', async () => {
    await mintLiveToken('u1', 'c1', 'native_to_target');
    expect(mockGenAiCtor).toHaveBeenCalledWith({
      apiKey: 'g-key',
      httpOptions: { apiVersion: 'v1alpha' },
    });
  });

  it('surfaces a Google rejection as an access error (no silent degrade)', async () => {
    mockAuthTokensCreate.mockRejectedValue(new Error('model not found for this key'));
    await expect(mintLiveToken('u1', 'c1', 'native_to_target')).rejects.toBeInstanceOf(
      LiveTranslateAccessError
    );
  });

  it('treats a missing token name as an access error', async () => {
    mockAuthTokensCreate.mockResolvedValue({});
    await expect(mintLiveToken('u1', 'c1', 'native_to_target')).rejects.toBeInstanceOf(
      LiveTranslateAccessError
    );
  });
});
