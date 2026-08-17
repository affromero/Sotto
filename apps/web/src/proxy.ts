import { NextRequest, NextResponse } from 'next/server';
import { isSelfHosted } from './lib/self-hosted';
import { accessPasswordConfigured, verifyGateToken, GATE_COOKIE } from './lib/access/gate';

// Sotto is self-hosted for a household — there is no login. The proxy does two
// things only:
//  1. Access gate: when the owner set SOTTO_ACCESS_PASSWORD (public instances),
//     page requests without a valid gate cookie go to /gate. API routes are
//     excluded here — auth()/requireAdmin() and authenticateRequest() enforce
//     the gate inside handlers, while authenticateRequest() also lets valid
//     sk_sotto_ Bearer clients through.
//  2. Managed showcase (SELF_HOSTED=false): steer mock-able app surfaces into
//     the non-persisting /welcome demo.
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

const GATE_OPEN_ROUTES = ['/gate'];
const GATE_OPEN_API_ROUTES = new Set([
  '/api/health',
  '/api/version',
  '/api/v1/health',
  '/api/v1/gate',
  '/api/v1/auth/pair/redeem',
]);

function isHostedMockRoute(pathname: string): boolean {
  return HOSTED_MOCK_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function isGateExempt(pathname: string): boolean {
  return GATE_OPEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function hasApiBearerCredential(request: NextRequest): boolean {
  return request.headers.get('authorization')?.startsWith('Bearer sk_sotto_') === true;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and SEO routes. Icon assets must stay reachable without
  // the gate cookie or browsers fall back to another domain's favicon, and
  // /avatars must too: next/image fetches them server-side without cookies.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/apple-icon') ||
    pathname.startsWith('/apple-touch-icon') ||
    pathname.startsWith('/fonts') ||
    pathname.startsWith('/avatars')
  ) {
    return NextResponse.next();
  }

  // Hard API perimeter for password-protected deployments. Only the gate
  // exchange, minimal health/version probes, and one-time pairing redemption
  // are reachable without a gate cookie. Bearer requests continue to their
  // handlers, which validate the full API key before returning any data.
  if (accessPasswordConfigured() && pathname.startsWith('/api/')) {
    if (!GATE_OPEN_API_ROUTES.has(pathname) && !hasApiBearerCredential(request)) {
      const gateToken = request.cookies.get(GATE_COOKIE)?.value;
      if (!(await verifyGateToken(gateToken))) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          {
            status: 401,
            headers: {
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          }
        );
      }
    }
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
