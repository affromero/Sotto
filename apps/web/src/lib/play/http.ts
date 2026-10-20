import { NextResponse } from 'next/server';
import { z } from 'zod';
import { playEmptyQuerySchema } from '@sotto/shared';
import { AccessError } from 'thesidedoor-core/access';
import { cookieValue, readAccessJson } from 'thesidedoor-core/access/http';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/redis';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { PlayRuleError } from './errors';
import type { PlayActor } from './storage/rooms';

export const PLAY_PROOF_HEADER = 'X-Sotto-Play-Proof';

export async function optionalPlayActor(request: Request): Promise<PlayActor | null> {
  const identity = await authenticateRequest(request);
  if (!identity) {
    if (request.headers.has('authorization') || cookieValue(request, SHARED_SESSION_COOKIE))
      throw new AccessError('unauthorized');
    return null;
  }
  const expectedProfileId = request.headers.get('X-Sotto-Play-Profile');
  if (expectedProfileId !== null && expectedProfileId !== identity.userId)
    throw new AccessError('forbidden');
  return { database: prismaUnfiltered, request, identity };
}

export async function requirePlayActor(request: Request): Promise<PlayActor> {
  const actor = await optionalPlayActor(request);
  if (!actor) throw new AccessError('unauthorized');
  return actor;
}

export function playBrowserMutation(request: Request) {
  return (
    !request.headers.has('authorization') &&
    (request.headers.has('origin') || !!cookieValue(request, SHARED_SESSION_COOKIE))
  );
}

export function playQuery<Schema extends z.ZodType>(request: Request, schema: Schema) {
  if (request.url.length > 4096) throw new AccessError('invalid');
  const values: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (Object.hasOwn(values, key)) throw new AccessError('invalid');
    values[key] = value;
  }
  return schema.parse(values);
}

export async function playBody<Schema extends z.ZodType>(request: Request, schema: Schema) {
  return schema.parse(await readAccessJson(request));
}

/** Share canonical origin/error policy; never expose input values in validation errors. */
export async function playOperation(
  request: Request,
  browser: boolean,
  operation: () => Promise<Response>
): Promise<Response> {
  const response = await accessOperation(request, browser, async () => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        playQuery(request, playEmptyQuerySchema);
      return await operation();
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse('Invalid play request.', 400);
      if (error instanceof PlayRuleError)
        return errorResponse(
          error.message,
          { forbidden: 403, conflict: 409, invalid: 400 }[error.code]
        );
      throw error;
    }
  });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export async function limitPlayOperation(bucket: string, limit: number) {
  const rate = await checkRateLimit(`play:${bucket}`, limit, 60);
  if (!rate.allowed) throw new AccessError('rate_limited');
}

export function playJson<Schema extends z.ZodType>(schema: Schema, data: unknown, status = 200) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error('Play response does not match its contract.');
  return NextResponse.json(parsed.data, { status });
}

/** Cookie issuance follows canonical session attributes; JSON carries no session secret. */
export function setPlayBrowserSession(
  response: NextResponse,
  token: string,
  expiresAt: string,
  request: Request
) {
  // The caller has already passed canonical browser-origin validation. That
  // validated Origin is the effective origin even through a trusted proxy.
  const origin = request.headers.get('origin');
  if (!origin) throw new AccessError('forbidden');
  response.cookies.set(SHARED_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(origin).protocol === 'https:',
    path: '/',
    maxAge: Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  });
}
