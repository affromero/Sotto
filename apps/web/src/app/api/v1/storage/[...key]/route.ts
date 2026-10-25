import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { readLocalObject } from '@/lib/r2';
import { validateStorageKey } from 'thesidedoor-core/storage';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ key: string[] }> };
const cacheHeaders = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/v1/storage/[...key] — serve an object from local storage.
 *
 * Object storage (R2/S3) hands the browser a public or presigned URL of its
 * own. Local storage has no origin, so the app itself is the origin: this is
 * the read side of `localUrlForKey`. It answers only when local storage is the
 * configured provider, and it is authenticated like every other route here —
 * the instance access gate is opt-in and would otherwise leave every recording
 * and worksheet readable by anyone who guesses a key.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401, undefined, cacheHeaders);

  const { key } = await params;
  if (key[0] === 'materials') return errorResponse('Not found', 404, undefined, cacheHeaders);
  const storageKey = key.join('/');
  try {
    validateStorageKey(storageKey);
  } catch {
    return errorResponse('Not found', 404, undefined, cacheHeaders);
  }
  const range = request.headers.get('range');

  let object: Awaited<ReturnType<typeof readLocalObject>>;
  try {
    object = await readLocalObject(storageKey, authed.userId, range);
  } catch (error: unknown) {
    logger.error('Failed to read stored object', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to read stored object', 500, undefined, cacheHeaders);
  }
  if (!object) return errorResponse('Not found', 404, undefined, cacheHeaders);

  const { body, size, contentType, start, end } = object;
  const partial = Boolean(range);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(body.length),
    'Accept-Ranges': 'bytes',
    ...cacheHeaders,
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;

  return new NextResponse(new Uint8Array(body), { status: partial ? 206 : 200, headers });
}
