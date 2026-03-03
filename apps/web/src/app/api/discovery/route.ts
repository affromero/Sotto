import { NextRequest} from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { streamDiscoveryResponse, streamFallbackDiscoveryResponse, parseChips, parseMetadata, detectUrls } from '@/lib/discovery-agent';
import { logUsage } from '@/lib/usage-logger';
import { extractContent } from '@/lib/extractors';
import { checkRateLimit } from '@/lib/redis';
import { getAiKey } from '@/lib/byok';
import { getAllAiProviderMeta, getModelRequiredPlan, isValidModelId } from '@/lib/providers/ai-registry';
import type { AiProviderId } from '@/lib/providers/ai-registry';
import { isModelAllowedForUser } from '@/lib/tier-features';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { errorResponse, generateRequestId } from '@/lib/api-response';
import { auth } from '@/lib/auth';
import { checkSuspension } from '@/lib/auth-guards';
import { detectLanguage } from '@/lib/language-detect';

/**
 * Streaming filter that suppresses [METADATA]...[/METADATA] and [chips:...] blocks
 * from being sent to the client. Tags arrive token-by-token across multiple chunks,
 * so the filter buffers potential tag starts and only emits confirmed-safe text.
 */
function createStreamingMarkupFilter() {
  let buffer = '';
  let insideMetadata = false;

  return {
    push(text: string): string {
      buffer += text;
      let output = '';

      while (buffer.length > 0) {
        if (insideMetadata) {
          const endIdx = buffer.indexOf('[/METADATA]');
          if (endIdx !== -1) {
            insideMetadata = false;
            buffer = buffer.substring(endIdx + '[/METADATA]'.length);
            continue;
          }
          return output;
        }

        const metaStart = buffer.indexOf('[METADATA]');
        if (metaStart !== -1) {
          output += buffer.substring(0, metaStart);
          insideMetadata = true;
          buffer = buffer.substring(metaStart + '[METADATA]'.length);
          continue;
        }

        const chipStart = buffer.indexOf('[chips:');
        if (chipStart !== -1) {
          const chipEnd = buffer.indexOf(']', chipStart);
          if (chipEnd !== -1) {
            output += buffer.substring(0, chipStart);
            buffer = buffer.substring(chipEnd + 1);
            continue;
          }
          output += buffer.substring(0, chipStart);
          buffer = buffer.substring(chipStart);
          return output;
        }

        // Hold back trailing chars that could be the start of a tag
        const tags = ['[METADATA]', '[chips:'];
        let holdFrom = buffer.length;
        for (const tag of tags) {
          for (let i = 1; i < tag.length && i <= buffer.length; i++) {
            if (buffer.endsWith(tag.substring(0, i))) {
              holdFrom = Math.min(holdFrom, buffer.length - i);
              break;
            }
          }
        }

        output += buffer.substring(0, holdFrom);
        buffer = buffer.substring(holdFrom);
        break;
      }

      return output;
    },
  };
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();

  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
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
  const { message, content, discoveryId, history, model, maxDuration } = body;

  // Block non-admins from using claude-code models
  if (typeof model === 'string' && model.startsWith('claude-code:')) {
    const sess = await auth();
    if (sess?.user?.role !== 'ADMIN') {
      return errorResponse('Forbidden', 403);
    }
  }

  // Validate model ID against registry (claude-code:* models are exempt)
  if (typeof model === 'string' && !model.startsWith('claude-code:')) {
    if (!isValidModelId(model)) {
      return errorResponse(`Unknown AI model: "${model}". Check /api/ai-models for available models.`, 400);
    }
  }

  let userMessage: string | undefined = message ?? content;

  if (!userMessage) {
    return errorResponse('Message is required', 400);
  }

  // Get or create discovery
  let discovery;
  if (discoveryId) {
    discovery = await prisma.discovery.findUniqueOrThrow({
      where: { id: discoveryId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  // Resolve which provider owns the requested model so we use the right BYOK key.
  // e.g. 'gpt-5-mini' → 'openai', 'claude-sonnet-4-6' → 'anthropic'
  let modelProvider: AiProviderId | undefined;
  if (typeof model === 'string' && !model.startsWith('claude-code:')) {
    for (const p of getAllAiProviderMeta()) {
      if (p.models.some((m) => m.id === model)) {
        modelProvider = p.id as AiProviderId;
        break;
      }
    }
  }

  // Fetch the BYOK key for the resolved provider (falls back to any valid key if no match)
  const aiKey = modelProvider
    ? (await getAiKey(authed.userId, modelProvider)) ?? (await getAiKey(authed.userId))
    : await getAiKey(authed.userId);

  // Fetch user for plan gating and language detection
  const user = await prisma.user.findUnique({
    where: { id: authed.userId },
    select: { plan: true, preferredLanguage: true },
  });

  // Model plan gating — block expensive models for free non-BYOK users
  if (typeof model === 'string' && !model.startsWith('claude-code:')) {
    const requiredPlan = getModelRequiredPlan(model);
    if (requiredPlan) {
      const session = await auth();
      const role = session?.user?.role;
      const isByok = !!aiKey;
      const userPlan = user?.plan ?? 'FREE';
      if (!isModelAllowedForUser(requiredPlan, userPlan as 'FREE' | 'PRO', isByok, role)) {
        return errorResponse('This model requires a Pro subscription.', 403, { code: 'model_requires_pro' });
      }
    }
  }

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

  // Detect language on first message for non-English speakers without a preference set
  let detectedLanguage: string | null = null;
  const isFirstMessage = !Array.isArray(history) || history.length === 0;
  if (isFirstMessage && !user?.preferredLanguage) {
    const rawMessage = message ?? content;
    if (typeof rawMessage === 'string') {
      const lang = detectLanguage(rawMessage);
      if (lang && lang !== 'en') {
        detectedLanguage = lang;
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

  const effectiveProvider = modelProvider ?? aiKey?.provider ?? 'anthropic';

  // For free-tier users (maxDuration <= 5), tell the AI not to ask about duration
  const systemSuffix = typeof maxDuration === 'number' && maxDuration <= 5
    ? 'IMPORTANT: This user is on the free tier with a fixed 5-minute podcast duration. Do NOT ask about duration preference — skip step 7 entirely. Always set "duration_target": 5 in the metadata.'
    : undefined;

  // Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let fullResponse = '';
        const markupFilter = createStreamingMarkupFilter();
        for await (const chunk of streamDiscoveryResponse(
          messages,
          aiKey?.apiKey,
          model || undefined,
          (usage) => {
            logUsage({
              service: effectiveProvider as 'anthropic' | 'openai',
              model: usage.model,
              category: 'discovery',
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              userId: authed.userId,
            });
          },
          effectiveProvider,
          systemSuffix,
        )) {
          // Only stream string chunks (skip objects from claude-code stream-json)
          const text = typeof chunk === 'string' ? chunk : '';
          if (text) {
            fullResponse += text;
            // Filter out [METADATA]...[/METADATA] and [chips:...] so they never reach the client
            const safeText = markupFilter.push(text);
            if (safeText) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: safeText })}\n\n`));
            }
          }
        }

        // Check for visually-empty response: truly empty OR response contains only metadata/chips markup
        // A metadata-only response with ready:true is valid (AI skipped confirmation text)
        const visibleContent = fullResponse
          .replace(/\[METADATA\][\s\S]*?\[\/METADATA\]/g, '')
          .replace(/\[chips:\s*.+?\]/g, '')
          .trim();
        const hasValidMetadata = !!parseMetadata(fullResponse);

        if (!visibleContent && !hasValidMetadata) {
          logger.info('Discovery: empty/markup-only response detected, attempting fallback', {
            userId: authed.userId,
            fullResponseLength: fullResponse.length,
          });

          // Save the error record so admins can see what the AI returned
          try {
            const record = await prisma.discoveryChatError.create({
              data: {
                userId: authed.userId,
                userMessage: (message ?? content ?? '').slice(0, 2000),
                errorKind: 'empty_response',
                errorDetail: fullResponse ? fullResponse.slice(0, 4000) : '(truly empty — no bytes streamed)',
                discoveryId: discoveryId ?? null,
              },
            });
            logger.info('Discovery: empty_response error saved', { id: record.id });
          } catch (err) {
            logger.warn('Failed to save discovery chat error', {
              error: err instanceof Error ? err.message : String(err),
            });
          }

          // Attempt a fallback: suggest podcast angles based on the original message.
          // Uses a simpler prompt that doesn't require the full structured format,
          // giving the user something useful even when the main agent can't respond.
          const originalMessage = (message ?? content ?? '').trim();
          let fallbackText = '';
          try {
            for await (const chunk of streamFallbackDiscoveryResponse(
              originalMessage,
              aiKey?.apiKey,
              model || undefined,
              (usage) => {
                logUsage({
                  service: effectiveProvider as 'anthropic' | 'openai',
                  model: usage.model,
                  category: 'discovery',
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  userId: authed.userId,
                });
              },
              effectiveProvider,
            )) {
              const text = typeof chunk === 'string' ? chunk : '';
              if (text) {
                fallbackText += text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
              }
            }
          } catch (fallbackErr) {
            logger.warn('Discovery: fallback stream failed', {
              error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            });
          }

          // If the fallback also produced nothing, show a helpful static message
          const fallbackVisible = fallbackText
            .replace(/\[chips:\s*.+?\]/g, '')
            .trim();
          if (!fallbackVisible) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ text: "I wasn't able to generate a response for that topic. Try describing the podcast you have in mind — what should listeners learn or feel?" })}\n\n`
              )
            );
          }

          // Send chips parsed from the fallback response (if any)
          const { chips: fallbackChips } = parseChips(fallbackText);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true, chips: fallbackChips, requestId, ...(detectedLanguage ? { detectedLanguage } : {}) })}\n\n`)
          );
          return; // no controller.close() here — finally handles it for all paths
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
              ...(rawMeta.verification_mode ? { verificationMode: rawMeta.verification_mode } : {}),
              ready: rawMeta.ready,
            }
          : null;

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, chips, metadata, requestId, ...(detectedLanguage ? { detectedLanguage } : {}) })}\n\n`)
        );
      } catch (error) {
        const status = (error as { status?: number }).status;
        const isAuthError = status === 401 || status === 403;

        if (isAuthError && aiKey) {
          await prisma.userAiKey.updateMany({
            where: { userId: authed.userId, provider: effectiveProvider as AiProviderId },
            data: { isValid: false },
          });
        }

        const errorMessage = isAuthError
          ? 'Your AI API key is invalid or has been revoked. Please update it in Settings.'
          : 'An error occurred while generating a response. Please try again.';

        logger.info('Discovery: exception path triggered', {
          userId: authed.userId,
          errorKind: isAuthError ? 'auth_error' : 'exception',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        try {
          const record = await prisma.discoveryChatError.create({
            data: {
              userId: authed.userId,
              userMessage: (message ?? content ?? '').slice(0, 2000),
              errorKind: isAuthError ? 'auth_error' : 'exception',
              errorDetail: error instanceof Error
                ? `${error.message}\n${error.stack ?? ''}`.slice(0, 4000)
                : String(error).slice(0, 4000),
              discoveryId: discoveryId ?? null,
            },
          });
          logger.info('Discovery: exception error saved', { id: record.id });
        } catch (dbErr) {
          logger.warn('Failed to save discovery chat error', {
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          });
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errorMessage, requestId })}\n\n`)
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
      'x-request-id': requestId,
    },
  });
}
