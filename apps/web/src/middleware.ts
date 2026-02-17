import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PROTECTED_ROUTES = [
  '/dashboard',
  '/create',
  '/settings',
  '/billing',
  '/analytics',
  '/admin',
  '/onboarding',
];
const AUTH_ROUTES = ['/auth/login', '/auth/signup'];

// Routes that are always public — no password gate, no auth required
const PUBLIC_ROUTES = new Set([
  '/',
  '/romero',
  '/api/access',
  '/api/health',
  '/api/waitlist',
  '/feedback',
  '/api/feedback',
  '/pitch',
  '/connect/telegram',
]);
const PUBLIC_PREFIXES = ['/api/auth', '/api/pitch', '/api/oembed'];

async function verifyAccessCookie(value: string, secret: string): Promise<boolean> {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) return false;

  const timestamp = value.substring(0, separatorIndex);
  const signature = value.substring(separatorIndex + 1);
  if (!timestamp || !signature) return false;

  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age < 0 || age > 30 * 24 * 60 * 60 * 1000) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp));

  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return expected === signature;
}

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  if (pathname.match(/^\/podcast\/[^/]+\/embed$/)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/fonts')
  ) {
    return NextResponse.next();
  }

  // Public routes are always accessible
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // API routes with Authorization headers bypass the password gate
  // (the route handler is responsible for its own auth)
  if (pathname.startsWith('/api/') && request.headers.get('authorization')) {
    return NextResponse.next();
  }

  // Detect secure cookies — must match what NextAuth uses when setting the cookie.
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const secureCookie = forwardedProto === 'https' || request.nextUrl.protocol === 'https:';

  // Fetch JWT token once — secureCookie ensures correct cookie name lookup
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    secureCookie,
  });

  // Banned user redirect — allow /banned page, auth routes, and API auth
  if (token?.bannedAt && pathname !== '/banned' && !pathname.startsWith('/api/auth')) {
    return NextResponse.redirect(new URL('/banned', request.url));
  }

  // Auth pages (login, signup): bypass password gate but redirect if already authenticated
  if (AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    if (token) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  // Early-access password gate
  // Authenticated users (valid JWT) bypass the gate entirely.
  if (process.env.SITE_PASSWORD && !token) {
    const accessCookie = request.cookies.get('sotto_access');
    const secret = process.env.NEXTAUTH_SECRET;

    let hasAccess = false;
    if (accessCookie?.value && secret) {
      hasAccess = await verifyAccessCookie(accessCookie.value, secret);
    }

    if (!hasAccess) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // Skip API routes (handled by individual route handlers)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login for protected routes
  if (!token && PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin route protection: only ADMIN role can access /admin
  if (pathname.startsWith('/admin') && token?.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|manifest.json|sw.js).*)'],
};
