/**
 * Backward-compatible re-export of generateFalVideo.
 * New code should use VideoProvider via resolveVideoProvider() instead.
 */
import { FalVideoProvider } from '../video/fal.provider';

export async function generateFalVideo(params: {
  apiKey: string;
  model: string;
  prompt: string;
  duration?: number;
}): Promise<Buffer> {
  const provider = new FalVideoProvider(params.apiKey, params.model);
  return provider.generateVideo({ prompt: params.prompt, duration: params.duration });
}
