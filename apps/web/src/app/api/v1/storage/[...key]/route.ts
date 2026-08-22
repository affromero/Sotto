import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { readLocalObject } from '@/lib/r2';

type RouteParams = { params: Promise<{ key: string[] }> };

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
  if (!authed) return errorResponse('Unauthorized', 401);

  const { key } = await params;
  const range = request.headers.get('range');

  let object: Awaited<ReturnType<typeof readLocalObject>>;
  try {
    object = await readLocalObject(key.join('/'), range);
  } catch {
    // localPathForKey throws on any key that escapes the storage root.
    return errorResponse('Not found', 404);
  }
  if (!object) return errorResponse('Not found', 404);

  const { body, size, contentType, start, end } = object;
  const partial = Boolean(range);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(body.length),
    'Accept-Ranges': 'bytes',
    // Keys carry the owning record's id, so a given key's bytes never change.
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;

  return new NextResponse(new Uint8Array(body), { status: partial ? 206 : 200, headers });
}
