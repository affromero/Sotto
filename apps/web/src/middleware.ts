import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PROTECTED_ROUTES = [
  '/dashboard',
  '/create',
  '/settings',
  '/billing',
  '/analytics',
  '/admin',
  '/welcome',
];
const AUTH_ROUTES = ['/auth/login', '/auth/signup', '/auth/waitlisted'];

// Routes that are always public — no auth required
const PUBLIC_ROUTES = new Set([
  '/',
  '/api/health',
  '/feedback',
  '/api/feedback',
  '/pitch',
  '/connect/telegram',
  '/changelog',
  '/developers',
  '/api/monitoring',
]);
const PUBLIC_PREFIXES = ['/api/auth', '/api/pitch', '/api/oembed', '/api/waitlist', '/api/telegram', '/ref', '/podcast/by-slug'];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  if (pathname.match(/^\/podcast\/[^/]+\/embed$/)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and SEO routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/fonts') ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt'
  ) {
    return NextResponse.next();
  }

  // Public routes are always accessible
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // API routes with Authorization headers are handled by the route handler
  if (pathname.startsWith('/api/') && request.headers.get('authorization')) {
    return NextResponse.next();
  }

  // Detect secure cookies — must match what NextAuth uses when setting the cookie.
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const secureCookie = forwardedProto === 'https' || request.nextUrl.protocol === 'https:';

  // Fetch JWT token once — secureCookie ensures correct cookie name lookup
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie,
  });

  // Banned user redirect — allow /banned page, auth routes, and API auth
  if (token?.bannedAt && pathname !== '/banned' && !pathname.startsWith('/api/auth')) {
    return NextResponse.redirect(new URL('/banned', request.url));
  }

  // Auth pages (login, signup, waitlisted): redirect to dashboard if already authenticated
  if (AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    if (token) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
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
