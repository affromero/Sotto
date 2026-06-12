import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isSelfHosted } from './lib/self-hosted';

const PROTECTED_ROUTES = ['/dashboard', '/create', '/settings', '/admin'];
const AUTH_ROUTES = ['/auth/login', '/auth/signup'];
const HOSTED_MOCK_ROUTES = [
  '/auth/login',
  '/auth/signup',
  '/classes',
  '/create',
  '/dashboard',
  '/admin',
  '/episode',
  '/invite',
  '/learn',
  '/memory',
  '/profile',
  '/ref',
  '/settings',
  '/voices',
];

// Routes that are always public — no auth required
const PUBLIC_ROUTES = new Set([
  '/',
  '/api/v1/health',
  '/feedback',
  '/api/v1/feedback',
  '/changelog',
  '/developers',
  '/api/v1/monitoring',
]);
const PUBLIC_PREFIXES = ['/api/v1/auth', '/ref', '/episode/by-slug'];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isProtectedRoute(pathname: string, selfHosted: boolean): boolean {
  if (selfHosted && pathname.startsWith('/welcome')) return true;
  return PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
}

function isHostedMockRoute(pathname: string): boolean {
  return HOSTED_MOCK_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const selfHosted = isSelfHosted();

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

  if (!selfHosted && isHostedMockRoute(pathname)) {
    return NextResponse.redirect(new URL('/welcome', request.url));
  }

  // Public routes are always accessible
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // API routes with Authorization headers are handled by the route handler
  if (pathname.startsWith('/api/v1/') && request.headers.get('authorization')) {
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

  // Auth pages: redirect to dashboard if already authenticated
  if (AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    if (token) {
      return NextResponse.redirect(new URL('/learn', request.url));
    }
    return NextResponse.next();
  }

  // Skip API routes (handled by individual route handlers)
  if (pathname.startsWith('/api/v1/')) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login for protected routes
  if (!token && isProtectedRoute(pathname, selfHosted)) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin route protection: only ADMIN role can access /admin
  if (pathname.startsWith('/admin') && token?.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/learn', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|manifest.json|sw.js).*)'],
};
