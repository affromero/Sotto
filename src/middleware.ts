import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PROTECTED_ROUTES = ['/dashboard', '/create', '/settings', '/billing', '/analytics'];
const AUTH_ROUTES = ['/auth/login', '/auth/signup'];

const PASSWORD_GATE_BYPASS = ['/access', '/api/access', '/api/health'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.startsWith('/fonts')) {
    return NextResponse.next();
  }

  // Site-wide password gate (early access)
  if (process.env.SITE_PASSWORD) {
    const isBypassed = PASSWORD_GATE_BYPASS.some((route) => pathname.startsWith(route));
    if (!isBypassed) {
      const accessCookie = request.cookies.get('sotto_access');
      if (accessCookie?.value !== 'granted') {
        return NextResponse.redirect(new URL('/access', request.url));
      }
    }
  }

  const token = await getToken({ req: request });

  // Skip API routes (handled by individual route handlers)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Redirect authenticated users away from auth pages
  if (token && AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Redirect unauthenticated users to login for protected routes
  if (!token && PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|manifest.json|sw.js).*)'],
};
