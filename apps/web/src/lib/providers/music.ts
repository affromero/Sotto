/**
 * Music provider interface + resolution logic.
 * Follows the same pattern as providers/video.ts.
 */
import { logger } from '../logger';
import { getByokKey } from '../byok';
import { getAutoModelConfig } from '../auto-model-config';
import { getMusicModelProvider, type MusicProviderId } from './music-registry';

export interface MusicProvider {
  generateMusic(params: {
    prompt: string;
    durationSeconds: number;
    instrumental: boolean;
    style?: string;
    title?: string;
  }): Promise<Buffer>;
  getModelId(): string;
  readonly providerId: MusicProviderId;
}

export interface ResolvedMusicProvider {
  provider: MusicProvider;
  source: 'byok' | 'platform';
  providerId: MusicProviderId;
}

/**
 * Resolve the best music provider for a given model.
 *
 * Resolution order per provider:
 * 1. BYOK key (stored in UserTtsKey as 'suno' or 'elevenlabs')
 * 2. Platform key from env (SUNO_API_KEY or ELEVENLABS_API_KEY)
 */
export async function resolveMusicProvider(context: {
  userId: string;
  requestedModel?: string | null;
}): Promise<ResolvedMusicProvider> {
  const { userId, requestedModel } = context;

  const config = await getAutoModelConfig();
  const model = requestedModel ?? config.musicModel ?? 'suno-v5';

  const providerId = getMusicModelProvider(model);
  if (!providerId) {
    throw new Error(`Unknown music model: ${model}. No provider found.`);
  }

  if (providerId === 'suno') {
    return resolveSunoMusic(userId, model);
  }

  if (providerId === 'elevenlabs') {
    return resolveElevenLabsMusic(userId, model);
  }

  throw new Error(`Unsupported music provider: ${providerId}`);
}

async function resolveSunoMusic(userId: string, model: string): Promise<ResolvedMusicProvider> {
  const byokKey = await getByokKey(userId, 'suno');
  if (byokKey) {
    const { SunoMusicProvider } = await import('./music/suno.provider');
    return { provider: new SunoMusicProvider(byokKey, model), source: 'byok', providerId: 'suno' };
  }

  if (process.env.SUNO_API_KEY) {
    const { SunoMusicProvider } = await import('./music/suno.provider');
    return { provider: new SunoMusicProvider(process.env.SUNO_API_KEY, model), source: 'platform', providerId: 'suno' };
  }

  logger.error('No Suno API key available for music generation', { userId });
  throw new Error('No Suno API key available. Add a Suno key in Settings or contact support.');
}

async function resolveElevenLabsMusic(userId: string, model: string): Promise<ResolvedMusicProvider> {
  const byokKey = await getByokKey(userId, 'elevenlabs');
  if (byokKey) {
    const { ElevenLabsMusicProvider } = await import('./music/elevenlabs.provider');
    return { provider: new ElevenLabsMusicProvider(byokKey, model), source: 'byok', providerId: 'elevenlabs' };
  }

  if (process.env.ELEVENLABS_API_KEY) {
    const { ElevenLabsMusicProvider } = await import('./music/elevenlabs.provider');
    return { provider: new ElevenLabsMusicProvider(process.env.ELEVENLABS_API_KEY, model), source: 'platform', providerId: 'elevenlabs' };
  }

  logger.error('No ElevenLabs API key available for music generation', { userId });
  throw new Error('No ElevenLabs API key available. Add an ElevenLabs key in Settings or contact support.');
}
