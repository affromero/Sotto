import { Job } from 'bullmq';
import type { GenerateDemoVisualPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';

export async function processDemoVisual(job: Job<GenerateDemoVisualPayload>): Promise<void> {
  const { projectId, sceneId } = job.data;

  const scene = await prisma.demoScene.findUniqueOrThrow({
    where: { id: sceneId },
    select: { visualType: true, visualPrompt: true, projectId: true },
  });

  if (scene.projectId !== projectId) {
    throw new Error('Scene does not belong to project');
  }

  if (!scene.visualType || !scene.visualPrompt) {
    logger.info('No visual configured for scene, skipping', { projectId, sceneId });
    return;
  }

  logger.info('Generating demo visual', { projectId, sceneId, type: scene.visualType });
  await job.updateProgress(10);

  await prisma.demoScene.update({
    where: { id: sceneId },
    data: { visualStatus: 'GENERATING' },
  });

  try {
    let buffer: Buffer;
    let contentType: string;
    let extension: string;

    switch (scene.visualType) {
      case 'ai_image': {
        // Use fal FLUX for AI image generation
        const falKey = process.env.FAL_KEY;
        if (!falKey) throw new Error('FAL_KEY not configured');

        const response = await fetch('https://queue.fal.run/fal-ai/flux/schnell', {
          method: 'POST',
          headers: {
            'Authorization': `Key ${falKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: scene.visualPrompt,
            image_size: { width: 1280, height: 720 },
            num_images: 1,
          }),
        });

        if (!response.ok) {
          throw new Error(`Fal image generation failed: ${response.status}`);
        }

        const result = (await response.json()) as { images: Array<{ url: string }> };
        const imageUrl = result.images?.[0]?.url;
        if (!imageUrl) throw new Error('No image URL in fal response');

        const imageResponse = await fetch(imageUrl);
        buffer = Buffer.from(await imageResponse.arrayBuffer());
        contentType = 'image/png';
        extension = 'png';
        break;
      }

      case 'ai_video': {
        // Use fal for AI video generation
        const falKey = process.env.FAL_KEY;
        if (!falKey) throw new Error('FAL_KEY not configured');

        const response = await fetch('https://queue.fal.run/fal-ai/minimax-video/image-to-video', {
          method: 'POST',
          headers: {
            'Authorization': `Key ${falKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: scene.visualPrompt,
          }),
        });

        if (!response.ok) {
          throw new Error(`Fal video generation failed: ${response.status}`);
        }

        const result = (await response.json()) as { video: { url: string } };
        const videoUrl = result.video?.url;
        if (!videoUrl) throw new Error('No video URL in fal response');

        const videoResponse = await fetch(videoUrl);
        buffer = Buffer.from(await videoResponse.arrayBuffer());
        contentType = 'video/mp4';
        extension = 'mp4';
        break;
      }

      case 'map': {
        // Use Mapbox static image
        const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
        if (!mapboxToken) throw new Error('MAPBOX_ACCESS_TOKEN not configured');

        // Simple center-of-world fallback — the prompt should contain coordinates
        const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/0,20,2,0/1280x720@2x?access_token=${mapboxToken}`;
        const mapResponse = await fetch(mapUrl);
        if (!mapResponse.ok) throw new Error(`Mapbox request failed: ${mapResponse.status}`);

        buffer = Buffer.from(await mapResponse.arrayBuffer());
        contentType = 'image/png';
        extension = 'png';
        break;
      }

      default:
        throw new Error(`Unknown visual type: ${scene.visualType}`);
    }

    await job.updateProgress(80);

    // Upload to R2
    const r2Key = `demos/${projectId}/scenes/${sceneId}/visual.${extension}`;
    const visualUrl = await uploadFile(r2Key, buffer, contentType);

    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { visualUrl, visualStatus: 'READY' },
    });

    await job.updateProgress(100);
    logger.info('Demo visual complete', { projectId, sceneId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Demo visual failed', { projectId, sceneId, error: message });

    await prisma.demoScene.update({
      where: { id: sceneId },
      data: { visualStatus: 'FAILED' },
    });

    throw err;
  }
}
