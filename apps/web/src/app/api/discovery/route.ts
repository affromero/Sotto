import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { streamDiscoveryResponse, parseChips, parseMetadata, detectUrls } from '@/lib/discovery-agent';
import { extractContent } from '@/lib/extractors';
import { checkRateLimit } from '@/lib/redis';
import { getAiKey } from '@/lib/byok';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { message, content, discoveryId } = body;
  let userMessage: string | undefined = message ?? content;

  if (!userMessage) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  // Get or create discovery
  let discovery;
  if (discoveryId) {
    discovery = await prisma.discovery.findUniqueOrThrow({
      where: { id: discoveryId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  // Resolve user's AI key for BYOK passthrough
  const aiKey = await getAiKey(session.user.id);

  // Inline URL extraction: detect URLs in the latest message and inject context
  const detectedUrls = detectUrls(userMessage);
  if (detectedUrls.length > 0) {
    const { allowed } = await checkRateLimit(`url-extract:${session.user.id}`, 10, 60);
    if (allowed) {
      try {
        const extracted = await extractContent(detectedUrls[0]);
        const preview = extracted.text.substring(0, 3000);
        const contextBlock = [
          '[URL_CONTEXT]',
          extracted.title ? `Title: ${extracted.title}` : '',
          extracted.siteName ? `Site: ${extracted.siteName}` : '',
          extracted.author ? `Author: ${extracted.author}` : '',
          `Content: ${preview}`,
          '[/URL_CONTEXT]',
        ]
          .filter(Boolean)
          .join('\n');

        userMessage = `${userMessage}\n\n${contextBlock}`;
      } catch (err) {
        logger.warn('URL extraction failed in discovery chat', {
          url: detectedUrls[0],
          error: (err as Error).message,
        });
      }
    }
  }

  // Build message history
  const messages = discovery?.messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  })) || [];

  messages.push({ role: 'user', content: userMessage });

  // Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let fullResponse = '';
        for await (const chunk of streamDiscoveryResponse(messages, aiKey?.apiKey)) {
          fullResponse += chunk;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
        }

        const { chips } = parseChips(fullResponse);
        const rawMeta = parseMetadata(fullResponse);

        // Map snake_case keys from AI output to camelCase for the client
        const metadata = rawMeta
          ? {
              topic: rawMeta.topic,
              depth: rawMeta.depth,
              audienceLevel: rawMeta.audience_level,
              audience: rawMeta.audience,
              focusAreas: rawMeta.focus_areas,
              tone: rawMeta.tone,
              durationTarget: rawMeta.duration_target,
              ready: rawMeta.ready,
            }
          : null;

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, chips, metadata })}\n\n`)
        );
      } catch (error) {
        const status = (error as { status?: number }).status;
        const isAuthError = status === 401 || status === 403;

        if (isAuthError && aiKey) {
          await prisma.userAiKey.updateMany({
            where: { userId: session.user.id, provider: aiKey.provider },
            data: { isValid: false },
          });
        }

        const errorMessage = isAuthError
          ? 'Your AI API key is invalid or has been revoked. Please update it in Settings.'
          : 'An error occurred while generating a response. Please try again.';

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
