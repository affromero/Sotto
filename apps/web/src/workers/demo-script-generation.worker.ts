import { Job } from 'bullmq';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { loadAndRender } from '@/lib/prompt-loader';
import { createAIProvider } from '@/lib/providers/ai';
import {
  getDemoProductContext,
  getDemoFeatureDescriptions,
  getAppSelectorReference,
  getInterceptorCatalog,
} from '@/lib/demo-context';
import type { GenerateDemoScriptPayload } from '@/lib/queue';

interface GeneratedScene {
  title: string;
  narration: string;
  actions: unknown[];
  visualSuggestion?: {
    type: 'ai_image' | 'ai_video' | 'map';
    prompt: string;
  } | null;
}

/** Extract the first JSON array from an AI response that may contain surrounding text. */
function extractJsonArray(text: string): string {
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch { /* continue */ }
  const start = text.indexOf('[');
  if (start === -1) throw new Error('No JSON array found in response');
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    if (ch === ']' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('Unbalanced JSON array in response');
}

export async function processDemoScriptGeneration(
  job: Job<GenerateDemoScriptPayload>,
): Promise<void> {
  const { projectId } = job.data;

  const project = await prisma.demoProject.findUniqueOrThrow({
    where: { id: projectId },
  });

  logger.info('Generating demo walkthrough script', { projectId, features: project.features });
  await job.updateProgress(10);

  // Render the walkthrough prompt
  const durationTarget = job.data.durationTarget ?? project.features.length * 30;
  const systemPrompt = loadAndRender('demo/walkthrough.md', {
    PRODUCT_CONTEXT: getDemoProductContext(),
    FEATURES: getDemoFeatureDescriptions(project.features),
    APP_SELECTORS: getAppSelectorReference(),
    INTERCEPTOR_CATALOG: getInterceptorCatalog(),
    DURATION_TARGET: String(durationTarget),
  });

  const userMessage = [
    `Create a demo walkthrough for: "${project.title}"`,
    project.description ? `Description: ${project.description}` : '',
    `Features to showcase: ${project.features.join(', ')}`,
  ].filter(Boolean).join('\n');

  const ai = createAIProvider();
  const response = await ai.generateResponse(
    systemPrompt,
    [{ role: 'user', content: userMessage }],
    { maxTokens: 8192, model: project.aiModel ?? undefined },
  );

  await job.updateProgress(60);

  // Parse response
  const jsonStr = extractJsonArray(response.content);
  const scenes: GeneratedScene[] = JSON.parse(jsonStr);

  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('AI returned empty or invalid scenes array');
  }

  // Delete any existing scenes (in case of regeneration)
  await prisma.demoScene.deleteMany({ where: { projectId } });

  // Create scenes in bulk — apply project default TTS config to each scene
  await prisma.demoScene.createMany({
    data: scenes.map((scene, index) => ({
      projectId,
      order: index,
      title: scene.title,
      narration: scene.narration,
      actions: scene.actions as unknown as import('@prisma/client').Prisma.InputJsonValue,
      visualType: scene.visualSuggestion?.type ?? null,
      visualPrompt: scene.visualSuggestion?.prompt ?? null,
      ttsProvider: project.defaultTtsProvider,
      ttsModel: project.defaultTtsModel,
      ttsVoiceId: project.defaultTtsVoiceId,
    })),
  });

  await job.updateProgress(90);

  // Update project status
  await prisma.demoProject.update({
    where: { id: projectId },
    data: { status: 'SCRIPT_READY' },
  });

  logger.info('Demo walkthrough script generated', { projectId, sceneCount: scenes.length });
}
