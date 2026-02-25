import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { extractContent } from '@/lib/extractors';
import { checkRateLimit } from '@/lib/redis';
import { validateUrl, UrlValidationError } from '@/lib/url-validator';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const { url } = body;

  if (!url || typeof url !== 'string') {
    return errorResponse('url is required', 400);
  }

  try {
    await validateUrl(url);
  } catch (err) {
    if (err instanceof UrlValidationError) {
      return errorResponse(err.message, 400);
    }
    throw err;
  }

  const { allowed } = await checkRateLimit(`url-extract:${session.user.id}`, 10, 60);
  if (!allowed) {
    return errorResponse('Rate limited', 429);
  }

  try {
    const extracted = await extractContent(url);
    return NextResponse.json({
      title: extracted.title,
      description: extracted.description,
      siteName: extracted.siteName,
      wordCount: extracted.wordCount,
      sourceType: extracted.sourceType,
      preview: extracted.text.substring(0, 500),
    });
  } catch (err) {
    logger.error('Discovery extract failed', { url, error: (err as Error).message });
    return errorResponse('Failed to extract content from URL', 422);
  }
}
