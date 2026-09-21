import { NextRequest, NextResponse } from 'next/server';
import { isSelfHosted } from './lib/self-hosted';
import { prismaUnfiltered } from './lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';

const HOSTED_MOCK_ROUTES = [
  '/classes',
  '/create',
  '/dashboard',
  '/admin',
  '/episode',
  '/learn',
  '/memory',
  '/profile',
  '/profiles',
  '/ref',
  '/settings',
  '/voices',
];
const PUBLIC_API_ROUTES = new Set(['/api/version', '/api/v1/health', '/api/v1/auth/pair/redeem']);
const PUBLIC_FILES = new Set([
  '/favicon.ico',
  '/icon.svg',
  '/icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-icon.png',
  '/apple-touch-icon.png',
  '/manifest.json',
  '/sw.js',
  '/sitemap.xml',
  '/robots.txt',
]);

function within(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}
function privateResponse(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

/** Shared admission protects the perimeter. Handlers still enforce content ownership and owner authority. */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    PUBLIC_FILES.has(pathname) ||
    ['/_next', '/fonts', '/avatars'].some((root) => within(pathname, root))
  )
    return NextResponse.next();

  if (!isSelfHosted()) {
    if (HOSTED_MOCK_ROUTES.some((root) => within(pathname, root)))
      return privateResponse(NextResponse.redirect(new URL('/welcome', request.url)));
    if (pathname === '/' || pathname === '/welcome') return NextResponse.next();
    if (
      (pathname === '/api/v1/onboarding/config' && request.method === 'GET') ||
      (pathname === '/api/v1/onboarding/save' && request.method === 'POST')
    )
      return privateResponse(NextResponse.next());
  }
  if (
    pathname === '/access' ||
    PUBLIC_API_ROUTES.has(pathname) ||
    within(pathname, '/api/v1/access')
  )
    return privateResponse(NextResponse.next());

  try {
    const identity = await sottoTransaction(prismaUnfiltered, (database) =>
      resolveSottoRequest(database, request)
    );
    if (!identity) {
      return privateResponse(
        pathname.startsWith('/api/')
          ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          : NextResponse.redirect(new URL('/access', request.url))
      );
    }
    if (
      !pathname.startsWith('/api/') &&
      identity.kind === 'household' &&
      pathname !== '/access/security' &&
      !within(pathname, '/profiles')
    )
      return privateResponse(NextResponse.redirect(new URL('/profiles', request.url)));
    return privateResponse(NextResponse.next());
  } catch {
    return privateResponse(
      NextResponse.json(
        { error: 'Access is unavailable. Check the instance configuration and access migration.' },
        { status: 503 }
      )
    );
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|manifest.json|sw.js).*)'],
};
