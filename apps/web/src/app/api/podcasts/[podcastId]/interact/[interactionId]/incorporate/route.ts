import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { segmentRegenerationQueue, addJob, JobType } from '@/lib/queue';
import { generateResponse, logApiUsage } from '@/lib/claude';
import { CONTENT_SAFETY_INSTRUCTIONS } from '@/lib/safety-prompts';
import { getAiKey } from '@/lib/byok';
import { getLanguageLabel } from '@sotto/shared';
import { checkGenerationGate, tryIncrementFreeGeneration } from '@/lib/generation-gate';
import { getFreeTierConfig } from '@/lib/free-tier-config';
import type { RegenerateSegmentPayload } from '@/lib/queue';

type RouteParams = { params: Promise<{ podcastId: string; interactionId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { podcastId, interactionId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch the interaction with podcast ownership check
  const interaction = await prisma.interaction.findUnique({
    where: { id: interactionId },
    include: {
      podcast: { select: { id: true, userId: true, status: true, source: true, language: true } },
    },
  });

  if (!interaction || interaction.podcastId !== podcastId) {
    return NextResponse.json({ error: 'Interaction not found' }, { status: 404 });
  }

  // Only the podcast owner can incorporate
  if (interaction.podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Generation gate
  const gate = await checkGenerationGate(session.user.id);
  if (!gate.allowed) {
    const msg =
      gate.reason === 'free_tier_exhausted'
        ? 'Free generations used. Add your own API keys to continue.'
        : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return NextResponse.json({ error: msg, code: gate.reason }, { status: 403 });
  }

  if (interaction.podcast.source === 'IMPORT') {
    return NextResponse.json(
      { error: 'Incorporation not yet supported for imported podcasts' },
      { status: 400 }
    );
  }

  // Interaction must be answered or resolved
  if (!['ANSWERED', 'RESOLVED'].includes(interaction.status)) {
    return NextResponse.json(
      { error: `Cannot incorporate interaction with status "${interaction.status}"` },
      { status: 409 }
    );
  }

  // Podcast must be in READY state
  if (interaction.podcast.status !== 'READY') {
    return NextResponse.json(
      { error: `Podcast is currently "${interaction.podcast.status}", must be READY` },
      { status: 409 }
    );
  }

  // Set interaction to INCORPORATING
  await prisma.interaction.update({
    where: { id: interactionId },
    data: { status: 'INCORPORATING' },
  });

  // Set podcast to UPDATING
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { status: 'UPDATING' },
  });

  // Find the segment closest to the interaction timestamp
  const segments = await prisma.segment.findMany({
    where: { podcastId },
    orderBy: { order: 'asc' },
    select: { order: true, startTime: true, duration: true, speaker: true, text: true },
  });

  let insertAfterOrder = 0;
  for (const seg of segments) {
    const segEnd = (seg.startTime ?? 0) + (seg.duration ?? 0);
    if (interaction.timestamp <= segEnd) {
      insertAfterOrder = seg.order;
      break;
    }
    insertAfterOrder = seg.order;
  }

  // Get surrounding context for generating the incorporation text
  const contextSegments = segments
    .filter((s) => Math.abs(s.order - insertAfterOrder) <= 2)
    .map((s) => `${s.speaker}: ${s.text}`)
    .join('\n');

  // Resolve user's AI key for BYOK passthrough
  const aiKey = await getAiKey(session.user.id);

  // Generate the explanation segment text via Claude
  // Always use podcast language for incorporation (segment becomes part of the audio)
  const podcastLanguage = interaction.podcast.language || 'en';
  const languageLabel = getLanguageLabel(podcastLanguage) || 'English';

  const systemPrompt = `You are a podcast script writer for Sotto. A listener asked a question during playback and the AI answered it. Now you need to write a natural-sounding segment that incorporates this Q&A into the podcast flow. Write as the HOST speaker, keeping the same conversational tone. Keep it concise (2-4 sentences). Do NOT include speaker labels or prefixes — just the text. Write in ${languageLabel}.${CONTENT_SAFETY_INSTRUCTIONS}`;

  const response = await generateResponse(systemPrompt, [
    {
      role: 'user',
      content: `Podcast context around timestamp ${interaction.timestamp}s:\n${contextSegments}\n\nListener's question: ${interaction.question}\n\nAI's answer: ${interaction.answer}\n\nWrite a natural podcast segment that addresses this question and answer.`,
    },
  ], { apiKeyOverride: aiKey?.apiKey });

  await logApiUsage({
    podcastId,
    userId: session.user.id,
    category: 'incorporation',
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  });

  // Queue segment regeneration
  const payload: RegenerateSegmentPayload = {
    podcastId,
    interactionId,
    insertAfterOrder,
    newText: response.content,
    speaker: 'HOST',
  };

  await addJob(segmentRegenerationQueue, JobType.REGENERATE_SEGMENT, payload);

  // Increment free tier counter for non-BYOK users
  if (!gate.isByokUser) {
    const config = await getFreeTierConfig();
    await tryIncrementFreeGeneration(session.user.id, config.generationLimit);
  }

  return NextResponse.json(
    {
      status: 'incorporating',
      interactionId,
      insertAfterOrder,
      generatedText: response.content,
    },
    { status: 202 }
  );
}
