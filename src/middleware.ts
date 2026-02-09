import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PROTECTED_ROUTES = ['/dashboard', '/create', '/settings', '/billing', '/analytics'];
const AUTH_ROUTES = ['/auth/login', '/auth/signup'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = await getToken({ req: request });

  // Skip API routes (handled by individual route handlers)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip static files and webhooks
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.startsWith('/fonts')) {
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
