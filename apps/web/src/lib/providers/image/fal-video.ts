import { getFalVideoEndpoint } from '../fal-endpoints';
import { logger } from '../../logger';

export async function generateFalVideo(params: {
  apiKey: string;
  model: string;
  prompt: string;
  duration?: number;
}): Promise<Buffer> {
  const endpoint = getFalVideoEndpoint(params.model);
  if (!endpoint) throw new Error(`No Fal endpoint for video model: ${params.model}`);

  const url = `https://queue.fal.run/${endpoint}`;

  logger.info('Submitting fal video job', { model: params.model, endpoint });

  const submitRes = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: params.prompt,
      duration: params.duration ? String(params.duration) : undefined,
      aspect_ratio: '16:9',
    }),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => 'unknown');
    throw new Error(`Fal video submission failed (${submitRes.status}): ${text}`);
  }

  const { request_id } = (await submitRes.json()) as { request_id: string };

  const statusUrl = `https://queue.fal.run/${endpoint}/requests/${request_id}/status`;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Key ${params.apiKey}` },
    });
    const status = (await statusRes.json()) as { status: string; error?: string };

    if (status.status === 'COMPLETED') {
      const resultUrl = `https://queue.fal.run/${endpoint}/requests/${request_id}`;
      const resultRes = await fetch(resultUrl, {
        headers: { Authorization: `Key ${params.apiKey}` },
      });
      const result = (await resultRes.json()) as { video?: { url: string } };
      const videoUrl = result.video?.url;
      if (!videoUrl) throw new Error('Fal returned no video URL');
      const videoRes = await fetch(videoUrl);
      return Buffer.from(await videoRes.arrayBuffer());
    }

    if (status.status === 'FAILED') {
      throw new Error(`Fal video generation failed: ${status.error || 'unknown'}`);
    }
  }

  throw new Error('Fal video generation timed out after 10 minutes');
}
