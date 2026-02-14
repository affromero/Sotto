import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { streamDiscoveryResponse, parseChips, parseMetadata } from '@/lib/discovery-agent';
import { getAiKey } from '@/lib/byok';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { message, discoveryId } = body;

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

  // Build message history
  const messages = discovery?.messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  })) || [];

  messages.push({ role: 'user', content: message });

  // Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = '';
      for await (const chunk of streamDiscoveryResponse(messages, aiKey?.apiKey)) {
        fullResponse += chunk;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
      }

      const { chips } = parseChips(fullResponse);
      const metadata = parseMetadata(fullResponse);

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ done: true, chips, metadata })}\n\n`)
      );
      controller.close();
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
