import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/byok', () => ({
  getByokKey: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auto-model-config', () => ({
  getAutoModelConfig: vi.fn().mockResolvedValue({
    avatarProvider: 'heygen',
    avatarModel: 'heygen-avatar-standard',
  }),
}));

const mockListAvatars = vi.fn();
vi.mock('@/lib/heygen', () => ({
  listAvatars: (...args: unknown[]) => mockListAvatars(...args),
  generateAvatarVideo: vi.fn(),
}));

const mockListRunwayPresets = vi.fn();
const mockListRunwayAvatars = vi.fn();
vi.mock('@/lib/runway', () => ({
  listRunwayPresets: (...args: unknown[]) => mockListRunwayPresets(...args),
  listRunwayAvatars: (...args: unknown[]) => mockListRunwayAvatars(...args),
}));

import { listUnifiedAvatars, resolveAvatarProvider } from '@/lib/providers/avatar';
import { getByokKey } from '@/lib/byok';
import { getAutoModelConfig } from '@/lib/auto-model-config';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HEYGEN_API_KEY;
  delete process.env.RUNWAY_API_KEY;
});

describe('listUnifiedAvatars', () => {
  it('returns unified HeyGen avatars', async () => {
    mockListAvatars.mockResolvedValue([
      { avatar_id: 'hg-1', avatar_name: 'Anna', preview_image_url: 'https://img/anna.png', premium: false },
      { avatar_id: 'hg-2', avatar_name: 'Pro Avatar', preview_image_url: 'https://img/pro.png', premium: true },
    ]);

    const result = await listUnifiedAvatars('test-key', 'heygen');

    // Should filter out premium avatars
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'hg-1',
      name: 'Anna',
      previewImageUrl: 'https://img/anna.png',
      provider: 'heygen',
      isPreset: false,
      premium: false,
    });
  });

  it('returns Runway presets + custom avatars', async () => {
    mockListRunwayPresets.mockReturnValue([
      { id: 'influencer', name: 'Influencer', previewImageUrl: 'https://img/influencer.png' },
    ]);
    mockListRunwayAvatars.mockResolvedValue([
      { id: 'custom-1', name: 'My Avatar', processedImageUri: 'https://img/custom.png' },
    ]);

    const result = await listUnifiedAvatars('test-key', 'runway');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'influencer',
      provider: 'runway',
      isPreset: true,
    });
    expect(result[1]).toMatchObject({
      id: 'custom-1',
      provider: 'runway',
      isPreset: false,
      previewImageUrl: 'https://img/custom.png',
    });
  });

  it('returns only presets when custom avatar listing fails', async () => {
    mockListRunwayPresets.mockReturnValue([
      { id: 'influencer', name: 'Influencer', previewImageUrl: 'https://img/influencer.png' },
    ]);
    mockListRunwayAvatars.mockRejectedValue(new Error('API error'));

    const result = await listUnifiedAvatars('test-key', 'runway');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('influencer');
  });
});

describe('resolveAvatarProvider', () => {
  it('resolves HeyGen with platform key', async () => {
    process.env.HEYGEN_API_KEY = 'platform-key';

    const result = await resolveAvatarProvider({ userId: 'user-1' });

    expect(result.providerId).toBe('heygen');
    expect(result.source).toBe('platform');
    expect(result.apiKey).toBe('platform-key');
  });

  it('prefers BYOK key over platform key', async () => {
    process.env.HEYGEN_API_KEY = 'platform-key';
    vi.mocked(getByokKey).mockResolvedValue('byok-key');

    const result = await resolveAvatarProvider({ userId: 'user-1' });

    expect(result.source).toBe('byok');
    expect(result.apiKey).toBe('byok-key');
  });

  it('falls back to HeyGen when config says runway (disabled provider)', async () => {
    vi.mocked(getByokKey).mockResolvedValue(null);
    process.env.RUNWAY_API_KEY = 'runway-platform';
    process.env.HEYGEN_API_KEY = 'heygen-key';
    vi.mocked(getAutoModelConfig).mockResolvedValue({
      avatarProvider: 'runway',
      avatarModel: 'runway-characters',
    } as never);

    const result = await resolveAvatarProvider({ userId: 'user-1' });

    // Runway is disabled, falls back to HeyGen
    expect(result.providerId).toBe('heygen');
    expect(result.apiKey).toBe('heygen-key');
  });

  it('resolves Fal with platform key', async () => {
    vi.mocked(getByokKey).mockResolvedValue(null);
    process.env.FAL_KEY = 'fal-platform';
    vi.mocked(getAutoModelConfig).mockResolvedValue({
      avatarProvider: 'fal',
      avatarModel: 'fal-veed-fabric-1.0',
    } as never);

    const result = await resolveAvatarProvider({ userId: 'user-1' });

    expect(result.providerId).toBe('fal');
    expect(result.apiKey).toBe('fal-platform');
  });

  it('falls back to HeyGen when Runway config set but no Runway key', async () => {
    vi.mocked(getByokKey).mockResolvedValue(null);
    process.env.HEYGEN_API_KEY = 'heygen-key';
    vi.mocked(getAutoModelConfig).mockResolvedValue({
      avatarProvider: 'runway',
      avatarModel: 'runway-characters',
    } as never);

    const result = await resolveAvatarProvider({ userId: 'user-1' });

    expect(result.providerId).toBe('heygen');
  });

  it('throws when no API key is available', async () => {
    vi.mocked(getByokKey).mockResolvedValue(null);
    await expect(resolveAvatarProvider({ userId: 'user-1' })).rejects.toThrow('No avatar API key available');
  });

  it('Fal provider listAvatars returns empty array', async () => {
    process.env.FAL_KEY = 'fal-key';
    vi.mocked(getAutoModelConfig).mockResolvedValue({
      avatarProvider: 'fal',
      avatarModel: 'fal-veed-fabric-1.0',
    } as never);

    const result = await resolveAvatarProvider({ userId: 'user-1' });
    const avatars = await result.provider.listAvatars();

    expect(avatars).toEqual([]);
  });

  it('Fal provider generateAvatar throws', async () => {
    process.env.FAL_KEY = 'fal-key';
    vi.mocked(getAutoModelConfig).mockResolvedValue({
      avatarProvider: 'fal',
      avatarModel: 'fal-veed-fabric-1.0',
    } as never);

    const result = await resolveAvatarProvider({ userId: 'user-1' });

    await expect(result.provider.generateAvatar({
      avatarId: 'test',
      audioUrl: 'http://audio.mp3',
    })).rejects.toThrow('handled via the worker pipeline');
  });
});
