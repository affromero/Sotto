import { NextRequest, NextResponse } from 'next/server';
import { isSelfHosted } from './lib/self-hosted';

// Sotto is fully self-hosted for a single learner — there is no login, so the
// middleware does no auth gating. The only routing left is steering the managed
// showcase (SELF_HOSTED=false) into its non-persisting /welcome demo. Real
// self-hosted installs pass every request straight through.
const HOSTED_MOCK_ROUTES = [
  '/classes',
  '/create',
  '/dashboard',
  '/admin',
  '/episode',
  '/invite',
  '/learn',
  '/memory',
  '/profile',
  '/profiles',
  '/ref',
  '/settings',
  '/voices',
];

function isHostedMockRoute(pathname: string): boolean {
  return HOSTED_MOCK_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export function middleware(request: NextRequest) {
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

  // Managed showcase only: route the mock-able app surfaces into the /welcome demo.
  if (!isSelfHosted() && isHostedMockRoute(pathname)) {
    return NextResponse.redirect(new URL('/welcome', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|manifest.json|sw.js).*)'],
};
