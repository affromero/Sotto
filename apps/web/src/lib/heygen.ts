import { logger } from './logger';

const HEYGEN_API_BASE = 'https://api.heygen.com';

export interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url: string;
  preview_video_url?: string;
  gender: string;
  premium: boolean;
}

export async function listAvatars(apiKey: string): Promise<HeyGenAvatar[]> {
  const res = await fetch(`${HEYGEN_API_BASE}/v2/avatars`, {
    headers: { 'x-api-key': apiKey },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    throw new Error(`HeyGen list avatars failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as { data: { avatars: HeyGenAvatar[] } };
  return body.data.avatars;
}

export async function submitAvatarVideo(params: {
  apiKey: string;
  avatarId: string;
  audioUrl: string;
}): Promise<string> {
  const res = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
    method: 'POST',
    headers: {
      'x-api-key': params.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_inputs: [
        {
          character: {
            type: 'avatar',
            avatar_id: params.avatarId,
            avatar_style: 'normal',
          },
          voice: {
            type: 'audio',
            audio_url: params.audioUrl,
          },
          background: {
            type: 'color',
            value: '#00FF00',
          },
        },
      ],
      dimension: { width: 720, height: 720 },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    throw new Error(`HeyGen submit failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as { data: { video_id: string } };
  return body.data.video_id;
}

export async function pollAvatarVideo(params: {
  apiKey: string;
  videoId: string;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
}): Promise<{ videoUrl: string }> {
  const maxAttempts = params.maxPollAttempts ?? 180; // 15 min at 5s intervals
  const interval = params.pollIntervalMs ?? 5000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, interval));

    const res = await fetch(
      `${HEYGEN_API_BASE}/v1/video_status.get?video_id=${params.videoId}`,
      { headers: { 'x-api-key': params.apiKey } },
    );

    if (!res.ok) {
      logger.warn('HeyGen poll status request failed', { status: res.status, attempt: i });
      continue;
    }

    const body = (await res.json()) as {
      data: { status: string; video_url?: string; error?: string };
    };

    if (body.data.status === 'completed' && body.data.video_url) {
      return { videoUrl: body.data.video_url };
    }

    if (body.data.status === 'failed') {
      throw new Error(`HeyGen video generation failed: ${body.data.error ?? 'unknown'}`);
    }
  }

  throw new Error(`HeyGen video generation timed out after ${maxAttempts} poll attempts`);
}

export async function generateAvatarVideo(params: {
  apiKey: string;
  avatarId: string;
  audioUrl: string;
}): Promise<Buffer> {
  const videoId = await submitAvatarVideo(params);
  const { videoUrl } = await pollAvatarVideo({ apiKey: params.apiKey, videoId });

  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Failed to download HeyGen video: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
