/**
 * Live-translate backend: BYOK-google-only resolution (no fallback), the nav gate
 * probe, and ephemeral-token minting with the translation direction mapped to the
 * right BCP-47 target. @google/genai is mocked at the boundary so tests run
 * env-free and never touch the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetAiKey = vi.fn();
vi.mock('@/lib/byok', () => ({
  getAiKey: (...a: unknown[]) => mockGetAiKey(...a),
}));

const mockCourseFindFirst = vi.fn();
const mockUserAiKeyFindUnique = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: { findFirst: (...a: unknown[]) => mockCourseFindFirst(...a) },
    userAiKey: { findUnique: (...a: unknown[]) => mockUserAiKeyFindUnique(...a) },
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
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to a documented Gemini Live model when unset', () => {
    expect(getLiveTranslateModel()).toBe('gemini-live-2.5-flash-preview');
  });

  it('honors the GEMINI_LIVE_MODEL override', () => {
    vi.stubEnv('GEMINI_LIVE_MODEL', 'gemini-3.5-live-translate-preview');
    expect(getLiveTranslateModel()).toBe('gemini-3.5-live-translate-preview');
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

  it('is true when a google key row exists', async () => {
    mockUserAiKeyFindUnique.mockResolvedValue({ id: 'k1' });
    await expect(canLiveTranslate('u1')).resolves.toBe(true);
  });

  it('is false when there is no google key row', async () => {
    mockUserAiKeyFindUnique.mockResolvedValue(null);
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
      LiveTranslateCourseError,
    );
    expect(mockAuthTokensCreate).not.toHaveBeenCalled();
  });

  it('native_to_target translates into the target language', async () => {
    const result = await mintLiveToken('u1', 'c1', 'native_to_target');
    expect(result.token).toBe('ephemeral-token-xyz');
    expect(result.targetLanguageCode).toBe('de');
    expect(result.nativeLanguageCode).toBe('en');
    const cfg = mockAuthTokensCreate.mock.calls[0][0].config.liveConnectConstraints.config;
    expect(cfg.streamTranslationConfig.targetLanguageCode).toBe('de');
    expect(cfg.responseModalities).toEqual(['AUDIO']);
  });

  it('target_to_native translates back into the native language', async () => {
    const result = await mintLiveToken('u1', 'c1', 'target_to_native');
    expect(result.targetLanguageCode).toBe('en');
    const cfg = mockAuthTokensCreate.mock.calls[0][0].config.liveConnectConstraints.config;
    expect(cfg.streamTranslationConfig.targetLanguageCode).toBe('en');
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
      LiveTranslateAccessError,
    );
  });

  it('treats a missing token name as an access error', async () => {
    mockAuthTokensCreate.mockResolvedValue({});
    await expect(mintLiveToken('u1', 'c1', 'native_to_target')).rejects.toBeInstanceOf(
      LiveTranslateAccessError,
    );
  });
});
