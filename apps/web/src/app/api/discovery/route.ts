import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { streamDiscoveryResponse, parseChips, parseMetadata, detectUrls } from '@/lib/discovery-agent';
import { logUsage } from '@/lib/usage-logger';
import { extractContent } from '@/lib/extractors';
import { checkRateLimit } from '@/lib/redis';
import { getAiKey } from '@/lib/byok';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { auth } from '@/lib/auth';
import { checkSuspension } from '@/lib/auth-guards';

export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Suspension check — only for session-based auth
  if (!request.headers.get('authorization')?.startsWith('Bearer ')) {
    const session = await auth();
    if (session) {
      const suspended = checkSuspension(session);
      if (suspended) return suspended;
    }
  }

  const body = await request.json();
  const { message, content, discoveryId, history, model } = body;

  // Block non-admins from using claude-code models
  if (typeof model === 'string' && model.startsWith('claude-code:')) {
    const sess = await auth();
    if (sess?.user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

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
  const aiKey = await getAiKey(authed.userId);

  // Inline URL extraction: detect URLs in the latest message and inject context
  const detectedUrls = detectUrls(userMessage);
  if (detectedUrls.length > 0) {
    const { allowed } = await checkRateLimit(`url-extract:${authed.userId}`, 10, 60);
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

  // Build message history: prefer client-provided history, fall back to DB
  // Strip [chips: ...] and [METADATA]...[/METADATA] from assistant messages to keep context clean
  const cleanAssistantContent = (text: string) =>
    text
      .replace(/\[chips:\s*.+?\]/g, '')
      .replace(/\[METADATA\][\s\S]*?\[\/METADATA\]/g, '')
      .trim();

  const priorMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
    Array.isArray(history) && history.length > 0
      ? history.map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.role === 'assistant' ? cleanAssistantContent(m.content) : m.content,
        }))
      : discovery?.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.role === 'assistant' ? cleanAssistantContent(m.content) : m.content,
        })) || [];

  const messages = [...priorMessages, { role: 'user' as const, content: userMessage }];

  // Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let fullResponse = '';
        for await (const chunk of streamDiscoveryResponse(messages, aiKey?.apiKey, model || undefined, (usage) => {
          logUsage({
            service: 'anthropic',
            model: usage.model,
            category: 'discovery',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            userId: authed.userId,
          });
        })) {
          // Only stream string chunks (skip objects from claude-code stream-json)
          const text = typeof chunk === 'string' ? chunk : '';
          if (text) {
            fullResponse += text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        }

        if (!fullResponse.trim()) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "I couldn't generate a response. Please try again." })}\n\n`
            )
          );
          prisma.discoveryChatError.create({
            data: {
              userId: authed.userId,
              userMessage: (message ?? content ?? '').slice(0, 2000),
              errorKind: 'empty_response',
              discoveryId: discoveryId ?? null,
            },
          }).catch((err: Error) => logger.warn('Failed to save discovery chat error', { error: err.message }));
          controller.close();
          return;
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
            where: { userId: authed.userId, provider: aiKey.provider },
            data: { isValid: false },
          });
        }

        const errorMessage = isAuthError
          ? 'Your AI API key is invalid or has been revoked. Please update it in Settings.'
          : 'An error occurred while generating a response. Please try again.';

        prisma.discoveryChatError.create({
          data: {
            userId: authed.userId,
            userMessage: (message ?? content ?? '').slice(0, 2000),
            errorKind: isAuthError ? 'auth_error' : 'exception',
            errorDetail: error instanceof Error
              ? `${error.message}\n${error.stack ?? ''}`.slice(0, 4000)
              : String(error).slice(0, 4000),
            discoveryId: discoveryId ?? null,
          },
        }).catch((err: Error) => logger.warn('Failed to save discovery chat error', { error: err.message }));

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
