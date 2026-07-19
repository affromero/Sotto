import { NextRequest, NextResponse } from 'next/server';
import { isSelfHosted } from './lib/self-hosted';
import { accessPasswordConfigured, verifyGateToken, GATE_COOKIE } from './lib/access/gate';

// Sotto is self-hosted for a household — there is no login. The proxy does two
// things only:
//  1. Access gate: when the owner set SOTTO_ACCESS_PASSWORD (public instances),
//     page requests without a valid gate cookie go to /gate. API routes are
//     excluded here — authenticateRequest() enforces the gate for cookie-based
//     API calls while letting sk_sotto_ Bearer clients through.
//  2. Managed showcase (SELF_HOSTED=false): steer mock-able app surfaces into
//     the non-persisting /welcome demo.
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

const GATE_OPEN_ROUTES = ['/gate', '/invite'];

function isHostedMockRoute(pathname: string): boolean {
  return HOSTED_MOCK_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function isGateExempt(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    GATE_OPEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  );
}

export async function proxy(request: NextRequest) {
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

  // Access gate for publicly exposed instances.
  if (accessPasswordConfigured() && !isGateExempt(pathname)) {
    const gateToken = request.cookies.get(GATE_COOKIE)?.value;
    if (!(await verifyGateToken(gateToken))) {
      return NextResponse.redirect(new URL('/gate', request.url));
    }
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
